/* ═══════════════════════════════════════════════════════════════════════
   WEEKLY TRAINING PLAN — motor da seção "Treino IA" (IDEIA-7, Issue #1).

   Contrato de dados e layout vêm do handoff de design
   (treino_bike_docs/handoff_treino_ia/README.md): cada dia tem `blocos[]`
   (perfil de esforço: minutos/zona/intensidade/rótulo), `rpe` (faixa
   min-máx), `titulo{a,b}` e `resumo` — os totais da semana (volume,
   contagem de treinos/descanso, % por zona) são calculados no FRONTEND a
   partir de `dias[].blocos`, nunca pedidos à IA.

   Mesma regra arquitetural de performance-analysis.js (ADR-0002/0004): a IA
   nunca calcula número determinístico — `insumos` (CTL/ATL/TSB, tendência
   de peso, limiares calibrados) já vem pronto de quem chama: do frontend no
   caso do botão Gerar, ou de montarInsumos() aqui no caso do job automático
   das segundas (#136). Esta versão vai
   além: a IA também não decide a DATA de cada dia — isso é calculado aqui
   (próxima ocorrência de cada dia da semana a partir de hoje), evitando que
   a IA erre aritmética de calendário.

   Zona de FC usa os mesmos ids/cores canônicos de window.FC_ZONES
   (js/utils.js, z1..z6) — não os hexadecimais ilustrativos do mockup do
   handoff, para manter um único vocabulário de cor de zona no app inteiro.

   Diferente de performance-analysis.js: a saída da IA aqui É os dados
   estruturados (não há "prosa aproveitável" se o JSON vier malformado) —
   falha de parse é tratada como falha de geração (propaga erro, a rota
   decide 502 + cache antigo). Tabela NÃO é singleton: cada geração insere
   uma linha nova e desativa a anterior (campo `ativo`), preservando
   histórico — sem expiração por tempo.
═══════════════════════════════════════════════════════════════════════ */
const { gerarAnalise } = require('./ai-providers');
const { getUnifiedActivities } = require('./activities');
const { Metrics, WeightStats } = require('../utils/core-modules');
const { diaLocalKey, dataDeTimestampSqlite } = require('../utils/datas');

const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
const OBJETIVOS_TREINO_IA = ['condicionamento', 'performance', 'perdaPeso'];
const NIVEIS_EXPERIENCIA = ['iniciante', 'intermediario', 'avancado'];
const ZONA_IDS = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'];
const TIPOS = ['resistencia', 'intervalado', 'longao', 'descanso'];

// Mesma janela que o frontend usa em UnifiedActivities.get(365)
// (js/weekly-training-plan.js:309) — calcTSBMetrics só olha os últimos 60
// dias, o resto é aquecimento da EMA.
const JANELA_INSUMOS_DIAS = 365;

// Normaliza "terça"→"terca" etc. — defesa extra além da instrução explícita
// no prompt: descoberto em produção que a IA às vezes devolve o dia com a
// grafia correta em português (acentuada) em vez do slug ASCII pedido.
function normalizarDiaSemana(v) {
  if (typeof v !== 'string') return v;
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
const ZONA_PADRAO_POR_TIPO = { resistencia: 'z2', intervalado: 'z4', longao: 'z2' };
const INTENSIDADE_PADRAO_POR_TIPO = { resistencia: 0.45, intervalado: 0.75, longao: 0.4 };

const LABEL_DIA = {
  segunda: 'segunda-feira', terca: 'terça-feira', quarta: 'quarta-feira',
  quinta: 'quinta-feira', sexta: 'sexta-feira', sabado: 'sábado', domingo: 'domingo',
};
const LABEL_TIPO = { resistencia: 'Resistência', intervalado: 'Intervalado', longao: 'Longão', descanso: 'Descanso' };
const LABEL_OBJETIVO = {
  condicionamento: 'condicionamento geral', performance: 'performance/velocidade', perdaPeso: 'perda de peso',
};
const LABEL_NIVEL = { iniciante: 'iniciante', intermediario: 'intermediário', avancado: 'avançado' };

// Handoff: cada dia vira uma coluna + card de detalhe com perfil de esforço
// (gráfico de blocos por zona) — por isso o schema de saída é rígido (7
// dias, tipo/zona dentro do enum, blocos com minutos/intensidade válidos).
function montarPrompt({ perfil, insumos }) {
  const objetivos = (perfil.objetivosPrioridade || [])
    .map((o, i) => `${i + 1}º: ${LABEL_OBJETIVO[o] || o}`)
    .join('; ');
  const dias = (perfil.diasDisponiveis || []).map((d) => LABEL_DIA[d] || d).join(', ');
  const longao = LABEL_DIA[perfil.diaLongao] || perfil.diaLongao;
  const nivel = LABEL_NIVEL[perfil.nivelExperiencia] || perfil.nivelExperiencia;

  const linhasInsumos = [];
  if (insumos?.ctl != null) linhasInsumos.push(`CTL (carga crônica): ${insumos.ctl}`);
  if (insumos?.atl != null) linhasInsumos.push(`ATL (carga aguda): ${insumos.atl}`);
  if (insumos?.tsb != null) linhasInsumos.push(`TSB (forma/fadiga): ${insumos.tsb}`);
  if (insumos?.tendenciaPeso) linhasInsumos.push(`Tendência de peso: ${insumos.tendenciaPeso.msg || (insumos.tendenciaPeso.taxaKgSem + ' kg/semana')}`);
  if (insumos?.limiares && !insumos.limiares.fallback?.zonaAlvo) {
    linhasInsumos.push(`Limiar calibrado de zona alta (% do tempo em zona alta considerado adequado): ${Math.round((insumos.limiares.zonaAltaMinPct || 0) * 100)}%`);
  }

  return [
    'Você é um assistente de treino de ciclismo. Gere UMA ÚNICA semana-padrão ',
    'recorrente de treino (7 dias, segunda a domingo), sem periodização nem progressão de ',
    'carga ao longo de semanas futuras — é sempre a mesma semana que se repete. ',
    'NÃO calcule FTP, potência ou qualquer número além dos insumos fornecidos abaixo — ',
    'baseie as recomendações em frequência cardíaca (zonas Z1 a Z6) e percepção de esforço (RPE 0-10).\n\n',
    `Objetivos do atleta, em ordem de prioridade: ${objetivos || 'não informado'}.\n`,
    `Nível de experiência: ${nivel || 'não informado'}.\n`,
    `Dias disponíveis para treinar: ${dias || 'não informado'}.\n`,
    `Duração fixa por sessão: ${perfil.duracaoSessaoMin} minutos.\n`,
    `Dia do treino longão: ${longao || 'não informado'}.\n`,
    linhasInsumos.length ? `\nDados atuais do atleta (já calculados, não recalcule):\n${linhasInsumos.join('\n')}\n` : '',
    '\nRegras de preenchimento: dias FORA da lista de "dias disponíveis" têm descanso=true, ',
    'tipo "descanso", duracao_min 0, rpe [0,0] e blocos vazio. O dia do treino longão tem tipo ',
    '"longao". Para os demais dias de treino, varie o tipo ("resistencia" ou "intervalado") de ',
    'forma coerente com os objetivos e o nível declarados. Em cada dia de treino, "blocos" descreve ',
    'o perfil de esforço da sessão (aquecimento, bloco(s) principal(is), desaquecimento): cada bloco ',
    'tem "min" (minutos, inteiro positivo), "zona" ("z1" a "z6", conforme a intensidade do bloco), ',
    '"intensidade" (0 a 1, proporcional ao esforço dentro do bloco) e "rotulo" (ex.: "aquec.", ',
    '"bloco Z2", "3×10\' limiar", "desaq."). A soma dos minutos dos blocos deve ser exatamente ',
    'igual a duracao_min do dia. "rpe" é a faixa de esforço percebido do dia inteiro, ex.: [3,4] ',
    'para um treino leve ou [7,8] para um treino intenso (ambos de 0 a 10). "titulo" é um destaque ',
    'curto do treino em DUAS PARTES (ex.: {"a":"120 MIN EM","b":"ZONA 2"} ou {"a":"3 × 10\' NO",',
    '"b":"LIMIAR"}). "resumo" é 1 frase curta (até ~70 caracteres); "descricao" é 1-3 frases mais ',
    'completas explicando o racional do dia.\n\n',
    '"objetivo" é 1-3 frases descrevendo o racional geral da semana, considerando os objetivos do ',
    'atleta.\n\n',
    'O campo "dia" de cada item deve ser EXATAMENTE um destes 7 valores, sem acento e nesta grafia ',
    'literal (são identificadores internos, não texto para exibir): "segunda", "terca", "quarta", ',
    '"quinta", "sexta", "sabado", "domingo".\n\n',
    'Responda em português, SOMENTE com um objeto JSON válido (sem markdown, sem ```), no formato ',
    'exato: {"objetivo": "...", "dias": [{"dia": "segunda", "descanso": false, "tipo": "...", ',
    '"duracao_min": N, "rpe": [N,N], "titulo": {"a":"...","b":"..."}, "resumo": "...", ',
    '"descricao": "...", "blocos": [{"min":N,"zona":"z2","intensidade":0.45,"rotulo":"..."}]}, ',
    '... 7 itens, um por dia da semana, segunda a domingo]}.',
  ].join('');
}

function clamp01(n) { return Math.min(1, Math.max(0, n)); }

function tituloFallback(tipo, duracaoMin) {
  return { a: String(duracaoMin) + ' MIN', b: (LABEL_TIPO[tipo] || tipo).toUpperCase() };
}

function resumoFallback(descricao) {
  if (!descricao) return '';
  const primeiraFrase = descricao.split(/(?<=[.!?])\s/)[0] || descricao;
  return primeiraFrase.length > 70 ? primeiraFrase.slice(0, 69) + '…' : primeiraFrase;
}

function sanitizarBlocos(blocosRaw, tipo, duracaoMin) {
  const limpos = Array.isArray(blocosRaw)
    ? blocosRaw
        .filter((b) => Number.isFinite(b?.min) && b.min > 0 && ZONA_IDS.includes(String(b?.zona || '').toLowerCase()))
        .map((b) => ({
          min: Math.round(b.min),
          zona: String(b.zona).toLowerCase(),
          intensidade: Number.isFinite(b.intensidade) ? clamp01(b.intensidade) : 0.5,
          rotulo: typeof b.rotulo === 'string' ? b.rotulo.slice(0, 60) : '',
        }))
    : [];
  if (limpos.length) return limpos;
  // Fallback do README: sem blocos válidos → 1 bloco único na zona do tipo.
  if (tipo === 'descanso' || !duracaoMin) return [];
  return [{
    min: duracaoMin,
    zona: ZONA_PADRAO_POR_TIPO[tipo] || 'z2',
    intensidade: INTENSIDADE_PADRAO_POR_TIPO[tipo] || 0.5,
    rotulo: LABEL_TIPO[tipo] || tipo,
  }];
}

function sanitizarRpe(rpeRaw, descanso) {
  if (descanso) return [0, 0];
  if (!Array.isArray(rpeRaw) || rpeRaw.length !== 2 || !rpeRaw.every(Number.isFinite)) return [5, 5];
  const [a, b] = rpeRaw.map((n) => Math.min(10, Math.max(0, Math.round(n))));
  return a <= b ? [a, b] : [b, a];
}

// Diferente de performance-analysis.js: aqui não há "texto bruto aproveitável"
// se o parse falhar — a saída É os dados estruturados. Falha de formato lança
// erro (com .bruto pra log), tratada pela rota como falha de geração (502 +
// cache antigo).
function parseRespostaIA(texto) {
  let parsed;
  try {
    parsed = JSON.parse(texto);
  } catch (_) {
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) { const e = new Error('IA não devolveu JSON'); e.bruto = texto.slice(0, 500); throw e; }
    try { parsed = JSON.parse(m[0]); }
    catch (_e2) { const e = new Error('IA devolveu JSON inválido mesmo após extração'); e.bruto = texto.slice(0, 500); throw e; }
  }

  if (!parsed || !Array.isArray(parsed.dias) || parsed.dias.length !== 7) {
    const e = new Error('dias ausente ou sem 7 itens'); e.bruto = texto.slice(0, 500); throw e;
  }

  const dias = parsed.dias.map((d) => {
    const diaNormalizado = normalizarDiaSemana(d?.dia);
    const dia = DIAS_SEMANA.includes(diaNormalizado) ? diaNormalizado : null;
    const descanso = !!d?.descanso || d?.tipo === 'descanso';
    const tipo = descanso ? 'descanso' : (TIPOS.includes(d?.tipo) ? d.tipo : 'resistencia');
    const duracaoMin = descanso ? 0 : Math.max(0, Number.isFinite(d?.duracao_min) ? Math.round(d.duracao_min) : 0);
    const blocos = sanitizarBlocos(d?.blocos, tipo, duracaoMin);
    const titulo = (d?.titulo && typeof d.titulo.a === 'string' && typeof d.titulo.b === 'string')
      ? { a: d.titulo.a.slice(0, 40), b: d.titulo.b.slice(0, 40) }
      : tituloFallback(tipo, duracaoMin);
    const descricao = typeof d?.descricao === 'string' ? d.descricao.slice(0, 600) : '';
    const resumo = typeof d?.resumo === 'string' && d.resumo ? d.resumo.slice(0, 120) : resumoFallback(descricao);
    return { dia, descanso, tipo, duracaoMin, rpe: sanitizarRpe(d?.rpe, descanso), titulo, resumo, descricao, blocos };
  });

  const diasValidos = dias.map((d) => d.dia);
  if (diasValidos.some((d) => d == null) || new Set(diasValidos).size !== 7) {
    const e = new Error('plano com dias duplicados ou inválidos'); e.bruto = texto.slice(0, 500); throw e;
  }

  return {
    objetivo: typeof parsed.objetivo === 'string' ? parsed.objetivo.slice(0, 600) : '',
    dias,
  };
}

// Data de cada dia = próxima ocorrência daquele dia da semana a partir da
// segunda-feira da semana atual — calculado aqui, nunca pela IA.
function atribuirDatas(dias, refDate = new Date()) {
  const d = new Date(refDate);
  const dow = d.getDay(); // 0=domingo..6=sabado
  const diffParaSegunda = dow === 0 ? -6 : 1 - dow;
  const segunda = new Date(d);
  segunda.setDate(segunda.getDate() + diffParaSegunda);
  segunda.setHours(12, 0, 0, 0);

  return dias.map((dia) => {
    const offset = DIAS_SEMANA.indexOf(dia.dia);
    const data = new Date(segunda);
    data.setDate(data.getDate() + offset);
    return { ...dia, data: data.toISOString().slice(0, 10) };
  });
}

function lerCacheAtivo(db) {
  return db.prepare('SELECT * FROM weekly_training_plans WHERE ativo = 1').get();
}

// Devolve id/ativo/data + um resumo do objetivo (sem o payload inteiro) de
// cada plano — suficiente pro popup "Planos anteriores" mostrar qual é o
// atual e do que se tratava cada um, sem carregar os 7 dias de todos.
// #137: paginado. `page` e' 1-based; `limit` default 5 (o atual + 4, pedido da
// issue). Devolve tambem o `total`, sem o qual a UI nao sabe quantas paginas
// existem — e `ORDER BY id DESC` com OFFSET so e' estavel porque id e'
// AUTOINCREMENT e nenhuma linha muda de posicao depois de inserida.
const HIST_LIMIT_DEFAULT = 5;
const HIST_LIMIT_MAX = 50;

function lerHistorico(db, { page = 1, limit = HIST_LIMIT_DEFAULT } = {}) {
  // Valor invalido (<=0, NaN, texto) cai no DEFAULT, nao em 1: `?limit=-5`
  // devolvendo um unico item pareceria bug na tela. So o excesso e' clampado.
  const limNum = Math.floor(Number(limit));
  const lim = Number.isFinite(limNum) && limNum >= 1 ? Math.min(HIST_LIMIT_MAX, limNum) : HIST_LIMIT_DEFAULT;
  const pagNum = Math.floor(Number(page));
  const pag = Number.isFinite(pagNum) && pagNum >= 1 ? pagNum : 1;
  const total = db.prepare('SELECT COUNT(*) AS n FROM weekly_training_plans').get().n;
  const totalPaginas = Math.max(1, Math.ceil(total / lim));
  const rows = db.prepare(
    'SELECT id, ativo, favorito, gerado_em, payload FROM weekly_training_plans ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(lim, (pag - 1) * lim);
  const itens = rows.map((r) => {
    let objetivo = '';
    try { objetivo = JSON.parse(r.payload)?.objetivo || ''; } catch (_) { /* payload corrompido — segue com objetivo vazio */ }
    return {
      id: r.id,
      ativo: !!r.ativo,
      favorito: !!r.favorito,
      geradoEm: r.gerado_em,
      objetivo: objetivo.length > 80 ? objetivo.slice(0, 79) + '…' : objetivo,
    };
  });
  return { itens, total, pagina: pag, limite: lim, totalPaginas };
}

// #137: favoritar/desfavoritar. Favoritado fica imune a excluirPlano,
// limparHistorico e a poda do teto de 30.
// @throws {Error} com .notFound quando o id nao existe.
// @return {boolean} o estado final de favorito.
function favoritarPlano(db, id, favorito) {
  const alvo = db.prepare('SELECT id FROM weekly_training_plans WHERE id = ?').get(id);
  if (!alvo) { const e = new Error('plano não encontrado'); e.notFound = true; throw e; }
  const valor = favorito ? 1 : 0;
  db.prepare('UPDATE weekly_training_plans SET favorito = ? WHERE id = ?').run(valor, id);
  return !!valor;
}

// #137: teto de 30 NAO-favoritados. Roda dentro da transacao de insercao, nao
// na abertura da tela: o job automatico das segundas (#136) insere sem
// ninguem olhando, e um teto que dependesse da UI nunca seria aplicado.
// O plano ativo e os favoritados ficam fora da conta e da poda.
const TETO_NAO_FAVORITOS = 30;

function podarHistorico(db, teto = TETO_NAO_FAVORITOS) {
  const info = db.prepare(`
    DELETE FROM weekly_training_plans
     WHERE favorito = 0 AND ativo = 0
       AND id NOT IN (
         SELECT id FROM weekly_training_plans
          WHERE favorito = 0 AND ativo = 0
          ORDER BY id DESC LIMIT ?
       )`).run(teto);
  return info.changes;
}

// Reativa um plano do histórico: desativa o atual, ativa o escolhido.
// @throws {Error} se `id` não existir na tabela.
// @return {Object} a linha ativa (nova), mesmo shape de lerCacheAtivo().
function ativarPlano(db, id) {
  const alvo = db.prepare('SELECT id FROM weekly_training_plans WHERE id = ?').get(id);
  if (!alvo) { const e = new Error('plano não encontrado'); e.notFound = true; throw e; }

  const txn = db.transaction(() => {
    db.prepare('UPDATE weekly_training_plans SET ativo = 0 WHERE ativo = 1').run();
    db.prepare('UPDATE weekly_training_plans SET ativo = 1 WHERE id = ?').run(id);
  });
  txn();
  return lerCacheAtivo(db);
}

// Exclui um plano inativo. `AND ativo = 0` é defesa em profundidade — nunca
// apaga o plano ativo mesmo que a rota erre a validação antes de chamar isto.
// @return {boolean} true se alguma linha foi de fato excluída.
function excluirPlano(db, id) {
  // #137: `AND favorito = 0` e' a mesma defesa em profundidade do `ativo = 0`
  // — a rota ja valida, mas o invariante mora aqui.
  const info = db.prepare('DELETE FROM weekly_training_plans WHERE id = ? AND ativo = 0 AND favorito = 0').run(id);
  return info.changes > 0;
}

// "Limpar histórico" — exclui todos os planos INATIVOS, preserva o ativo.
// @return {number} quantidade de planos excluídos.
function limparHistorico(db) {
  // #137: favoritado sobrevive ao "limpar tudo" — e' justamente o que
  // favoritar significa.
  const info = db.prepare('DELETE FROM weekly_training_plans WHERE ativo = 0 AND favorito = 0').run();
  return info.changes;
}

/* ── Perfil, insumos e guard de duplicata (compartilhados rota × job) ────
   Esta seção serve dois chamadores: a rota HTTP (botão Gerar) e o job
   automático das segundas (#136) — mesmo arranjo de performance-analysis.js,
   onde o motor mora no service e nenhum dos dois recalcula o que o outro já
   fez. */

function lerUserPayload(db) {
  const row = db.prepare('SELECT payload FROM user_profile WHERE id = 1').get();
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch (_) { return null; }
}

// Lê o perfil JÁ VALIDADO no banco (whitelist de server/routes/profile.js)
// em vez de confiar no `perfil` que o cliente manda no body — evita que um
// body malicioso/malformado injete texto arbitrário no prompt da IA (o
// corpo do POST só precisa trazer `insumos`, calculados no frontend).
// Devolve null quando o intake de Treino IA está incompleto: a rota vira
// 400 e o job apenas loga e pula.
function lerPerfilTreinoIa(db) {
  const p = lerUserPayload(db);
  if (!p) return null;

  const objetivosPrioridade = Array.isArray(p.objetivosPrioridade)
    ? p.objetivosPrioridade.filter((o) => OBJETIVOS_TREINO_IA.includes(o))
    : [];
  const diasDisponiveis = Array.isArray(p.diasDisponiveis)
    ? p.diasDisponiveis.filter((d) => DIAS_SEMANA.includes(d))
    : [];
  const duracaoSessaoMin = Number.isFinite(p.duracaoSessaoMin) ? p.duracaoSessaoMin : null;
  const diaLongao = DIAS_SEMANA.includes(p.diaLongao) ? p.diaLongao : null;
  const nivelExperiencia = NIVEIS_EXPERIENCIA.includes(p.nivelExperiencia) ? p.nivelExperiencia : null;

  if (!objetivosPrioridade.length || !diasDisponiveis.length || !duracaoSessaoMin || !diaLongao || !nivelExperiencia) {
    return null;
  }
  return { objetivosPrioridade, diasDisponiveis, duracaoSessaoMin, diaLongao, nivelExperiencia };
}

// Sanitiza `insumos` antes de entrar no prompt: só os campos esperados, com
// coerção de tipo — nenhum texto livre chega ao prompt sem passar por aqui.
// Mora no service (e não na rota, onde nasceu) porque agora há DOIS
// produtores de insumos: o body do POST e montarInsumos() abaixo. Com a
// função aqui, montarInsumos fecha por ela, e a garantia de shape passa a ser
// estrutural em vez de "os dois lugares combinam de coincidir".
function sanitizarInsumos(insumos) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const out = {
    ctl: num(insumos?.ctl),
    atl: num(insumos?.atl),
    tsb: num(insumos?.tsb),
    tendenciaPeso: null,
    limiares: null,
  };
  if (insumos?.tendenciaPeso && typeof insumos.tendenciaPeso === 'object') {
    out.tendenciaPeso = {
      taxaKgSem: num(insumos.tendenciaPeso.taxaKgSem),
      msg: str(insumos.tendenciaPeso.msg, 200),
    };
  }
  if (insumos?.limiares && typeof insumos.limiares === 'object') {
    out.limiares = {
      zonaAltaMinPct: num(insumos.limiares.zonaAltaMinPct),
      tssRecuperacaoIgnorada: num(insumos.limiares.tssRecuperacaoIgnorada),
      tsbSobrecarga: num(insumos.limiares.tsbSobrecarga),
      fallback: (insumos.limiares.fallback && typeof insumos.limiares.fallback === 'object') ? {
        zonaAlvo: !!insumos.limiares.fallback.zonaAlvo,
        tss: !!insumos.limiares.fallback.tss,
        tsb: !!insumos.limiares.fallback.tsb,
      } : null,
    };
  }
  return out;
}

/**
 * Insumos do prompt calculados NO SERVIDOR, para o job automático (#136) —
 * o botão Gerar continua mandando os seus pelo body (montarInsumos em
 * js/weekly-training-plan.js:308). As FÓRMULAS não são duplicadas: tanto o
 * frontend quanto aqui chamam os mesmos js/core/metrics.js e
 * js/core/weight-stats.js (via server/utils/core-modules.js). O que existe
 * em dois lugares é só a montagem — buscar atividades, peso e fcMax.
 *
 * `limiares` fica null de propósito: o cálculo mora dentro do closure da
 * rota GET /api/garmin/calibration (server/routes/garmin.js:404+, com cache
 * próprio) e renderia UMA linha no prompt — a de zona alta, e só quando há
 * amostra suficiente para calibrar (ver montarPrompt acima). Extrair aquilo
 * para um service é refactor de rota quente, fora do escopo do #136.
 * sanitizarInsumos já trata null, e a UI nunca lê `payload.insumos` de
 * volta — só o envia.
 *
 * @return {Object} o shape de sanitizarInsumos(), porque fecha por ela.
 *   Pode lançar se o banco estiver indisponível (db.prepare /
 *   getUnifiedActivities) — quem chama é runTreinoIa, que roda em try/catch.
 */
function montarInsumos(db) {
  const insumos = { ctl: null, atl: null, tsb: null, tendenciaPeso: null, limiares: null };
  const u = lerUserPayload(db);
  if (!u) return insumos;

  // Sem fcMax não há TSS: calcTSBMetrics devolveria zeros, e zero no prompt
  // ("CTL: 0") mente mais do que a ausência da linha. Divergência consciente
  // em relação ao frontend, que manda 0 nesse caso (js/weekly-training-plan.js
  // passa `u.fcMax` cru). Não uso Metrics.calcFCMax como fallback de
  // propósito: o job inventaria um número (220−idade) que o botão não usa.
  if (Number.isFinite(u.fcMax) && u.fcMax > 0) {
    const { items } = getUnifiedActivities(db, JANELA_INSUMOS_DIAS);
    const m = Metrics.calcTSBMetrics(items, u.fcMax);
    insumos.ctl = m.ctl;
    insumos.atl = m.atl;
    insumos.tsb = m.tsb;
  }

  // Shape da tabela (data/peso/tipo) já é o que dailyWeights espera de
  // Storage.getWeights() — filtra tipo='atual' lá dentro.
  const pesos = db.prepare('SELECT data, peso, tipo FROM weights ORDER BY data ASC').all();
  const analise = WeightStats.weightAnalysis(u, pesos);
  if (analise && analise.ok) {
    insumos.tendenciaPeso = { taxaKgSem: analise.taxaKgSem, msg: analise.msg };
  }

  // Fecha pela mesma sanitização do body: um NaN/Infinity vindo de uma
  // regressão degenerada, ou uma msg que cresça lá em weight-stats, não
  // passa daqui para o prompt.
  return sanitizarInsumos(insumos);
}

/**
 * Já existe plano gerado no dia local de `agora`? É o guard de duplicata do
 * job automático (#136), e é PERSISTENTE de propósito: o tick do scheduler
 * passa duas vezes dentro da hora do job (:00 e :30), então um Set em
 * memória — padrão dos outros jobs — não sobreviveria a um restart entre os
 * dois slots e geraria um segundo plano (e uma segunda chamada de IA). Mesmo
 * raciocínio pelo qual o digest de push consulta a tabela push_sent em vez
 * de guardar estado em memória.
 *
 * Olha a ÚLTIMA linha inserida (maior id), não a linha ativa: reativar um
 * plano antigo do histórico move o `ativo=1` para trás no tempo e faria um
 * guard baseado em `ativo` liberar outra geração no mesmo dia.
 */
function planoGeradoHoje(db, agora = new Date()) {
  const row = db.prepare('SELECT gerado_em FROM weekly_training_plans ORDER BY id DESC LIMIT 1').get();
  if (!row) return false;
  const d = dataDeTimestampSqlite(row.gerado_em);
  if (!d) return false;
  return diaLocalKey(d) === diaLocalKey(agora);
}

// Mesma trava de "promessa em voo" usada em performance-analysis.js (#26):
// chamada de IA paga/cotada, acionável manualmente pelo usuário — duplo
// toque ou retry do frontend não deve disparar 2 chamadas concorrentes.
// Com chamadas concorrentes, a segunda recebe o resultado da primeira
// (aceitável aqui — app single-user, janela de poucos segundos).
let emVoo = null;

/**
 * @throws {Error} com .cascata (de gerarAnalise) quando a geração falha. Desde
 *   a #159 o parseRespostaIA entra na cascata como validador, então uma resposta
 *   fora de formato aparece como item `motivo: 'resposta_invalida'` (com o
 *   `bruto` daquele candidato) dentro de .cascata, em vez de virar um erro solto
 *   com .bruto na raiz. Quem chama decide (a rota devolve 502 + cache antigo).
 * @return {Object} a linha ativa já atualizada (mesmo shape de lerCacheAtivo())
 */
async function gerarEArmazenarPlano(db, { perfil, insumos }) {
  if (emVoo) return emVoo;

  emVoo = (async () => {
    // parseRespostaIA vai como validador: um candidato cuja resposta não
    // parseia é descartado e a cascata tenta o próximo (#159). Sem isso, um
    // único JSON malformado queimava as 4 tentativas e o job de segunda não
    // gerava plano nenhum. O parse roda 2× (aqui e na linha de baixo) — é
    // função pura sobre ~5 KB, e manter o retorno da cascata como texto evita
    // mudar o contrato que a Análise de Performance e o relatório mensal usam.
    const { texto, provider, model } = await gerarAnalise(montarPrompt({ perfil, insumos }), parseRespostaIA);
    const { objetivo, dias: diasSemData } = parseRespostaIA(texto);
    const dias = atribuirDatas(diasSemData);
    const payload = JSON.stringify({ objetivo, dias, perfil, insumos, provider, model });

    const txn = db.transaction(() => {
      db.prepare('UPDATE weekly_training_plans SET ativo = 0 WHERE ativo = 1').run();
      db.prepare('INSERT INTO weekly_training_plans (ativo, payload, gerado_em) VALUES (1, ?, CURRENT_TIMESTAMP)').run(payload);
      podarHistorico(db);   // #137 — teto dentro da MESMA transacao da insercao
    });
    txn();

    return lerCacheAtivo(db);
  })();

  try {
    return await emVoo;
  } finally {
    emVoo = null;
  }
}

module.exports = {
  DIAS_SEMANA, ZONA_IDS, TIPOS,
  montarPrompt, parseRespostaIA, atribuirDatas, lerCacheAtivo, lerHistorico, gerarEArmazenarPlano,
  ativarPlano, excluirPlano, limparHistorico, favoritarPlano, podarHistorico,
  HIST_LIMIT_DEFAULT, TETO_NAO_FAVORITOS,
  lerPerfilTreinoIa, sanitizarInsumos, montarInsumos, planoGeradoHoje,
};
