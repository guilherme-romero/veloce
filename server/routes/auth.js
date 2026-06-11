/* ═══════════════════════════════════════════════════════════════════════
   AUTH ROUTES — login, logout, me
═══════════════════════════════════════════════════════════════════════ */
const jwt = require('jsonwebtoken');
const config = require('../config');
const password = require('../utils/password');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');

const cookieOptions = () => ({
  httpOnly: true,
  secure:   config.COOKIE_SECURE,
  sameSite: 'strict',
  path:     '/',
  maxAge:   config.SESSION_DAYS * 24 * 60 * 60, // segundos
});

async function routes(fastify) {
  fastify.post('/api/auth/login', async (req, reply) => {
    const { user, pass } = req.body || {};
    if (!user || !pass) {
      return reply.code(400).send({ error: 'Usuario e senha sao obrigatorios' });
    }

    // Sempre executa bcrypt mesmo se username errado — evita timing attack
    // (username errado retornaria instantaneamente sem o hash, revelando
    // qual username existe por diferença de tempo de resposta)
    const ok = (user === config.ADMIN_USER)
             && await password.verify(pass, config.ADMIN_PASS_HASH);
    if (!ok) {
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
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: req.user.user };
  });
}

module.exports = routes;
