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
];
for (const sql of migrations) {
  try { db.exec(sql); }
  catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
}

// PRAGMA integrity_check — aborta o boot se o banco estiver corrompido.
const integrity = db.pragma('integrity_check', { simple: true });
if (integrity !== 'ok') {
  console.error(`[db] FATAL: integrity_check falhou — resposta: ${integrity}`);
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
