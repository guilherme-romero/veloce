/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/modes (modos de treino)
   GET    /api/modes              lista ordenada
   POST   /api/modes              cria { id, nome, ordem? }
   PUT    /api/modes/:id          atualiza { nome?, ordem? }
   PUT    /api/modes              substitui o array inteiro (bulk)
   DELETE /api/modes/:id          remove (cascade nos workouts)
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

// Id de modo e' gerado no cliente ('mode_<base36>', js/storage.js) e vai parar
// dentro de atributos HTML na tela "Gerenciar modos de treino". Sem formato
// fixo, um backup importado com id contendo aspas quebrava o atributo
// (BUG-057). Formato conservador: cobre todos os ids ja existentes.
const MODE_ID_RE = /^[\w:-]{1,64}$/;
const validModeId = (id) => typeof id === 'string' && MODE_ID_RE.test(id);

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/modes', async () => {
    return fastify.db
      .prepare('SELECT id, nome, ordem FROM modes ORDER BY ordem ASC, id ASC')
      .all();
  });

  fastify.post('/api/modes', async (req, reply) => {
    const { id, nome, ordem } = req.body || {};
    if (!validModeId(id)) return reply.code(400).send({ error: 'id invalido' });
    if (!nome || typeof nome !== 'string') return reply.code(400).send({ error: 'nome obrigatorio' });
    const ord = Number.isInteger(ordem) ? ordem : 0;
    try {
      fastify.db.prepare('INSERT INTO modes (id, nome, ordem) VALUES (?, ?, ?)').run(id, nome, ord);
    } catch (e) {
      return reply.code(409).send({ error: 'modo ja existe' });
    }
    return reply.code(201).send({ id, nome, ordem: ord });
  });

  fastify.put('/api/modes/:id', async (req, reply) => {
    const { id } = req.params;
    const { nome, ordem } = req.body || {};
    const sets = [];
    const args = [];
    if (typeof nome === 'string')  { sets.push('nome = ?');  args.push(nome); }
    if (Number.isInteger(ordem))   { sets.push('ordem = ?'); args.push(ordem); }
    if (!sets.length) return reply.code(400).send({ error: 'nada para atualizar' });
    args.push(id);
    const info = fastify.db.prepare(`UPDATE modes SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    if (info.changes === 0) return reply.code(404).send({ error: 'modo nao encontrado' });
    return fastify.db.prepare('SELECT id, nome, ordem FROM modes WHERE id = ?').get(id);
  });

  fastify.put('/api/modes', async (req, reply) => {
    const arr = req.body;
    if (!Array.isArray(arr)) return reply.code(400).send({ error: 'esperado array' });
    if (arr.length === 0) return reply.code(400).send({ error: 'array nao pode ser vazio' });
    // Valida ANTES da transacao: ela comeca com DELETE FROM modes, entao id
    // invalido descartado no meio do laco apagaria o modo em silencio.
    const ruim = arr.findIndex((m) => !m || !validModeId(m.id) || !m.nome);
    if (ruim >= 0) {
      return reply.code(400).send({ error: `modes[${ruim}]: id ou nome invalido` });
    }
    const trx = fastify.db.transaction((modes) => {
      fastify.db.prepare('DELETE FROM modes').run();
      const stmt = fastify.db.prepare('INSERT INTO modes (id, nome, ordem) VALUES (?, ?, ?)');
      modes.forEach((m, i) => {
        stmt.run(m.id, m.nome, Number.isInteger(m.ordem) ? m.ordem : i);
      });
    });
    trx(arr);
    return fastify.db.prepare('SELECT id, nome, ordem FROM modes ORDER BY ordem ASC, id ASC').all();
  });

  fastify.delete('/api/modes/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM modes WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'modo nao encontrado' });
    return { ok: true };
  });
}

module.exports = routes;
