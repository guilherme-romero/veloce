/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/home-exercises
   GET    /api/home-exercises          lista ordenada
   POST   /api/home-exercises          cria { id, nome, ...payload }
   PUT    /api/home-exercises/:id      atualiza
   PUT    /api/home-exercises          substitui o array inteiro (bulk)
   DELETE /api/home-exercises/:id      remove
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

function rowToExercise(r) {
  let payload = {};
  try { payload = JSON.parse(r.payload); } catch (_) {}
  return { ...payload, id: r.id, nome: r.nome, ordem: r.ordem };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/home-exercises', async () => {
    return fastify.db
      .prepare('SELECT * FROM home_exercises ORDER BY ordem ASC, id ASC')
      .all().map(rowToExercise);
  });

  fastify.post('/api/home-exercises', async (req, reply) => {
    const { id, nome, ordem, ...rest } = req.body || {};
    if (!id || !nome) return reply.code(400).send({ error: 'id e nome obrigatorios' });
    const ord = Number.isInteger(ordem) ? ordem : 0;
    try {
      fastify.db.prepare('INSERT INTO home_exercises (id, nome, payload, ordem) VALUES (?, ?, ?, ?)')
        .run(id, nome, JSON.stringify({ ...rest, id, nome }), ord);
    } catch (e) {
      return reply.code(409).send({ error: 'exercicio ja existe' });
    }
    return reply.code(201).send({ ...rest, id, nome, ordem: ord });
  });

  fastify.put('/api/home-exercises/:id', async (req, reply) => {
    const { id } = req.params;
    const cur = fastify.db.prepare('SELECT * FROM home_exercises WHERE id = ?').get(id);
    if (!cur) return reply.code(404).send({ error: 'exercicio nao encontrado' });
    const merged = { ...rowToExercise(cur), ...(req.body || {}), id };
    const { nome, ordem, ...rest } = merged;
    const ord = Number.isInteger(ordem) ? ordem : cur.ordem;
    fastify.db.prepare('UPDATE home_exercises SET nome = ?, payload = ?, ordem = ? WHERE id = ?')
      .run(nome, JSON.stringify(merged), ord, id);
    return merged;
  });

  fastify.put('/api/home-exercises', async (req, reply) => {
    const arr = req.body;
    if (!Array.isArray(arr)) return reply.code(400).send({ error: 'esperado array' });
    const trx = fastify.db.transaction((list) => {
      fastify.db.prepare('DELETE FROM home_exercises').run();
      const stmt = fastify.db.prepare('INSERT INTO home_exercises (id, nome, payload, ordem) VALUES (?, ?, ?, ?)');
      list.forEach((e, i) => {
        if (!e || !e.id || !e.nome) return;
        stmt.run(e.id, e.nome, JSON.stringify(e), Number.isInteger(e.ordem) ? e.ordem : i);
      });
    });
    trx(arr);
    return fastify.db.prepare('SELECT * FROM home_exercises ORDER BY ordem ASC, id ASC').all().map(rowToExercise);
  });

  fastify.delete('/api/home-exercises/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM home_exercises WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'exercicio nao encontrado' });
    return { ok: true };
  });
}

module.exports = routes;
