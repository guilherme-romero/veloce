/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/routes (rotas GPX salvas)
   GET    /api/routes          lista por data desc
   POST   /api/routes          cria { id, nome, ...payload }
   DELETE /api/routes/:id      remove
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

function rowToRoute(r) {
  let payload = {};
  try { payload = JSON.parse(r.payload); } catch (_) {}
  return { ...payload, id: r.id, nome: r.nome, createdAt: r.created_at };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/routes', async () => {
    return fastify.db.prepare('SELECT * FROM routes ORDER BY created_at DESC').all().map(rowToRoute);
  });

  fastify.post('/api/routes', async (req, reply) => {
    const { id, nome, ...rest } = req.body || {};
    if (!id || !nome) return reply.code(400).send({ error: 'id e nome obrigatorios' });
    try {
      fastify.db.prepare('INSERT INTO routes (id, nome, payload) VALUES (?, ?, ?)')
        .run(id, nome, JSON.stringify({ ...rest, id, nome }));
    } catch (e) {
      return reply.code(409).send({ error: 'rota ja existe' });
    }
    const row = fastify.db.prepare('SELECT * FROM routes WHERE id = ?').get(id);
    return reply.code(201).send(rowToRoute(row));
  });

  fastify.delete('/api/routes/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM routes WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'rota nao encontrada' });
    return { ok: true };
  });
}

module.exports = routes;
