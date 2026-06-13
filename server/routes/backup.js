/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/backup (Fase 12.2.2)
   GET /api/backup/data-zip  → baixa training.db + avatars/ em ZIP
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { requireAuth } = require('../middleware/auth');

const DATA_DIR    = path.resolve(__dirname, '..', '..', 'data');
const DB_FILE     = path.join(DATA_DIR, 'training.db');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/backup/data-zip', async (req, reply) => {
    // Força checkpoint do WAL antes de copiar o .db (garante dados flushed)
    try { fastify.db.pragma('wal_checkpoint(TRUNCATE)'); }
    catch (e) { req.log.warn({ err: e }, 'wal_checkpoint pre-zip falhou'); }

    const filename = `treino-bike-data-${todayISO()}.zip`;
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') req.log.warn({ err }, 'archiver warning');
    });
    archive.on('error', (err) => {
      req.log.error({ err }, 'archiver error');
      reply.raw.destroy(err);
    });

    archive.pipe(reply.raw);

    // training.db (sempre incluído)
    if (fs.existsSync(DB_FILE)) {
      archive.file(DB_FILE, { name: 'training.db' });
    }

    // avatars/ (se existir)
    if (fs.existsSync(AVATARS_DIR)) {
      archive.directory(AVATARS_DIR, 'avatars');
    }

    // METADATA legível
    archive.append(JSON.stringify({
      app: 'treino-bike',
      version: require('../package.json').version,
      exportedAt: new Date().toISOString(),
      contents: ['training.db', 'avatars/'],
      excluded: ['garmin_session/ (tokens sensiveis)'],
    }, null, 2), { name: 'METADATA.json' });

    await archive.finalize();
    return reply;
  });
}

module.exports = routes;
