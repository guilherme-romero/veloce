/* ═══════════════════════════════════════════════════════════════════════
   TREINO BIKE — Backend Fastify
═══════════════════════════════════════════════════════════════════════ */
const config = require('./config');
const fastify = require('fastify')({
  logger: { level: 'info' },
  // UM hop de proxy: o nginx local. Com `true`, o Fastify confiava na cadeia
  // inteira e tirava o req.ip da PRIMEIRA entrada de X-Forwarded-For — que o
  // nginx ANEXA ao valor mandado pelo cliente ($proxy_add_x_forwarded_for).
  // Dava para rotacionar o header e cair num bucket novo do rate-limit a cada
  // tentativa de login (BUG-058).
  // Precisa ser a CONTAGEM, nao uma lista de IPs confiaveis: como o nginx roda
  // no mesmo host, ele anexa 127.0.0.1: se o loopback estivesse na lista, o
  // proxy-addr seguiria andando na cadeia e chegaria ao valor forjado
  // (verificado na pratica). Com `1` ele para no primeiro hop, que e' o
  // endereco que o nginx realmente enxergou — fora do controle do cliente.
  trustProxy: 1,
  bodyLimit: 524288,  // 512 KB — avatar usa bodyLimit próprio de 5MB
});

// Cookies (httpOnly de sessao)
fastify.register(require('@fastify/cookie'), {
  secret: config.JWT_SECRET, // assinatura opcional, nao usada (JWT ja assina)
});

// CORS — restrito as origens conhecidas (hardening). Same-origin (nginx) nem
// precisa dos headers; requisicoes de outras origens sao recusadas.
fastify.register(require('@fastify/cors'), {
  origin: config.ALLOWED_ORIGINS,
  credentials: true,
});

// Rate-limit — registrado como opt-in (global:false). Só rotas que declaram
// `config.rateLimit` sao limitadas (hoje: POST /api/auth/login), para nao
// estrangular a API do app single-user.
fastify.register(require('@fastify/rate-limit'), {
  global: false,
});

// DB — abre/cria training.db e expoe em fastify.db
const db = require('./db/init');
fastify.decorate('db', db);

const { requireAuth } = require('./middleware/auth');

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
fastify.register(require('./routes/component-types'));
fastify.register(require('./routes/weather'));
fastify.register(require('./routes/backup'));
fastify.register(require('./routes/performance-analysis'));
fastify.register(require('./routes/weekly-training-plan'));

// Health check ampliado (Fase 13.3.1)
const path = require('path');
const fs   = require('fs');
const HEALTH_DATA_DIR    = path.resolve(__dirname, '..', 'data');
const HEALTH_DB_FILE     = path.join(HEALTH_DATA_DIR, 'training.db');
const HEALTH_BACKUPS_DIR = path.join(HEALTH_DATA_DIR, 'backups');

function _safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}
function _dirSize(dir) {
  try {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(full);
        else { const st = _safeStat(full); if (st) total += st.size; }
      }
    }
    return total;
  } catch { return null; }
}
function _diskFree(dir) {
  // statvfs não está exposto direto no Node; usa df -k para o filesystem do dir.
  // execFileSync (sem shell) + timeout previne /api/health de travar quando
  // FS está bloqueado (BUG-020) e evita qualquer risco de injeção.
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('df', ['-k', '--output=avail', dir], {
      encoding: 'utf8',
      timeout: 1000,
    });
    const lines = out.trim().split('\n');
    const kb = parseInt(lines[lines.length - 1].trim(), 10);
    return isNaN(kb) ? null : kb * 1024;
  } catch { return null; }
}
function _safeCount(sql) {
  try { return fastify.db.prepare(sql).get().c; } catch { return null; }
}

fastify.get('/api/health', { preHandler: requireAuth }, async () => {
  const version = require('./package.json').version;
  const dbStat = _safeStat(HEALTH_DB_FILE);

  // Contagens das tabelas principais
  const counts = {
    weights:        _safeCount('SELECT COUNT(*) AS c FROM weights'),
    rides:          _safeCount('SELECT COUNT(*) AS c FROM rides'),
    trainingLog:    _safeCount('SELECT COUNT(*) AS c FROM training_log'),
    routes:         _safeCount('SELECT COUNT(*) AS c FROM routes'),
    bikes:          _safeCount('SELECT COUNT(*) AS c FROM bikes'),
    stravaActs:     _safeCount('SELECT COUNT(*) AS c FROM strava_activities'),
    garminActs:     _safeCount('SELECT COUNT(*) AS c FROM garmin_activities'),
  };

  // Último sync Garmin/Strava (lê meta tables, tolera ausência)
  let lastGarminSync = null, lastStravaSync = null;
  try {
    const r = fastify.db.prepare('SELECT last_sync AS m FROM garmin_sync_meta WHERE id=1').get();
    lastGarminSync = r?.m || null;
  } catch {}
  try {
    const r = fastify.db.prepare('SELECT last_sync AS m FROM strava_sync_meta WHERE id=1').get();
    lastStravaSync = r?.m || null;
  } catch {}

  // Último snapshot
  let lastBackup = null;
  try {
    if (fs.existsSync(HEALTH_BACKUPS_DIR)) {
      const files = fs.readdirSync(HEALTH_BACKUPS_DIR)
        .filter(n => n.startsWith('treino-bike-data-') && n.endsWith('.zip'))
        .map(n => ({ name: n, mtime: fs.statSync(path.join(HEALTH_BACKUPS_DIR, n)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length) {
        const f = files[0];
        const ageDays = Math.floor((Date.now() - f.mtime.getTime()) / 86400000);
        lastBackup = { name: f.name, mtime: f.mtime.toISOString(), ageDays, count: files.length };
      }
    }
  } catch {}

  return {
    ok: true,
    version,
    db: {
      size: dbStat ? dbStat.size : null,
      mtime: dbStat ? dbStat.mtime.toISOString() : null,
    },
    counts,
    sync: {
      garminLast: lastGarminSync,
      stravaLast: lastStravaSync,
    },
    backup: lastBackup,
    disk: {
      dataDirSize: _dirSize(HEALTH_DATA_DIR),
      freeBytes: _diskFree(HEALTH_DATA_DIR),
    },
  };
});

// 404 generico para /api/*
fastify.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'Rota nao encontrada' });
  } else {
    reply.code(404).send({ error: 'Not found' });
  }
});

const scheduler = require('./scheduler');

const start = async () => {
  try {
    await fastify.listen({ port: config.PORT, host: config.HOST });
    fastify.log.info(`Treino Bike API rodando em http://${config.HOST}:${config.PORT}`);
    scheduler.setup(db, fastify.log);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

// Shutdown limpo
process.on('SIGINT',  () => { fastify.log.info('SIGINT recebido'); fastify.close().then(() => process.exit(0)); });
process.on('SIGTERM', () => { fastify.log.info('SIGTERM recebido'); fastify.close().then(() => process.exit(0)); });
