#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   SNAPSHOT CLI — gera ZIP da base em data/backups/ sem passar por HTTP.
   Executado por systemd timer (veloce-backup.timer) semanalmente.

   Uso: node server/scripts/snapshot.js
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs   = require('fs');
const archiver = require('archiver');

const DATA_DIR    = path.resolve(__dirname, '..', '..', 'data');
const DB_FILE     = path.join(DATA_DIR, 'training.db');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const RETENTION   = 8;

function todayISO() { return new Date().toISOString().slice(0, 10); }

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function pruneSnapshots() {
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(n => /^(?:veloce|treino-bike)-data-.+\.zip$/.test(n))  // compat na transição (#16)
    .map(n => ({ name: n, mtime: fs.statSync(path.join(BACKUPS_DIR, n)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length <= RETENTION) return [];
  const removed = [];
  for (const f of files.slice(RETENTION)) {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, f.name)); removed.push(f.name); }
    catch (e) { console.warn('prune', f.name, e.message); }
  }
  return removed;
}

// Checkpoint WAL ANTES de copiar o .db, garantindo que dados pendentes estão flushed.
function walCheckpoint() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_FILE, { readonly: false });
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (e) {
    console.warn('[snapshot] wal_checkpoint falhou:', e.message);
  }
}

async function main() {
  ensureBackupsDir();
  walCheckpoint();

  const filename = `veloce-data-${todayISO()}.zip`;
  const dest     = path.join(BACKUPS_DIR, filename);
  if (fs.existsSync(dest)) {
    // Mesmo dia → sobrescreve (snapshot semanal, idempotente)
    fs.unlinkSync(dest);
  }

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    archive.on('warning', e => { if (e.code !== 'ENOENT') console.warn(e); });
    archive.on('error', reject);
    archive.pipe(out);
    if (fs.existsSync(DB_FILE))     archive.file(DB_FILE, { name: 'training.db' });
    if (fs.existsSync(AVATARS_DIR)) archive.directory(AVATARS_DIR, 'avatars');
    archive.append(JSON.stringify({
      app: 'veloce',
      version: require('../package.json').version,
      exportedAt: new Date().toISOString(),
      kind: 'snapshot',
      contents: ['training.db', 'avatars/'],
      excluded: ['garmin_session/ (tokens sensiveis)'],
    }, null, 2), { name: 'METADATA.json' });
    archive.finalize();
  });

  const size = fs.statSync(dest).size;
  const removed = pruneSnapshots();
  console.log(JSON.stringify({ ok: true, file: filename, size, removed }, null, 2));
}

main().catch(err => {
  console.error('[snapshot] FALHOU:', err);
  process.exit(1);
});
