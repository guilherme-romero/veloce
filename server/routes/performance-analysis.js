/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/performance-analysis (Fase 4 da evolução IDEIA-1+2, seção
   Desempenho — bloco "Análise de Performance", GLOSSARY.md).

   GET  /api/performance-analysis   lê o cache (nunca chama o Gemini)
   POST /api/performance-analysis   gera uma análise nova via Gemini

   Cache PERSISTENTE (tabela performance_analysis_cache, singleton id=1,
   schema em server/db/schema-training.sql) — diferente do cache em memória
   da calibração (Fase 2): esta análise custou uma chamada paga ao Gemini,
   então precisa sobreviver a um restart do processo (deploy). O design
   manda mostrar a última análise cacheada mesmo vencida se o Gemini falhar
   (ver ADR-0002/GLOSSARY "Análise de Performance") — por isso o POST só
   sobrescreve a linha em caso de SUCESSO; falha nunca apaga o que já tinha.

   Pré-cálculo local (ADR-0002): o frontend (js/core/performance-analysis.js)
   já manda os deltas prontos no corpo do POST — esta rota nunca recalcula
   número nenhum, só monta o prompt e interpreta a resposta do Gemini.
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

const CACHE_VENCIDO_MS = 24 * 60 * 60 * 1000;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

async function chamarGemini(prompt) {
  if (!config.GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY não configurada');
    err.semChave = true;
    throw err;
  }
  const resp = await fetch(`${GEMINI_URL}?key=${config.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(20_000), // não trava o request esperando a API externa indefinidamente
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    const err = new Error(`Gemini respondeu ${resp.status}`);
    err.upstreamStatus = resp.status;
    err.upstreamBody = corpo.slice(0, 500);
    throw err;
  }
  const json = await resp.json();
  const texto = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) throw new Error('Gemini não devolveu texto');
  return texto.trim();
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

    let texto;
    try {
      texto = await chamarGemini(montarPrompt({ deltas, grupoResumo }));
    } catch (err) {
      req.log.warn({ err: err.message, upstreamStatus: err.upstreamStatus }, 'performance-analysis: Gemini falhou');
      const cache = lerCache(fastify);
      reply.code(502);
      return cache
        ? { ok: false, error: 'Análise indisponível no momento', cache: { payload: JSON.parse(cache.payload), geradoEm: cache.gerado_em } }
        : { ok: false, error: 'Análise indisponível no momento' };
    }

    const payload = JSON.stringify({ texto, deltas, grupoResumo });
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
