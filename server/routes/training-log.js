/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/training-log
   GET    /api/training-log              lista ordenada por data
   POST   /api/training-log              cria { id, data, tipos[], notas?, payload? }
   PUT    /api/training-log/:id          merge parcial { tipos?, notas?, payload? }
   DELETE /api/training-log/:id          remove
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

function rowToEntry(r) {
  let tipos = [];
  let payload = null;
  try { tipos = JSON.parse(r.tipos); if (!Array.isArray(tipos)) tipos = []; } catch (_) {}
  if (r.payload) { try { payload = JSON.parse(r.payload); } catch (_) {} }
  return {
    id:        r.id,
    data:      r.data,
    tipos,
    notas:     r.notas || '',
    payload,
    createdAt: r.created_at,
  };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/training-log', async () => {
    return fastify.db.prepare('SELECT * FROM training_log ORDER BY data ASC').all().map(rowToEntry);
  });

  fastify.post('/api/training-log', async (req, reply) => {
    const { id, data, tipos, notas, payload } = req.body || {};
    if (!id || !data) return reply.code(400).send({ error: 'id e data obrigatorios' });
    const tiposArr = Array.isArray(tipos) ? tipos : [];
    const payloadJson = payload && typeof payload === 'object' ? JSON.stringify(payload) : null;
    try {
      fastify.db
        .prepare('INSERT INTO training_log (id, data, tipos, notas, payload) VALUES (?, ?, ?, ?, ?)')
        .run(id, data, JSON.stringify(tiposArr), notas || '', payloadJson);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return reply.code(409).send({ error: 'ja existe entrada para esta data' });
      }
      req.log.error({ err: e }, 'erro ao criar training-log');
      return reply.code(400).send({ error: 'Não foi possível salvar o registro. Verifique os dados enviados.' });
    }
    return reply.code(201).send(rowToEntry(fastify.db.prepare('SELECT * FROM training_log WHERE id = ?').get(id)));
  });

  fastify.put('/api/training-log/:id', async (req, reply) => {
    const id = req.params.id;
    const existing = fastify.db.prepare('SELECT * FROM training_log WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: 'nao encontrada' });
    const { tipos, notas, payload } = req.body || {};
    const newTipos   = Array.isArray(tipos) ? JSON.stringify(tipos) : existing.tipos;
    const newNotas   = notas !== undefined ? (notas || '') : existing.notas;
    const newPayload = payload !== undefined
      ? (payload && typeof payload === 'object' ? JSON.stringify(payload) : null)
      : existing.payload;
    fastify.db
      .prepare('UPDATE training_log SET tipos = ?, notas = ?, payload = ? WHERE id = ?')
      .run(newTipos, newNotas, newPayload, id);
    return rowToEntry(fastify.db.prepare('SELECT * FROM training_log WHERE id = ?').get(id));
  });

  fastify.delete('/api/training-log/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM training_log WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'entrada nao encontrada' });
    return { ok: true };
  });
}

module.exports = routes;
