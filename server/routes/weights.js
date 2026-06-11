/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/weights (pesagens)
   GET    /api/weights        lista ordenada por data ASC
   POST   /api/weights        cria pesagem { data, peso, tipo }
   DELETE /api/weights/:id    remove pesagem por id
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

const TIPOS_VALIDOS = ['atual', 'historico'];

function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function routes(fastify) {
  // Todas as rotas exigem autenticação
  fastify.addHook('preHandler', requireAuth);

  // ── GET /api/weights ──────────────────────────────────────────────
  fastify.get('/api/weights', async () => {
    const rows = fastify.db
      .prepare('SELECT id, data, peso, tipo, created_at FROM weights ORDER BY data ASC, id ASC')
      .all();
    return rows.map(r => ({
      id: r.id,
      data: r.data,
      peso: r.peso,
      tipo: r.tipo,
      createdAt: r.created_at,
    }));
  });

  // ── POST /api/weights ─────────────────────────────────────────────
  fastify.post('/api/weights', async (req, reply) => {
    const { data, peso, tipo } = req.body || {};

    if (!isISODate(data)) {
      return reply.code(400).send({ error: 'data inválida (use YYYY-MM-DD)' });
    }
    const pesoNum = Number(peso);
    if (!isFinite(pesoNum) || pesoNum <= 0 || pesoNum > 500) {
      return reply.code(400).send({ error: 'peso inválido' });
    }
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return reply.code(400).send({ error: 'tipo inválido (atual|historico)' });
    }

    const info = fastify.db
      .prepare('INSERT INTO weights (data, peso, tipo) VALUES (?, ?, ?)')
      .run(data, pesoNum, tipo);

    const row = fastify.db
      .prepare('SELECT id, data, peso, tipo, created_at FROM weights WHERE id = ?')
      .get(info.lastInsertRowid);

    return reply.code(201).send({
      id: row.id,
      data: row.data,
      peso: row.peso,
      tipo: row.tipo,
      createdAt: row.created_at,
    });
  });

  // ── DELETE /api/weights/:id ───────────────────────────────────────
  fastify.delete('/api/weights/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'id inválido' });
    }
    const info = fastify.db.prepare('DELETE FROM weights WHERE id = ?').run(id);
    if (info.changes === 0) {
      return reply.code(404).send({ error: 'pesagem não encontrada' });
    }
    return { ok: true };
  });
}

module.exports = routes;
