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

console.log(`[db] training.db pronto em ${DB_PATH}`);

module.exports = db;
