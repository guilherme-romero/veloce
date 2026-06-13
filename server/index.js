/* ═══════════════════════════════════════════════════════════════════════
   TREINO BIKE — Backend Fastify
═══════════════════════════════════════════════════════════════════════ */
const config = require('./config');
const fastify = require('fastify')({
  logger: { level: 'info' },
  trustProxy: true,   // confia em X-Forwarded-* (nginx)
  bodyLimit: 524288,  // 512 KB — avatar usa bodyLimit próprio de 5MB
});

// Cookies (httpOnly de sessao)
fastify.register(require('@fastify/cookie'), {
  secret: config.JWT_SECRET, // assinatura opcional, nao usada (JWT ja assina)
});

// DB — abre/cria training.db e expoe em fastify.db
const db = require('./db/init');
fastify.decorate('db', db);

// Rotas
fastify.register(require('./routes/auth'));
fastify.register(require('./routes/profile'));
fastify.register(require('./routes/weights'));
fastify.register(require('./routes/modes'));
fastify.register(require('./routes/workouts'));
fastify.register(require('./routes/rides'));
fastify.register(require('./routes/training-log'));
fastify.register(require('./routes/home-exercises'));
fastify.register(require('./routes/gpx-routes'));
fastify.register(require('./routes/strava'));
fastify.register(require('./routes/garmin'));
fastify.register(require('./routes/activities'));
fastify.register(require('./routes/bikes'));
fastify.register(require('./routes/weather'));
fastify.register(require('./routes/backup'));

// Health check (publico, util para o frontend checar se o backend esta up)
fastify.get('/api/health', async () => ({ ok: true, version: require('./package.json').version }));

// 404 generico para /api/*
fastify.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'Rota nao encontrada' });
  } else {
    reply.code(404).send({ error: 'Not found' });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: config.PORT, host: config.HOST });
    fastify.log.info(`Treino Bike API rodando em http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

// Shutdown limpo
process.on('SIGINT',  () => { fastify.log.info('SIGINT recebido'); fastify.close().then(() => process.exit(0)); });
process.on('SIGTERM', () => { fastify.log.info('SIGTERM recebido'); fastify.close().then(() => process.exit(0)); });
