/* ═══════════════════════════════════════════════════════════════════════
   AUTH ROUTES — login, logout, me
═══════════════════════════════════════════════════════════════════════ */
const jwt = require('jsonwebtoken');
const config = require('../config');
const password = require('../utils/password');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');

// Hash bcrypt fixo de uma senha aleatória — usado para igualar o custo de
// verify() quando o username não confere, evitando timing attack.
const DUMMY_HASH = '$2b$12$CwTycUXWue0Thq9StjUM0uJ8.5n2Bv6KZxLmZxe7HMNwG5RyP1cAa';

const cookieOptions = () => ({
  httpOnly: true,
  secure:   config.COOKIE_SECURE,
  sameSite: 'strict',
  path:     config.COOKIE_PATH,
  maxAge:   config.SESSION_DAYS * 24 * 60 * 60, // segundos
});

async function routes(fastify) {
  fastify.post('/api/auth/login', async (req, reply) => {
    const { user, pass } = req.body || {};
    if (!user || !pass) {
      return reply.code(400).send({ error: 'Usuario e senha sao obrigatorios' });
    }

    // Sempre executa bcrypt mesmo se username errado — evita timing attack.
    // Hash dummy garante custo constante: se username não confere, compara
    // contra um hash válido qualquer para igualar o tempo de resposta.
    const targetHash = (user === config.ADMIN_USER)
      ? config.ADMIN_PASS_HASH
      : DUMMY_HASH;
    const passOk  = await password.verify(pass, targetHash);
    const userOk  = (user === config.ADMIN_USER);
    if (!userOk || !passOk) {
      return reply.code(401).send({ error: 'Credenciais invalidas' });
    }

    const token = jwt.sign(
      { user: config.ADMIN_USER },
      config.JWT_SECRET,
      { expiresIn: `${config.SESSION_DAYS}d` }
    );

    reply.setCookie(COOKIE_NAME, token, cookieOptions());
    return { ok: true, user: config.ADMIN_USER };
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    // Invalida server-side: tokens emitidos antes deste timestamp serão
    // rejeitados pelo requireAuth, mesmo se exfiltrados.
    const now = Math.floor(Date.now() / 1000);
    fastify.db.prepare('UPDATE auth_state SET last_logout_at = ? WHERE id = 1').run(now);
    reply.clearCookie(COOKIE_NAME, { path: config.COOKIE_PATH });
    return { ok: true };
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: req.user.user };
  });
}

module.exports = routes;
