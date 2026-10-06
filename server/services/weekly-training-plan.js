/* ═══════════════════════════════════════════════════════════════════════
   WEEKLY TRAINING PLAN — motor da seção "Treino IA" (IDEIA-7, Issue #1).

   Mesma regra arquitetural de performance-analysis.js (ADR-0002/0004): a IA
   nunca calcula número nenhum. `insumos` (CTL/ATL/TSB, tendência de peso,
   limiares calibrados) já vem pronto do frontend; este service só monta o
   prompt, chama gerarAnalise() (ai-providers.js, inalterado) e grava o
   resultado com parsing-com-fallback.

   Diferente de performance-analysis.js: a saída da IA aqui É os dados
   estruturados (não há "prosa aproveitável" se o JSON vier malformado) —
   falha de parse é tratada como falha de geração (propaga erro, a rota
   decide 502 + cache antigo). E a tabela NÃO é singleton: cada geração
   insere uma linha nova e desativa a anterior (campo `ativo`), preservando
   histórico — sem expiração por tempo, o plano vale até o usuário gerar
   outro manualmente.
═══════════════════════════════════════════════════════════════════════ */
const { gerarAnalise } = require('./ai-providers');

const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
const CATEGORIAS_ZONA = ['resistencia', 'limiarLatico', 'esforcoMaximo'];

const LABEL_DIA = {
  segunda: 'segunda-feira', terca: 'terça-feira', quarta: 'quarta-feira',
  quinta: 'quinta-feira', sexta: 'sexta-feira', sabado: 'sábado', domingo: 'domingo',
};
const LABEL_OBJETIVO = {
  condicionamento: 'condicionamento geral', performance: 'performance/velocidade', perdaPeso: 'perda de peso',
};
const LABEL_NIVEL = { iniciante: 'iniciante', intermediario: 'intermediário', avancado: 'avançado' };

// Handoff: resposta estruturada (não prosa) — cada dia vira um card com
// descrição + rosca de categorias de zona, por isso o schema de saída é
// rígido (7 dias, categorias dentro do enum, minutos somando a duração).
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
    'baseie as recomendações em frequência cardíaca e percepção de esforço.\n\n',
    `Objetivos do atleta, em ordem de prioridade: ${objetivos || 'não informado'}.\n`,
    `Nível de experiência: ${nivel || 'não informado'}.\n`,
    `Dias disponíveis para treinar: ${dias || 'não informado'}.\n`,
    `Duração fixa por sessão: ${perfil.duracaoSessaoMin} minutos.\n`,
    `Dia do treino longão: ${longao || 'não informado'}.\n`,
    linhasInsumos.length ? `\nDados atuais do atleta (já calculados, não recalcule):\n${linhasInsumos.join('\n')}\n` : '',
    '\nRegras de preenchimento: dias FORA da lista de "dias disponíveis" devem ter ',
    'tipoTreino "descanso", duracaoMin 0 e distribuicaoZonas vazio. O dia do treino longão ',
    'deve ter tipoTreino "longao". Para os demais dias de treino, varie o tipo ',
    '("resistencia", "intervalado" ou outro que fizer sentido) de forma coerente com os ',
    'objetivos e o nível declarados. Em cada dia de treino, distribuicaoZonas deve listar os ',
    'minutos planejados nas categorias "resistencia", "limiarLatico" e "esforcoMaximo", cuja ',
    'soma deve ser exatamente igual a duracaoMin daquele dia.\n\n',
    'Responda em português, SOMENTE com um objeto JSON válido (sem markdown, sem ```), no ',
    'formato exato: {"plano": [{"diaSemana": "segunda", "tipoTreino": "...", "duracaoMin": N, ',
    '"distribuicaoZonas": [{"categoria": "resistencia", "minutos": N}, ...], "descricao": "1-3 ',
    'frases do racional do dia"}, ... 7 itens, um por dia da semana, segunda a domingo], ',
    '"observacaoGeral": "1-3 frases de racional geral da semana"}.',
  ].join('');
}

// Diferente de performance-analysis.js: aqui não há "texto bruto aproveitável"
// se o parse falhar — a saída É os dados estruturados. Falha de formato lança
// erro (com .bruto pra log), tratada pela rota como falha de geração (502 +
// cache antigo). Itens individuais fora do formato são descartados em vez de
// invalidar a resposta inteira inteira, tolerando pequenas variações da IA.
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

  if (!parsed || !Array.isArray(parsed.plano) || parsed.plano.length !== 7) {
    const e = new Error('plano ausente ou sem 7 dias'); e.bruto = texto.slice(0, 500); throw e;
  }

  // Soma minutos de categorias repetidas no mesmo dia (dedupe por categoria)
  // em vez de só descartar duplicatas — uma IA que devolve "resistencia"
  // duas vezes no mesmo dia não deve gerar uma rosca com soma < 100%.
  function dedupeZonas(lista) {
    const porCategoria = {};
    for (const z of lista) {
      if (!CATEGORIAS_ZONA.includes(z?.categoria) || !Number.isFinite(z?.minutos)) continue;
      porCategoria[z.categoria] = (porCategoria[z.categoria] || 0) + z.minutos;
    }
    return Object.entries(porCategoria).map(([categoria, minutos]) => ({ categoria, minutos }));
  }

  const plano = parsed.plano.map((dia) => ({
    diaSemana: DIAS_SEMANA.includes(dia?.diaSemana) ? dia.diaSemana : null,
    tipoTreino: typeof dia?.tipoTreino === 'string' && dia.tipoTreino ? dia.tipoTreino : 'descanso',
    duracaoMin: Number.isFinite(dia?.duracaoMin) ? Math.max(0, dia.duracaoMin) : 0,
    distribuicaoZonas: Array.isArray(dia?.distribuicaoZonas) ? dedupeZonas(dia.distribuicaoZonas) : [],
    descricao: typeof dia?.descricao === 'string' ? dia.descricao : '',
  }));

  const diasValidos = plano.map((d) => d.diaSemana);
  if (diasValidos.some((d) => d == null) || new Set(diasValidos).size !== 7) {
    const e = new Error('plano com dias duplicados ou inválidos'); e.bruto = texto.slice(0, 500); throw e;
  }

  return {
    plano,
    observacaoGeral: typeof parsed.observacaoGeral === 'string' ? parsed.observacaoGeral : '',
  };
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
  const { plano, observacaoGeral } = parseRespostaIA(texto);
  const payload = JSON.stringify({ plano, observacaoGeral, perfil, insumos, provider, model });

  const txn = db.transaction(() => {
    db.prepare('UPDATE weekly_training_plans SET ativo = 0 WHERE ativo = 1').run();
    db.prepare('INSERT INTO weekly_training_plans (ativo, payload, gerado_em) VALUES (1, ?, CURRENT_TIMESTAMP)').run(payload);
  });
  txn();

  return lerCacheAtivo(db);
}

module.exports = {
  DIAS_SEMANA, CATEGORIAS_ZONA,
  montarPrompt, parseRespostaIA, lerCacheAtivo, lerHistorico, gerarEArmazenarPlano,
};
