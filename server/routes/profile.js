/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/profile (perfil singleton)
   GET    /api/profile        retorna perfil (ou {} se nao existe)
   PUT    /api/profile        upsert do perfil completo (body = objeto completo)
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/profile', async () => {
    const row = fastify.db
      .prepare('SELECT payload FROM user_profile WHERE id = 1')
      .get();
    if (!row) return {};
    try { return JSON.parse(row.payload); } catch (_) { return {}; }
  });

  fastify.put('/api/profile', async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'payload invalido' });
    }
    const json = JSON.stringify(body);
    fastify.db
      .prepare(`INSERT INTO user_profile (id, payload, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`)
      .run(json);
    return body;
  });
}

module.exports = routes;
