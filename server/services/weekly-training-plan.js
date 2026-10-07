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
   de peso, limiares calibrados) já vem pronto do frontend. Esta versão vai
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

const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
const ZONA_IDS = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'];
const TIPOS = ['resistencia', 'intervalado', 'longao', 'descanso'];

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

function lerHistorico(db, limit = 10) {
  return db.prepare('SELECT id, gerado_em FROM weekly_training_plans ORDER BY id DESC LIMIT ?').all(limit);
}

/**
 * @throws {Error} com .cascata (de gerarAnalise) ou .bruto (de parseRespostaIA)
 *   quando a geração falha — quem chama decide (a rota devolve 502 + cache antigo).
 * @return {Object} a linha ativa já atualizada (mesmo shape de lerCacheAtivo())
 */
async function gerarEArmazenarPlano(db, { perfil, insumos }) {
  const { texto, provider, model } = await gerarAnalise(montarPrompt({ perfil, insumos }));
  const { objetivo, dias: diasSemData } = parseRespostaIA(texto);
  const dias = atribuirDatas(diasSemData);
  const payload = JSON.stringify({ objetivo, dias, perfil, insumos, provider, model });

  const txn = db.transaction(() => {
    db.prepare('UPDATE weekly_training_plans SET ativo = 0 WHERE ativo = 1').run();
    db.prepare('INSERT INTO weekly_training_plans (ativo, payload, gerado_em) VALUES (1, ?, CURRENT_TIMESTAMP)').run(payload);
  });
  txn();

  return lerCacheAtivo(db);
}

module.exports = {
  DIAS_SEMANA, ZONA_IDS, TIPOS,
  montarPrompt, parseRespostaIA, atribuirDatas, lerCacheAtivo, lerHistorico, gerarEArmazenarPlano,
};
