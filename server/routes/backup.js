/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/backup
   GET  /api/backup/data-zip       → baixa training.db + avatars/ em ZIP (download direto)
   POST /api/backup/snapshot       → escreve snapshot em data/backups/ (Fase 13.1.1)
   GET  /api/backup/list           → lista snapshots disponíveis  (Fase 13.1.2)
   GET  /api/backup/file/:name     → download de snapshot específico (Fase 13.1.2)
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { requireAuth } = require('../middleware/auth');

const DATA_DIR    = path.resolve(__dirname, '..', '..', 'data');
const DB_FILE     = path.join(DATA_DIR, 'training.db');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const RETENTION   = 8;  // mantém últimos 8 snapshots (≈ 2 meses semanais)

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Cria pasta backups/ se não existir (idempotente)
function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// Lista snapshots ordenados do mais novo para o mais antigo
function listSnapshots() {
  ensureBackupsDir();
  return fs.readdirSync(BACKUPS_DIR)
    .filter(n => n.startsWith('treino-bike-data-') && n.endsWith('.zip'))
    .map(n => {
      const full = path.join(BACKUPS_DIR, n);
      const st = fs.statSync(full);
      return { name: n, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// Gera um ZIP no caminho informado (usado por snapshot CLI e endpoint POST)
function buildZipToFile(destPath, fastify) {
  return new Promise((resolve, reject) => {
    try { fastify.db.pragma('wal_checkpoint(TRUNCATE)'); }
    catch (e) { /* não fatal */ }

    const out = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    out.on('close', () => resolve({ path: destPath, size: archive.pointer() }));
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[snapshot] warn', err); });
    archive.on('error', reject);

    archive.pipe(out);
    if (fs.existsSync(DB_FILE))     archive.file(DB_FILE, { name: 'training.db' });
    if (fs.existsSync(AVATARS_DIR)) archive.directory(AVATARS_DIR, 'avatars');
    archive.append(JSON.stringify({
      app: 'treino-bike',
      version: require('../package.json').version,
      exportedAt: new Date().toISOString(),
      kind: 'snapshot',
      contents: ['training.db', 'avatars/'],
      excluded: ['garmin_session/ (tokens sensiveis)'],
    }, null, 2), { name: 'METADATA.json' });
    archive.finalize();
  });
}

// Apaga snapshots além dos mais recentes (mantém RETENTION)
function pruneSnapshots() {
  const list = listSnapshots();
  if (list.length <= RETENTION) return [];
  const toDelete = list.slice(RETENTION);
  for (const f of toDelete) {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, f.name)); }
    catch (e) { console.warn('[snapshot/prune]', f.name, e); }
  }
  return toDelete.map(f => f.name);
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // Download imediato (já existia)
  fastify.get('/api/backup/data-zip', async (req, reply) => {
    try { fastify.db.pragma('wal_checkpoint(TRUNCATE)'); }
    catch (e) { req.log.warn({ err: e }, 'wal_checkpoint pre-zip falhou'); }

    const filename = `treino-bike-data-${todayISO()}.zip`;
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('warning', (err) => { if (err.code !== 'ENOENT') req.log.warn({ err }, 'archiver warning'); });
    archive.on('error', (err) => req.log.error({ err }, 'archiver error'));

    if (fs.existsSync(DB_FILE))     archive.file(DB_FILE, { name: 'training.db' });
    if (fs.existsSync(AVATARS_DIR)) archive.directory(AVATARS_DIR, 'avatars');
    archive.append(JSON.stringify({
      app: 'treino-bike',
      version: require('../package.json').version,
      exportedAt: new Date().toISOString(),
      contents: ['training.db', 'avatars/'],
      excluded: ['garmin_session/ (tokens sensiveis)'],
    }, null, 2), { name: 'METADATA.json' });
    archive.finalize();

    return reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(archive);
  });

  // Cria snapshot no filesystem (chamado por timer ou via UI manualmente)
  fastify.post('/api/backup/snapshot', async (req, reply) => {
    ensureBackupsDir();
    const filename = `treino-bike-data-${todayISO()}.zip`;
    const fullPath = path.join(BACKUPS_DIR, filename);
    try {
      const result = await buildZipToFile(fullPath, fastify);
      const removed = pruneSnapshots();
      return { ok: true, file: filename, size: result.size, removed };
    } catch (err) {
      req.log.error({ err }, 'snapshot error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // Lista snapshots disponíveis
  fastify.get('/api/backup/list', async () => ({ items: listSnapshots() }));

  // Download de snapshot por nome (com proteção contra path traversal)
  fastify.get('/api/backup/file/:name', async (req, reply) => {
    const name = String(req.params.name || '');
    // Whitelist estrita: só nomes treino-bike-data-YYYY-MM-DD.zip
    if (!/^treino-bike-data-\d{4}-\d{2}-\d{2}\.zip$/.test(name)) {
      return reply.code(400).send({ error: 'nome inválido' });
    }
    const full = path.join(BACKUPS_DIR, name);
    // Segurança extra: confirma que resolve dentro de BACKUPS_DIR
    if (!full.startsWith(BACKUPS_DIR + path.sep)) {
      return reply.code(400).send({ error: 'path traversal' });
    }
    if (!fs.existsSync(full)) return reply.code(404).send({ error: 'não encontrado' });
    return reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .send(fs.createReadStream(full));
  });
}

// Exporta helpers para o script CLI standalone usar
module.exports = routes;
module.exports.buildZipToFile = buildZipToFile;
module.exports.pruneSnapshots = pruneSnapshots;
module.exports.listSnapshots  = listSnapshots;
module.exports.BACKUPS_DIR    = BACKUPS_DIR;
