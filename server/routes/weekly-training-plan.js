/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/weekly-training-plan (Treino IA, IDEIA-7, Issue #1).

   GET    /api/weekly-training-plan              lê o plano ativo (nunca chama IA)
   GET    /api/weekly-training-plan/historico     lista simplificada (sem payload completo)
   POST   /api/weekly-training-plan               gera um plano novo via Gemini/Groq
   POST   /api/weekly-training-plan/:id/ativar    reativa um plano do histórico
   DELETE /api/weekly-training-plan/:id           exclui um plano inativo
   DELETE /api/weekly-training-plan/historico     exclui todos os planos inativos (preserva o ativo)

   Além desta rota (sob demanda, botão Gerar), o scheduler gera um plano
   automaticamente toda segunda às 6h (#136) — os dois caminhos passam pelo
   mesmo gerarEArmazenarPlano e pelo mesmo lerPerfilTreinoIa. A diferença
   está nos `insumos`: aqui vêm do frontend no body, no job vêm de
   montarInsumos(db). Rota fina: toda a lógica mora em
   server/services/weekly-training-plan.js.

   Mesmo design de preservação de performance-analysis.js: falha na geração
   NUNCA apaga o plano ativo — a rota devolve 503 com o cache antigo (se
   existir) para a UI continuar mostrando o último plano válido. Usa 503
   (não 502) de propósito: descoberto em produção que o Cloudflare na
   frente do app intercepta qualquer 502/504 de origem e substitui o CORPO
   por uma página de erro genérica própria, mesmo quando o 502 é uma
   resposta JSON intencional da nossa API — quebra o contrato de erro da
   UI. 503 não sofre essa interceptação.
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const {
  lerCacheAtivo, lerHistorico, gerarEArmazenarPlano, ativarPlano, excluirPlano, limparHistorico,
  lerPerfilTreinoIa, sanitizarInsumos,
} = require('../services/weekly-training-plan');

// parseInt sozinho trunca no primeiro caractere não numérico ("1; DROP
// TABLE" -> 1, "1.5" -> 1) — aceitaria silenciosamente um id diferente do
// que a string sugere em vez de 400. Exige a string inteira ser dígitos.
function parseIdParam(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── GET /api/weekly-training-plan ──────────────────────────────────────
  fastify.get('/api/weekly-training-plan', async () => {
    const row = lerCacheAtivo(fastify.db);
    if (!row) return { ok: false };
    return { ok: true, payload: JSON.parse(row.payload), geradoEm: row.gerado_em };
  });

  // ── GET /api/weekly-training-plan/historico ────────────────────────────
  fastify.get('/api/weekly-training-plan/historico', async () => {
    return { ok: true, itens: lerHistorico(fastify.db) };
  });

  // ── POST /api/weekly-training-plan/:id/ativar ───────────────────────────
  // Reativa um plano do histórico — "selecionar" no popup de planos
  // anteriores. Nunca chama IA, só troca qual linha tem ativo=1.
  fastify.post('/api/weekly-training-plan/:id/ativar', async (req, reply) => {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      reply.code(400);
      return { ok: false, error: 'id inválido' };
    }
    let row;
    try {
      row = ativarPlano(fastify.db, id);
    } catch (err) {
      if (err.notFound) { reply.code(404); return { ok: false, error: 'Plano não encontrado' }; }
      throw err;
    }
    return { ok: true, payload: JSON.parse(row.payload), geradoEm: row.gerado_em };
  });

  // ── DELETE /api/weekly-training-plan/historico ──────────────────────────
  // Rota estática — Fastify a prioriza sobre a paramétrica ':id' abaixo
  // independente da ordem de registro, mas mantemos essa ordem por clareza.
  fastify.delete('/api/weekly-training-plan/historico', async () => {
    const excluidos = limparHistorico(fastify.db);
    return { ok: true, excluidos };
  });

  // ── DELETE /api/weekly-training-plan/:id ────────────────────────────────
  // Exclui um plano inativo. O plano ativo nunca pode ser excluído por
  // aqui — excluirPlano() já garante isso no próprio DELETE SQL.
  fastify.delete('/api/weekly-training-plan/:id', async (req, reply) => {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      reply.code(400);
      return { ok: false, error: 'id inválido' };
    }
    const excluido = excluirPlano(fastify.db, id);
    if (!excluido) {
      reply.code(400);
      return { ok: false, error: 'Não é possível excluir o plano ativo, ou plano não encontrado' };
    }
    return { ok: true };
  });

  // ── POST /api/weekly-training-plan ──────────────────────────────────────
  // Rota cara (chama LLM externo) — rate-limit mesmo padrão de /api/auth/login.
  fastify.post('/api/weekly-training-plan', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const perfil = lerPerfilTreinoIa(fastify.db);
    if (!perfil) {
      reply.code(400);
      return { ok: false, error: 'Complete suas preferências de Treino no perfil antes de gerar um plano' };
    }
    const insumos = sanitizarInsumos((req.body || {}).insumos);

    let row;
    try {
      row = await gerarEArmazenarPlano(fastify.db, { perfil, insumos });
    } catch (err) {
      req.log.warn({ err: err.message, cascata: err.cascata, bruto: err.bruto }, 'weekly-training-plan: geração falhou');
      const cache = lerCacheAtivo(fastify.db);
      reply.code(503);
      return cache
        ? { ok: false, error: 'Plano indisponível no momento', cache: { payload: JSON.parse(cache.payload), geradoEm: cache.gerado_em } }
        : { ok: false, error: 'Plano indisponível no momento' };
    }

    return { ok: true, payload: JSON.parse(row.payload), geradoEm: row.gerado_em };
  });
}

module.exports = routes;
