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

   Rota fina: toda a lógica (seleção de referência/grupo, prompt, parsing de
   JSON, upsert no cache) mora em server/services/performance-analysis.js —
   reaproveitada também pelo job automático das 6h (server/scheduler.js).
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const { lerCache, gerarEArmazenarAnalise } = require('../services/performance-analysis');

const CACHE_VENCIDO_MS = 24 * 60 * 60 * 1000;

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── GET /api/performance-analysis?referenciaId=X ──────────────────────
  fastify.get('/api/performance-analysis', async (req) => {
    const row = lerCache(fastify.db);
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
  // Força uma análise nova agora (botão secundário na UI) — o caminho comum
  // é o job automático das 6h (server/scheduler.js), que só chama a IA
  // quando a Atividade de referência muda.
  fastify.post('/api/performance-analysis', async (req, reply) => {
    const { referenciaId, deltas, grupoResumo } = req.body || {};
    if (!referenciaId || !deltas || !grupoResumo) {
      reply.code(400);
      return { ok: false, error: 'referenciaId, deltas e grupoResumo são obrigatórios' };
    }

    let row;
    try {
      row = await gerarEArmazenarAnalise(fastify.db, { referenciaId, deltas, grupoResumo });
    } catch (err) {
      req.log.warn({ err: err.message, cascata: err.cascata }, 'performance-analysis: todos os provedores de IA falharam');
      const cache = lerCache(fastify.db);
      // 503, não 502 — o Cloudflare na frente do app intercepta qualquer
      // 502/504 de origem e substitui o CORPO por uma página de erro
      // genérica própria, mesmo sendo uma resposta JSON intencional da
      // nossa API (descoberto investigando o mesmo bug no Treino IA).
      reply.code(503);
      return cache
        ? { ok: false, error: 'Análise indisponível no momento', cache: { payload: JSON.parse(cache.payload), geradoEm: cache.gerado_em } }
        : { ok: false, error: 'Análise indisponível no momento' };
    }

    return { ok: true, payload: JSON.parse(row.payload), geradoEm: row.gerado_em };
  });
}

module.exports = routes;
