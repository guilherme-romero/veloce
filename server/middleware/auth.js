/* ═══════════════════════════════════════════════════════════════════════
   AUTH MIDDLEWARE — valida JWT no cookie httpOnly
═══════════════════════════════════════════════════════════════════════ */
const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = 'tb_session';

function requireAuth(req, reply, done) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    reply.code(401).send({ error: 'Nao autenticado' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.user = payload;
    done();
  } catch (err) {
    reply.code(401).send({ error: 'Sessao invalida ou expirada' });
  }
}

module.exports = { requireAuth, COOKIE_NAME };
