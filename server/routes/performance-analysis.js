/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/performance-analysis (Fase 4 da evolução IDEIA-1+2, seção
   Desempenho — bloco "Análise de Performance", GLOSSARY.md).

   GET  /api/performance-analysis   lê o cache (nunca chama nenhuma IA)
   POST /api/performance-analysis   gera uma análise nova via Gemini/Groq

   Cache PERSISTENTE (tabela performance_analysis_cache, singleton id=1,
   schema em server/db/schema-training.sql) — diferente do cache em memória
   da calibração (Fase 2): esta análise custou uma chamada paga a uma IA,
   então precisa sobreviver a um restart do processo (deploy). O design
   manda mostrar a última análise cacheada mesmo vencida se a IA falhar
   (ver ADR-0002/GLOSSARY "Análise de Performance") — por isso o POST só
   sobrescreve a linha em caso de SUCESSO; falha nunca apaga o que já tinha.

   Pré-cálculo local (ADR-0002): o frontend (js/core/performance-analysis.js)
   já manda os deltas prontos no corpo do POST — esta rota nunca recalcula
   número nenhum, só monta o prompt e interpreta a resposta da IA.

   Rotação de modelo de IA (ADR-0004): a chamada em si (descoberta de
   modelo, cascata Gemini→Groq) mora em server/services/ai-providers.js —
   esta rota só consome gerarAnalise() e sabe qual provider/model respondeu
   pra guardar no payload cacheado e exibir na UI.
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const { gerarAnalise } = require('../services/ai-providers');

const CACHE_VENCIDO_MS = 24 * 60 * 60 * 1000;

function montarPrompt({ deltas, grupoResumo }) {
  return [
    'Você é um assistente de treino de ciclismo. Compare os números abaixo (mesma rota/perfil, ',
    'ordem cronológica — mais antigo primeiro) e diga, em português, se houve melhora, em que ',
    'aspecto (velocidade, tempo ou eficiência de FC), e sugira um foco de treino em 2-3 frases. ',
    'Não invente números além dos fornecidos.\n\n',
    `Atividades comparadas: ${grupoResumo.tamanho} saídas de ~${grupoResumo.distanciaKm}km e `,
    `~${grupoResumo.elevacaoM}m de elevação nos últimos 12 meses.\n`,
    `Velocidade média (km/h): ${deltas.velMediaKmh.join(', ')}\n`,
    `Tempo em movimento (s): ${deltas.tempoMovS.join(', ')}\n`,
    `FC média (bpm): ${deltas.fcMedia.join(', ')}\n`,
  ].join('');
}

function lerCache(fastify) {
  return fastify.db.prepare('SELECT * FROM performance_analysis_cache WHERE id = 1').get();
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── GET /api/performance-analysis?referenciaId=X ──────────────────────
  fastify.get('/api/performance-analysis', async (req) => {
    const row = lerCache(fastify);
    if (!row) return { ok: false };

    const referenciaId = req.query?.referenciaId ? String(req.query.referenciaId) : null;
    return {
      ok: true,
      payload: JSON.parse(row.payload),
      geradoEm: row.gerado_em,
      atualPraReferencia: referenciaId != null && row.atividade_referencia_id === referenciaId,
      vencida: (Date.now() - Date.parse(row.gerado_em)) > CACHE_VENCIDO_MS,
    };
  });

  // ── POST /api/performance-analysis ────────────────────────────────────
  fastify.post('/api/performance-analysis', async (req, reply) => {
    const { referenciaId, deltas, grupoResumo } = req.body || {};
    if (!referenciaId || !deltas || !grupoResumo) {
      reply.code(400);
      return { ok: false, error: 'referenciaId, deltas e grupoResumo são obrigatórios' };
    }

    let resultado;
    try {
      resultado = await gerarAnalise(montarPrompt({ deltas, grupoResumo }));
    } catch (err) {
      req.log.warn({ err: err.message, cascata: err.cascata }, 'performance-analysis: todos os provedores de IA falharam');
      const cache = lerCache(fastify);
      reply.code(502);
      return cache
        ? { ok: false, error: 'Análise indisponível no momento', cache: { payload: JSON.parse(cache.payload), geradoEm: cache.gerado_em } }
        : { ok: false, error: 'Análise indisponível no momento' };
    }

    const { texto, provider, model } = resultado;
    const payload = JSON.stringify({ texto, deltas, grupoResumo, provider, model });
    fastify.db
      .prepare(`INSERT INTO performance_analysis_cache (id, atividade_referencia_id, payload, gerado_em)
                VALUES (1, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                  atividade_referencia_id = excluded.atividade_referencia_id,
                  payload = excluded.payload,
                  gerado_em = excluded.gerado_em`)
      .run(String(referenciaId), payload);

    const row = lerCache(fastify);
    return { ok: true, payload: JSON.parse(row.payload), geradoEm: row.gerado_em };
  });
}

module.exports = routes;
