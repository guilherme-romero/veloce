/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/workouts (treinos por modo)
   GET    /api/workouts                lista tudo agrupado por mode_id
   GET    /api/workouts?mode_id=X      lista de um modo
   POST   /api/workouts                cria { id, modeId, ...payload }
   PUT    /api/workouts/:id            atualiza payload
   PUT    /api/workouts/mode/:modeId   substitui todos os workouts do modo (bulk)
   DELETE /api/workouts/:id            remove
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

function rowToWorkout(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload); } catch (_) {}
  return { ...payload, id: row.id, modeId: row.mode_id, ordem: row.ordem };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/workouts', async (req) => {
    const { mode_id } = req.query;
    if (mode_id) {
      const rows = fastify.db
        .prepare('SELECT id, mode_id, payload, ordem FROM workouts WHERE mode_id = ? ORDER BY ordem ASC')
        .all(mode_id);
      return rows.map(rowToWorkout);
    }
    const rows = fastify.db
      .prepare('SELECT id, mode_id, payload, ordem FROM workouts ORDER BY mode_id, ordem ASC')
      .all();
    const out = {};
    for (const r of rows) {
      const w = rowToWorkout(r);
      (out[r.mode_id] = out[r.mode_id] || []).push(w);
    }
    return out;
  });

  fastify.post('/api/workouts', async (req, reply) => {
    const { id, modeId, ordem, ...rest } = req.body || {};
    if (!id || !modeId) return reply.code(400).send({ error: 'id e modeId obrigatorios' });
    const payload = JSON.stringify({ ...rest, id });
    const ord = Number.isInteger(ordem) ? ordem : 0;
    try {
      fastify.db
        .prepare('INSERT INTO workouts (id, mode_id, payload, ordem) VALUES (?, ?, ?, ?)')
        .run(id, modeId, payload, ord);
    } catch (e) {
      return reply.code(409).send({ error: 'workout ja existe' });
    }
    return reply.code(201).send({ ...rest, id, modeId, ordem: ord });
  });

  fastify.put('/api/workouts/:id', async (req, reply) => {
    const { id } = req.params;
    const row = fastify.db.prepare('SELECT mode_id, payload, ordem FROM workouts WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ error: 'workout nao encontrado' });
    let current = {};
    try { current = JSON.parse(row.payload); } catch (_) {}
    const { modeId, ordem, ...rest } = req.body || {};
    const merged = { ...current, ...rest, id };
    const newPayload = JSON.stringify(merged);
    const newMode = modeId || row.mode_id;
    const newOrd  = Number.isInteger(ordem) ? ordem : row.ordem;
    fastify.db
      .prepare('UPDATE workouts SET mode_id = ?, payload = ?, ordem = ? WHERE id = ?')
      .run(newMode, newPayload, newOrd, id);
    return { ...merged, modeId: newMode, ordem: newOrd };
  });

  fastify.put('/api/workouts/mode/:modeId', async (req, reply) => {
    const { modeId } = req.params;
    const arr = req.body;
    if (!Array.isArray(arr)) return reply.code(400).send({ error: 'esperado array' });
    const trx = fastify.db.transaction((list) => {
      fastify.db.prepare('DELETE FROM workouts WHERE mode_id = ?').run(modeId);
      const stmt = fastify.db.prepare('INSERT INTO workouts (id, mode_id, payload, ordem) VALUES (?, ?, ?, ?)');
      list.forEach((w, i) => {
        if (!w || !w.id) return;
        const { id, modeId: _mid, ordem, ...rest } = w;
        stmt.run(id, modeId, JSON.stringify({ ...rest, id }), Number.isInteger(ordem) ? ordem : i);
      });
    });
    trx(arr);
    const rows = fastify.db
      .prepare('SELECT id, mode_id, payload, ordem FROM workouts WHERE mode_id = ? ORDER BY ordem ASC')
      .all(modeId);
    return rows.map(rowToWorkout);
  });

  fastify.delete('/api/workouts/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM workouts WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'workout nao encontrado' });
    return { ok: true };
  });
}

module.exports = routes;
