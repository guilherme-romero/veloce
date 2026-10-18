/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/push (web-push, #3 Nível B — fundação F1)
   GET    /api/push/vapid-public-key   chave pública p/ o client assinar (subscribe)
   POST   /api/push/subscribe          persiste a PushSubscription (upsert)
   DELETE /api/push/subscribe          remove a subscription (toggle off)
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const push = require('../services/push');

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── GET /api/push/vapid-public-key ────────────────────────────────────
  // O client precisa da chave pública (como Uint8Array) para chamar
  // pushManager.subscribe. 503 se o servidor não tem VAPID configurado — aí a
  // UI de opt-in (F3) nem oferece o toggle.
  fastify.get('/api/push/vapid-public-key', async (req, reply) => {
    if (!push.isConfigured()) {
      return reply.code(503).send({ error: 'Push não configurado no servidor' });
    }
    return { key: config.VAPID_PUBLIC_KEY };
  });

  // ── POST /api/push/subscribe ──────────────────────────────────────────
  // Body = a PushSubscription do navegador: { endpoint, keys: { p256dh, auth } }.
  // Upsert por endpoint (um device pode re-subscrever e reenviar).
  //
  // Rate limit modesto (rota de escrita nova): o upsert por endpoint (PK) já
  // impede o mesmo device de acumular, mas endpoints distintos arbitrários
  // cresceriam a tabela sem teto. Segue o padrão opt-in do POST /auth/login.
  fastify.post('/api/push/subscribe', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const sub = req.body || {};
    const keys = sub.keys || {};
    if (typeof sub.endpoint !== 'string' || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      return reply.code(400).send({ error: 'subscription inválida (endpoint/keys obrigatórios)' });
    }
    // Valida o endpoint como URL https do serviço de push. Fecha SSRF: sem
    // isso, um endpoint apontando para host interno (ex.: 169.254.169.254)
    // seria alvo do POST que o web-push dispara no envio do digest.
    let url;
    try { url = new URL(sub.endpoint); } catch { return reply.code(400).send({ error: 'endpoint inválido' }); }
    if (url.protocol !== 'https:') {
      return reply.code(400).send({ error: 'endpoint deve ser https' });
    }
    fastify.db.prepare(`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
    `).run(sub.endpoint, keys.p256dh, keys.auth);
    return reply.code(201).send({ ok: true });
  });

  // ── DELETE /api/push/subscribe ────────────────────────────────────────
  // Idempotente: remover um endpoint inexistente ainda devolve ok.
  fastify.delete('/api/push/subscribe', async (req, reply) => {
    const endpoint = (req.body || {}).endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      return reply.code(400).send({ error: 'endpoint obrigatório' });
    }
    fastify.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    return { ok: true };
  });
}

module.exports = routes;
