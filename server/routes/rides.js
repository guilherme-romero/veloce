/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/rides (passeios planejados)
   GET    /api/rides          lista ordenada por data
   POST   /api/rides          cria
   PUT    /api/rides/:id      atualiza (patch)
   DELETE /api/rides/:id      remove
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

const DIFICULDADES = ['baixa', 'media', 'alta'];

function rowToRide(r) {
  return {
    id:          r.id,
    data:        r.data,
    destino:     r.destino || '',
    distancia:   r.distancia ?? 0,
    altitude:    r.altitude ?? 0,
    duracao:     r.duracao || '',
    dificuldade: r.dificuldade || 'media',
    nota:        r.nota ?? 0,
    notas:       r.notas || '',
    createdAt:   r.created_at,
  };
}

function normalize(input) {
  const r = input || {};
  return {
    data:        String(r.data || ''),
    destino:     String(r.destino || ''),
    distancia:   isFinite(parseFloat(r.distancia)) ? parseFloat(r.distancia) : 0,
    altitude:    isFinite(parseInt(r.altitude, 10)) ? parseInt(r.altitude, 10) : 0,
    duracao:     String(r.duracao || ''),
    dificuldade: DIFICULDADES.includes(r.dificuldade) ? r.dificuldade : 'media',
    nota:        Math.max(0, Math.min(5, parseInt(r.nota, 10) || 0)),
    notas:       String(r.notas || ''),
  };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/rides', async () => {
    return fastify.db
      .prepare('SELECT * FROM rides ORDER BY data ASC, id ASC')
      .all()
      .map(rowToRide);
  });

  fastify.post('/api/rides', async (req, reply) => {
    const body = req.body || {};
    if (!body.id || !body.data) return reply.code(400).send({ error: 'id e data obrigatorios' });
    const n = normalize(body);
    try {
      fastify.db.prepare(`INSERT INTO rides
        (id, data, destino, distancia, altitude, duracao, dificuldade, nota, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(body.id, n.data, n.destino, n.distancia, n.altitude, n.duracao, n.dificuldade, n.nota, n.notas);
    } catch (e) {
      return reply.code(409).send({ error: 'ride ja existe' });
    }
    const row = fastify.db.prepare('SELECT * FROM rides WHERE id = ?').get(body.id);
    return reply.code(201).send(rowToRide(row));
  });

  fastify.put('/api/rides/:id', async (req, reply) => {
    const { id } = req.params;
    const cur = fastify.db.prepare('SELECT * FROM rides WHERE id = ?').get(id);
    if (!cur) return reply.code(404).send({ error: 'ride nao encontrado' });
    const merged = { ...rowToRide(cur), ...(req.body || {}) };
    const n = normalize(merged);
    fastify.db.prepare(`UPDATE rides SET
      data = ?, destino = ?, distancia = ?, altitude = ?, duracao = ?,
      dificuldade = ?, nota = ?, notas = ? WHERE id = ?`)
      .run(n.data, n.destino, n.distancia, n.altitude, n.duracao, n.dificuldade, n.nota, n.notas, id);
    return rowToRide(fastify.db.prepare('SELECT * FROM rides WHERE id = ?').get(id));
  });

  fastify.delete('/api/rides/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM rides WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'ride nao encontrado' });
    return { ok: true };
  });
}

module.exports = routes;
