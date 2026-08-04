/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/component-types (tipos de componente custom "Outro (novo)")
   GET    /api/component-types        lista
   POST   /api/component-types        cria  { id, nome, vidaUtilKm? }
   PUT    /api/component-types/:id     edita { nome?, vidaUtilKm? }  (corrige digitação)
   DELETE /api/component-types/:id     remove
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

const NOME_MAX = 60;

function rowToType(r) {
  return { id: r.id, nome: r.nome || '', vidaUtilKm: r.vida_util_km ?? null, createdAt: r.created_at };
}

function cleanNome(v) {
  return String(v == null ? '' : v).trim().slice(0, NOME_MAX);
}
function cleanVida(v) {
  const x = parseFloat(v);
  return isFinite(x) && x > 0 ? x : null;
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/component-types', async () => {
    return fastify.db
      .prepare('SELECT * FROM custom_component_types ORDER BY nome COLLATE NOCASE ASC')
      .all()
      .map(rowToType);
  });

  fastify.post('/api/component-types', async (req, reply) => {
    const body = req.body || {};
    const nome = cleanNome(body.nome);
    if (!body.id || !nome) return reply.code(400).send({ error: 'id e nome obrigatorios' });
    try {
      fastify.db.prepare(
        'INSERT INTO custom_component_types (id, nome, vida_util_km) VALUES (?, ?, ?)'
      ).run(String(body.id), nome, cleanVida(body.vidaUtilKm));
    } catch (e) {
      return reply.code(409).send({ error: 'tipo ja existe' });
    }
    return reply.code(201).send(rowToType(
      fastify.db.prepare('SELECT * FROM custom_component_types WHERE id = ?').get(body.id)
    ));
  });

  fastify.put('/api/component-types/:id', async (req, reply) => {
    const { id } = req.params;
    const cur = fastify.db.prepare('SELECT * FROM custom_component_types WHERE id = ?').get(id);
    if (!cur) return reply.code(404).send({ error: 'tipo nao encontrado' });
    const body = req.body || {};
    const nome = body.nome !== undefined ? cleanNome(body.nome) : (cur.nome || '');
    if (!nome) return reply.code(400).send({ error: 'nome obrigatorio' });
    const vida = body.vidaUtilKm !== undefined ? cleanVida(body.vidaUtilKm) : cur.vida_util_km;
    fastify.db.prepare('UPDATE custom_component_types SET nome = ?, vida_util_km = ? WHERE id = ?')
      .run(nome, vida, id);
    return rowToType(fastify.db.prepare('SELECT * FROM custom_component_types WHERE id = ?').get(id));
  });

  fastify.delete('/api/component-types/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM custom_component_types WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'tipo nao encontrado' });
    return { ok: true };
  });
}

module.exports = routes;
