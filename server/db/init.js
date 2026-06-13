/* ═══════════════════════════════════════════════════════════════════════
   DB INIT — abre/cria training.db e roda schema
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'training.db');
const SCHEMA   = path.join(__dirname, 'schema-training.sql');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Aplica o schema (todas as instrucoes sao idempotentes via IF NOT EXISTS)
const schemaSQL = fs.readFileSync(SCHEMA, 'utf8');
db.exec(schemaSQL);

// Migrações idempotentes para bancos existentes (ALTER TABLE não pode usar
// IF NOT EXISTS em SQLite, então capturamos o erro de coluna duplicada).
const migrations = [
  'ALTER TABLE garmin_activities ADD COLUMN polyline TEXT',
  // BUG-016: separa contagem total vs bike no meta de sync
  'ALTER TABLE garmin_sync_meta ADD COLUMN last_total_count INTEGER',
];
for (const sql of migrations) {
  try { db.exec(sql); }
  catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
}

// PRAGMA integrity_check — aborta o boot se o banco estiver corrompido.
// simple:false retorna array de linhas; banco íntegro = 1 linha "ok".
const integrityRows = db.pragma('integrity_check', { simple: false });
const integrityOk = Array.isArray(integrityRows)
  && integrityRows.length === 1
  && integrityRows[0]?.integrity_check === 'ok';
if (!integrityOk) {
  console.error('[db] FATAL: integrity_check falhou — resposta:', integrityRows);
  process.exit(1);
}

// WAL checkpoint(TRUNCATE) no boot — força flush do WAL para o .db principal
// e zera o arquivo .db-wal. Evita acúmulo do WAL entre reinícios.
try {
  db.pragma('wal_checkpoint(TRUNCATE)');
} catch (e) {
  console.warn('[db] wal_checkpoint falhou (não-fatal):', e.message);
}

console.log(`[db] training.db pronto em ${DB_PATH} (integrity=ok, wal flushed)`);

module.exports = db;
