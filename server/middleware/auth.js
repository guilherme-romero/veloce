/* ═══════════════════════════════════════════════════════════════════════
   AUTH MIDDLEWARE — valida JWT no cookie httpOnly
═══════════════════════════════════════════════════════════════════════ */
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/init');

const COOKIE_NAME = config.COOKIE_NAME;

// Cache do último logout: evita um SELECT por request autenticado. TTL curto
// (1s) + invalidação explícita no logout (invalidateLogoutCache) — a revogação
// continua imediata para o próprio dono.
const LOGOUT_TTL_MS = 1000;
let _logoutCache = { at: 0, ts: 0 };

function lastLogoutAt() {
  const now = Date.now();
  if (now - _logoutCache.ts < LOGOUT_TTL_MS) return _logoutCache.at;
  try {
    const r = db.prepare('SELECT last_logout_at AS t FROM auth_state WHERE id=1').get();
    _logoutCache = { at: r?.t || 0, ts: now };
  } catch { _logoutCache = { at: 0, ts: now }; }
  return _logoutCache.at;
}

// Chamada pela rota de logout logo após gravar last_logout_at, para que a
// revogação valha na próxima request sem esperar o TTL.
function invalidateLogoutCache() { _logoutCache.ts = 0; }

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

module.exports = { requireAuth, COOKIE_NAME, invalidateLogoutCache };
