'use strict';
// Regressão do caminho de UPGRADE do banco (#137).
//
// Por que este arquivo existe: tests/weekly-plan-historico.test.js cria um
// SQLite vazio, e num banco novo o CREATE TABLE já traz `favorito` — então ele
// passa sem nunca exercitar a migração. O banco de produção é um banco que JÁ
// EXISTE, e ali a coluna só aparece via ALTER TABLE. A primeira versão da #137
// criava o índice de (favorito, id) dentro do schema-training.sql, que roda
// ANTES das migrações: num banco pré-#137 o boot morria com
// "no such column: favorito" — ou seja, a app inteira não subia no deploy.
//
// Aqui o banco é montado com o schema ANTIGO da tabela (4 colunas, sem
// favorito) e só depois db/init.js é carregado, reproduzindo o deploy real.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
// better-sqlite3 e' dependencia do server/, nao da raiz: resolvemos pelo
// caminho de modulos do server, como o proprio db/init.js faz.
const Database = require(require.resolve('better-sqlite3', { paths: [path.join(__dirname, '..', 'server')] }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-mig-fav-'));
const dbPath = path.join(dir, 'training.db');

// Banco "pré-#137": a tabela como era antes, sem `favorito`, com uma linha
// dentro — um plano que um usuário real já teria no histórico.
{
  const antigo = new Database(dbPath);
  antigo.exec(`
    CREATE TABLE weekly_training_plans (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ativo     INTEGER NOT NULL DEFAULT 1,
      payload   TEXT NOT NULL,
      gerado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_weekly_training_plans_ativo ON weekly_training_plans(ativo);
  `);
  antigo.prepare("INSERT INTO weekly_training_plans (ativo, payload) VALUES (1, '{\"objetivo\":\"plano legado\"}')").run();
  antigo.close();
}

process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASS_HASH = '$2b$12$ZSJrjrNAiKHPNUWEbcoteeCmdEQXDRVhfz7fbTPIxpQRWGzHilBT2';
process.env.JWT_SECRET = 'test-secret';
process.env.DATA_DIR = dir;
process.env.DB_PATH = dbPath;

// Se a migração estiver fora de ordem, este require já lança — e é exatamente
// esse o modo de falha que o deploy veria.
const db = require('../server/db/init.js');

test.after(() => {
  try { db.close(); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test('banco pré-#137 sobe: a coluna favorito é adicionada no boot', () => {
  const cols = db.prepare('PRAGMA table_info(weekly_training_plans)').all().map((c) => c.name);
  assert.ok(cols.includes('favorito'), `colunas: ${cols.join(',')}`);
});

test('o índice de (favorito, id) é criado DEPOIS da coluna existir', () => {
  // O índice dentro do schema-training.sql era o bug: ali ele roda antes do
  // ALTER TABLE. Tem de existir no fim do boot, e sem derrubá-lo.
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='weekly_training_plans'")
    .all().map((r) => r.name);
  assert.ok(idx.includes('idx_weekly_training_plans_favorito'), `índices: ${idx.join(',')}`);
});

test('o plano que já existia sobrevive à migração, e não vira favorito', () => {
  const row = db.prepare('SELECT ativo, favorito, payload FROM weekly_training_plans WHERE id = 1').get();
  assert.equal(row.favorito, 0, 'DEFAULT 0 — migração não pode favoritar plano antigo');
  assert.equal(row.ativo, 1, 'o plano ativo continua ativo');
  assert.equal(JSON.parse(row.payload).objetivo, 'plano legado', 'payload intacto');
});

test('rodar o boot de novo é idempotente (duplicate column é tolerado)', () => {
  // Reinício do serviço no mesmo banco: o ALTER falha com "duplicate column"
  // e o init tem de engolir isso. Sem rodar o init 2x no mesmo processo (ele é
  // cacheado), reproduzimos as duas instruções na ordem do boot.
  assert.throws(() => db.exec('ALTER TABLE weekly_training_plans ADD COLUMN favorito INTEGER NOT NULL DEFAULT 0'),
    /duplicate column/i, 'é este erro que o catch do init filtra');
  db.exec('CREATE INDEX IF NOT EXISTS idx_weekly_training_plans_favorito ON weekly_training_plans(favorito, id)');
});

/* ── #160: tabela nova também precisa nascer em banco EXISTENTE ──────────
   `weekly_plan_tentativas` entrou pelo schema-training.sql, não pelas
   migrations — é legítimo, porque CREATE TABLE IF NOT EXISTS não depende de
   nenhuma coluna que as migrations criem depois. Mas "legítimo em teoria" é
   exatamente o que se assumiu na #137 antes do boot morrer em produção, então
   aqui vai a verificação no caminho de UPGRADE: este banco foi montado com o
   schema pré-#137, que não tinha esta tabela.                              */

test('#160: weekly_plan_tentativas é criada no boot de um banco pré-existente', () => {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weekly_plan_tentativas'").get();
  assert.ok(t, 'a tabela de tentativas falhas tem de existir depois do boot');

  // E tem de ser utilizável, não só existir: o DEFAULT do `quando` é o que
  // torna a trilha legível sem o service preencher nada.
  db.prepare("INSERT INTO weekly_plan_tentativas (erro) VALUES ('teste de upgrade')").run();
  const linha = db.prepare('SELECT quando, erro, detalhe FROM weekly_plan_tentativas ORDER BY id DESC LIMIT 1').get();
  assert.equal(linha.erro, 'teste de upgrade');
  assert.equal(linha.detalhe, null, 'detalhe é opcional');
  assert.match(linha.quando, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'CURRENT_TIMESTAMP do SQLite, em UTC');
});
