/* ═══════════════════════════════════════════════════════════════════════
   AUTH MIDDLEWARE — valida JWT no cookie httpOnly
═══════════════════════════════════════════════════════════════════════ */
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/init');

const COOKIE_NAME = config.COOKIE_NAME;

function lastLogoutAt() {
  try {
    const r = db.prepare('SELECT last_logout_at AS t FROM auth_state WHERE id=1').get();
    return r?.t || 0;
  } catch { return 0; }
}

function requireAuth(req, reply, done) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    reply.code(401).send({ error: 'Nao autenticado' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    // Revoga tokens emitidos antes do último logout (BUG-005).
    // Comparação estrita (<) permite que um novo login no mesmo segundo
    // do logout produza um token aceito (iat == last_logout_at).
    if (payload.iat && payload.iat < lastLogoutAt()) {
      reply.code(401).send({ error: 'Sessao revogada' });
      return;
    }
    req.user = payload;
    done();
  } catch (err) {
    reply.code(401).send({ error: 'Sessao invalida ou expirada' });
  }
}

module.exports = { requireAuth, COOKIE_NAME };
