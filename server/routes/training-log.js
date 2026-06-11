/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/training-log
   GET    /api/training-log         lista ordenada por data
   POST   /api/training-log         cria { id, data, tipos[], notas? }
   DELETE /api/training-log/:id     remove
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

function rowToEntry(r) {
  let tipos = [];
  try { tipos = JSON.parse(r.tipos); if (!Array.isArray(tipos)) tipos = []; } catch (_) {}
  return {
    id:        r.id,
    data:      r.data,
    tipos,
    notas:     r.notas || '',
    createdAt: r.created_at,
  };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/training-log', async () => {
    return fastify.db.prepare('SELECT * FROM training_log ORDER BY data ASC').all().map(rowToEntry);
  });

  fastify.post('/api/training-log', async (req, reply) => {
    const { id, data, tipos, notas } = req.body || {};
    if (!id || !data) return reply.code(400).send({ error: 'id e data obrigatorios' });
    const tiposArr = Array.isArray(tipos) ? tipos : [];
    try {
      fastify.db
        .prepare('INSERT INTO training_log (id, data, tipos, notas) VALUES (?, ?, ?, ?)')
        .run(id, data, JSON.stringify(tiposArr), notas || '');
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return reply.code(409).send({ error: 'ja existe entrada para esta data' });
      }
      return reply.code(400).send({ error: e.message });
    }
    return reply.code(201).send(rowToEntry(fastify.db.prepare('SELECT * FROM training_log WHERE id = ?').get(id)));
  });

  fastify.delete('/api/training-log/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM training_log WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'entrada nao encontrada' });
    return { ok: true };
  });
}

module.exports = routes;
