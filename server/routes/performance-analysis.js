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

// Mesma lógica de js/core/performance-analysis.js:calcularDestaques() —
// duplicada aqui porque é o backend (Node) que monta o prompt; runtime
// diferente, sem import possível (mesmo padrão já aceito em
// server/routes/garmin.js pra tssDeAtividade). Calculado localmente, nunca
// pelo modelo — ADR-0002.
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
// blocos separados — pede JSON estruturado em vez de texto livre (mais
// robusto que regex sobre Markdown cru). O parsing na rota (ver `routes()`)
// tem fallback se o modelo não obedecer o formato.
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
    // O modelo foi instruído a responder só com JSON, mas não dá pra confiar
    // cegamente — fallback: todo o texto bruto vira "observacao", sem foco
    // (a UI esconde o bloco de foco quando foco é null).
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
