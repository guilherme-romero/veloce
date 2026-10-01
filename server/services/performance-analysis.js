/* ═══════════════════════════════════════════════════════════════════════
   PERFORMANCE ANALYSIS — motor da Análise de Performance no backend.

   `selecionarReferencia`/`montarGrupo`/`analisar` são PORTADOS (não
   importados) de js/core/performance-analysis.js — aquele módulo é frontend
   (IIFE que usa `window`), não dá pra `require` no Node. Mesmo padrão já
   aceito pra TSS/calibração (server/routes/garmin.js) e pra
   `calcularDestaques` (que já vivia duplicada na rota antes desta extração):
   manter em sincronia manualmente se a lógica mudar no módulo original.

   Isso existe pra servir dois chamadores: a rota HTTP
   (server/routes/performance-analysis.js, sob demanda) e o job automático
   das 6h (server/scheduler.js) — nenhum dos dois recalcula nada que o outro
   já fez, e os dois reaproveitam `gerarEArmazenarAnalise`.
═══════════════════════════════════════════════════════════════════════ */
const { gerarAnalise } = require('./ai-providers');

const DIST_MIN_KM   = 10;
const TOL_DISTANCIA = 0.15;   // ±15%
const TOL_ELEVACAO  = 0.20;   // ±20%
const JANELA_MESES  = 12;
const GRUPO_MIN     = 3;      // incluindo a referência

function elegivel(a) {
  return a && typeof a.distanciaKm === 'number' && a.distanciaKm >= DIST_MIN_KM;
}

function selecionarReferencia(activities) {
  const elegiveis = (activities || []).filter(elegivel).sort((a, b) => b.data.localeCompare(a.data));
  return elegiveis[0] || null;
}

function dentroDaTolerancia(valor, alvo, tolerancia) {
  if (valor == null || alvo == null) return false;
  if (alvo === 0) return valor === 0;
  return Math.abs(valor - alvo) / alvo <= tolerancia;
}

function haMenosDeNMeses(dataISO, referenciaISO, meses) {
  const d = new Date(dataISO + 'T12:00:00');
  const limite = new Date(referenciaISO + 'T12:00:00');
  limite.setMonth(limite.getMonth() - meses);
  return d >= limite;
}

function montarGrupo(activities, referencia) {
  const grupo = (activities || []).filter((a) =>
    elegivel(a) &&
    haMenosDeNMeses(a.data, referencia.data, JANELA_MESES) &&
    dentroDaTolerancia(a.distanciaKm, referencia.distanciaKm, TOL_DISTANCIA) &&
    dentroDaTolerancia(a.elevacaoM, referencia.elevacaoM, TOL_ELEVACAO)
  );
  return grupo.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * @param  {Object} params
 * @param  {Array}  params.activities — mesmo shape de getUnifiedActivities().items
 * @return {Object} { ok:false } | { ok:true, referenciaId, grupo, deltas }
 */
function analisar({ activities }) {
  const acts = Array.isArray(activities) ? activities : [];
  const referencia = selecionarReferencia(acts);
  if (!referencia) return { ok: false };

  const grupo = montarGrupo(acts, referencia);
  if (grupo.length < GRUPO_MIN) return { ok: false };

  return {
    ok: true,
    referenciaId: referencia.id,
    grupo: grupo.map((a) => ({ id: a.id, data: a.data, distanciaKm: a.distanciaKm, elevacaoM: a.elevacaoM })),
    deltas: {
      velMediaKmh: grupo.map((a) => a.velMediaKmh ?? null),
      tempoMovS:   grupo.map((a) => a.tempoMovS ?? null),
      fcMedia:     grupo.map((a) => a.fcMedia ?? null),
    },
  };
}

// Mesma lógica de js/core/performance-analysis.js:calcularDestaques() —
// calculado localmente, nunca pelo modelo de IA (ADR-0002).
function calcularDestaques(deltas) {
  const vel = (deltas.velMediaKmh || []).filter((v) => v != null);
  const fc  = (deltas.fcMedia || []).filter((v) => v != null);
  return {
    velMinKmh: vel.length ? Math.min(...vel) : null,
    velMaxKmh: vel.length ? Math.max(...vel) : null,
    fcMinBpm:  fc.length ? Math.min(...fc) : null,
    fcMaxBpm:  fc.length ? Math.max(...fc) : null,
  };
}

// Handoff_desempenho: a UI mostra "observação" e "foco de treino" como
// blocos separados — pede JSON estruturado em vez de texto livre.
function montarPrompt({ deltas, grupoResumo }) {
  const destaques = calcularDestaques(deltas);
  return [
    'Você é um assistente de treino de ciclismo. Compare os números abaixo (mesma rota/perfil, ',
    'ordem cronológica — mais antigo primeiro) e avalie se houve melhora, em que aspecto ',
    '(velocidade, tempo ou eficiência de FC). Não invente números além dos fornecidos — a faixa de ',
    'velocidade e de FC já aparece na tela separadamente, não repita esses números na prosa.\n\n',
    `Atividades comparadas: ${grupoResumo.tamanho} saídas de ~${grupoResumo.distanciaKm}km e `,
    `~${grupoResumo.elevacaoM}m de elevação nos últimos 12 meses.\n`,
    `Velocidade média (km/h): ${deltas.velMediaKmh.join(', ')} (faixa ${destaques.velMinKmh}–${destaques.velMaxKmh})\n`,
    `Tempo em movimento (s): ${deltas.tempoMovS.join(', ')}\n`,
    `FC média (bpm): ${deltas.fcMedia.join(', ')} (faixa ${destaques.fcMinBpm}–${destaques.fcMaxBpm})\n\n`,
    'Responda em português, SOMENTE com um objeto JSON válido (sem markdown, sem ```), no formato ',
    'exato: {"observacao": "2-4 frases sobre o que os números mostram", "foco": "1-3 frases de ',
    'sugestão de foco de treino"}.',
  ].join('');
}

function lerCache(db) {
  return db.prepare('SELECT * FROM performance_analysis_cache WHERE id = 1').get();
}

/**
 * Chama a IA (cascata Gemini→Groq via gerarAnalise), parseia a resposta como
 * JSON com fallback, e grava no cache SÓ em caso de sucesso — falha nunca
 * apaga o que já tinha (mesmo design de sempre, ver GLOSSARY.md "Análise de
 * Performance"). Usada pela rota POST (sob demanda) e pelo job das 6h
 * (automático) — nenhuma duplicação entre os dois chamadores.
 * @throws {Error} com .cascata quando todos os provedores de IA falham
 *   (propagado de gerarAnalise) — quem chama decide o que fazer (a rota
 *   devolve o cache antigo com 502; o scheduler só loga e tenta de novo
 *   amanhã às 6h).
 * @return {Object} a linha do cache já atualizada (mesmo shape de lerCache())
 */
async function gerarEArmazenarAnalise(db, { referenciaId, deltas, grupoResumo }) {
  const resultado = await gerarAnalise(montarPrompt({ deltas, grupoResumo }));
  const { texto, provider, model } = resultado;

  let observacao = texto;
  let foco = null;
  try {
    const parsed = JSON.parse(texto);
    if (parsed && typeof parsed.observacao === 'string') {
      observacao = parsed.observacao;
      foco = typeof parsed.foco === 'string' ? parsed.foco : null;
    }
  } catch (_) { /* resposta não veio em JSON — usa o texto bruto como observação */ }

  const payload = JSON.stringify({ observacao, foco, deltas, grupoResumo, provider, model });
  db.prepare(`INSERT INTO performance_analysis_cache (id, atividade_referencia_id, payload, gerado_em)
              VALUES (1, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(id) DO UPDATE SET
                atividade_referencia_id = excluded.atividade_referencia_id,
                payload = excluded.payload,
                gerado_em = excluded.gerado_em`)
    .run(String(referenciaId), payload);

  return lerCache(db);
}

module.exports = {
  selecionarReferencia, montarGrupo, analisar, calcularDestaques, montarPrompt,
  lerCache, gerarEArmazenarAnalise,
};
