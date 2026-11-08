'use strict';
// Histórico do Treino IA (#137): paginação, favoritos e teto de 30
// não-favoritados.
//
// Mesmo molde de tests/treino-ia-job.test.js: env ANTES dos requires (config e
// db-init leem no 1º require) e SQLite temporário — nunca o banco de produção.
// As funções do service recebem `db` por parâmetro, então dá para exercitá-las
// direto, sem subir rota.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-hist-plan-'));
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASS_HASH = '$2b$12$ZSJrjrNAiKHPNUWEbcoteeCmdEQXDRVhfz7fbTPIxpQRWGzHilBT2';
process.env.JWT_SECRET = 'test-secret';
process.env.DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'training.db');

const db = require('../server/db/init.js');
const svc = require('../server/services/weekly-training-plan.js');

test.after(() => {
  try { db.close(); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

// ── helpers ─────────────────────────────────────────────────────────────
const limpar = () => db.prepare('DELETE FROM weekly_training_plans').run();
const inserir = ({ ativo = 0, favorito = 0, objetivo = 'obj' } = {}) =>
  db.prepare('INSERT INTO weekly_training_plans (ativo, favorito, payload) VALUES (?,?,?)')
    .run(ativo, favorito, JSON.stringify({ objetivo })).lastInsertRowid;
const contar = () => db.prepare('SELECT COUNT(*) AS n FROM weekly_training_plans').get().n;

// ── a migração em si ────────────────────────────────────────────────────
test('migração: coluna favorito existe e nasce com 0', () => {
  // A tabela nunca tinha sido migrada antes da #137 — esta é a 1ª coluna nova.
  const cols = db.prepare('PRAGMA table_info(weekly_training_plans)').all().map((c) => c.name);
  assert.ok(cols.includes('favorito'), `colunas: ${cols.join(',')}`);
  limpar();
  const id = db.prepare("INSERT INTO weekly_training_plans (ativo, payload) VALUES (0, '{}')").run().lastInsertRowid;
  assert.equal(db.prepare('SELECT favorito FROM weekly_training_plans WHERE id = ?').get(id).favorito, 0,
    'DEFAULT 0 — plano antigo não vira favorito por acidente na migração');
});

// ── paginação ───────────────────────────────────────────────────────────
test('lerHistorico: 5 por página por padrão, com total e totalPaginas', () => {
  limpar();
  for (let i = 0; i < 12; i++) inserir({ objetivo: `plano ${i}` });
  const p1 = svc.lerHistorico(db);
  assert.equal(p1.itens.length, 5);
  assert.equal(p1.total, 12);
  assert.equal(p1.pagina, 1);
  assert.equal(p1.limite, 5);
  assert.equal(p1.totalPaginas, 3, '12 itens / 5 = 3 páginas');
});

test('lerHistorico: páginas não se sobrepõem nem perdem item', () => {
  limpar();
  for (let i = 0; i < 12; i++) inserir({ objetivo: `plano ${i}` });
  const ids = [];
  for (let pag = 1; pag <= 3; pag++) ids.push(...svc.lerHistorico(db, { page: pag }).itens.map((i) => i.id));
  assert.equal(ids.length, 12, 'as 3 páginas somam os 12 itens');
  assert.equal(new Set(ids).size, 12, 'nenhum id repetido entre páginas');
  // Mais recente primeiro: OFFSET só é estável porque id é AUTOINCREMENT.
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'ordem decrescente preservada entre páginas');
});

test('lerHistorico: última página pode vir incompleta', () => {
  limpar();
  for (let i = 0; i < 12; i++) inserir();
  assert.equal(svc.lerHistorico(db, { page: 3 }).itens.length, 2);
});

test('lerHistorico: página além do fim devolve lista vazia, não erro', () => {
  limpar();
  for (let i = 0; i < 3; i++) inserir();
  const r = svc.lerHistorico(db, { page: 99 });
  assert.deepEqual(r.itens, []);
  assert.equal(r.total, 3);
});

test('lerHistorico: parâmetros sujos caem no default em vez de quebrar', () => {
  limpar();
  for (let i = 0; i < 8; i++) inserir();
  for (const ruim of [undefined, null, 0, -5, 'abc', NaN, {}]) {
    const r = svc.lerHistorico(db, { page: ruim, limit: ruim });
    assert.equal(r.limite, 5, `limit=${JSON.stringify(ruim)}`);
    assert.equal(r.pagina, 1, `page=${JSON.stringify(ruim)}`);
  }
  // E o limite tem teto: query não pode pedir o banco inteiro.
  assert.equal(svc.lerHistorico(db, { limit: 9999 }).limite, 50);
});

test('lerHistorico: banco vazio devolve totalPaginas 1, não 0', () => {
  limpar();
  const r = svc.lerHistorico(db);
  assert.deepEqual(r.itens, []);
  assert.equal(r.total, 0);
  assert.equal(r.totalPaginas, 1, 'UI não deve renderizar "página 1 de 0"');
});

test('lerHistorico: expõe favorito e ativo, e payload corrompido não derruba', () => {
  limpar();
  const idFav = inserir({ favorito: 1, objetivo: 'favorito' });
  const idAtivo = inserir({ ativo: 1, objetivo: 'ativo' });
  db.prepare("INSERT INTO weekly_training_plans (ativo, payload) VALUES (0, 'não é json')").run();
  const itens = svc.lerHistorico(db).itens;
  assert.equal(itens.find((i) => i.id === idFav).favorito, true);
  assert.equal(itens.find((i) => i.id === idAtivo).ativo, true);
  assert.equal(itens[0].objetivo, '', 'payload corrompido → objetivo vazio, sem throw');
});

// ── favoritar ───────────────────────────────────────────────────────────
test('favoritarPlano: liga, desliga e persiste', () => {
  limpar();
  const id = inserir();
  assert.equal(svc.favoritarPlano(db, id, true), true);
  assert.equal(db.prepare('SELECT favorito FROM weekly_training_plans WHERE id=?').get(id).favorito, 1);
  assert.equal(svc.favoritarPlano(db, id, false), false);
  assert.equal(db.prepare('SELECT favorito FROM weekly_training_plans WHERE id=?').get(id).favorito, 0);
});

test('favoritarPlano: id inexistente sinaliza notFound (vira 404 na rota)', () => {
  limpar();
  assert.throws(() => svc.favoritarPlano(db, 99999, true), (e) => e.notFound === true);
});

// ── proteção contra exclusão ────────────────────────────────────────────
test('excluirPlano: favoritado NÃO é excluível', () => {
  limpar();
  const id = inserir({ favorito: 1 });
  assert.equal(svc.excluirPlano(db, id), false);
  assert.equal(contar(), 1, 'a linha continua lá');
});

test('excluirPlano: não-favoritado inativo é excluído normalmente', () => {
  limpar();
  const id = inserir();
  assert.equal(svc.excluirPlano(db, id), true);
  assert.equal(contar(), 0);
});

test('limparHistorico: preserva o ativo E os favoritados', () => {
  limpar();
  inserir({ ativo: 1 });
  inserir({ favorito: 1 });
  inserir({ favorito: 1 });
  inserir(); inserir(); inserir();          // 3 descartáveis
  const excluidos = svc.limparHistorico(db);
  assert.equal(excluidos, 3);
  assert.equal(contar(), 3, 'sobram o ativo + 2 favoritados');
  const restantes = svc.lerHistorico(db, { limit: 50 }).itens;
  assert.ok(restantes.every((i) => i.ativo || i.favorito), 'tudo que sobrou é ativo ou favorito');
});

// ── teto de 30 não-favoritados ──────────────────────────────────────────
test('podarHistorico: mantém no máximo 30 não-favoritados', () => {
  limpar();
  for (let i = 0; i < 45; i++) inserir();
  const removidos = svc.podarHistorico(db);
  assert.equal(removidos, 15);
  assert.equal(contar(), 30);
});

test('podarHistorico: favoritados e o ativo ficam FORA da conta e da poda', () => {
  limpar();
  inserir({ ativo: 1 });
  const favs = [inserir({ favorito: 1 }), inserir({ favorito: 1 }), inserir({ favorito: 1 })];
  for (let i = 0; i < 40; i++) inserir();
  svc.podarHistorico(db);
  // 30 não-favoritados inativos + 3 favoritos + 1 ativo
  assert.equal(contar(), 34);
  for (const id of favs) {
    assert.ok(db.prepare('SELECT id FROM weekly_training_plans WHERE id=?').get(id), `favorito ${id} sobreviveu`);
  }
  assert.ok(db.prepare('SELECT id FROM weekly_training_plans WHERE ativo=1').get(), 'ativo sobreviveu');
});

test('podarHistorico: remove os MAIS ANTIGOS, preserva os mais recentes', () => {
  limpar();
  const ids = [];
  for (let i = 0; i < 35; i++) ids.push(inserir());
  svc.podarHistorico(db);
  const vivos = db.prepare('SELECT id FROM weekly_training_plans ORDER BY id').all().map((r) => r.id);
  assert.equal(vivos.length, 30);
  assert.deepEqual(vivos, ids.slice(-30), 'sobraram exatamente os 30 últimos');
});

test('podarHistorico: abaixo do teto não remove nada', () => {
  limpar();
  for (let i = 0; i < 10; i++) inserir();
  assert.equal(svc.podarHistorico(db), 0);
  assert.equal(contar(), 10);
});

test('podarHistorico: 31 favoritados não são podados — o teto é só dos outros', () => {
  // O favorito é uma decisão explícita do usuário; o teto existe para conter
  // o acúmulo automático do job das segundas (#136), não para apagar escolha.
  limpar();
  for (let i = 0; i < 31; i++) inserir({ favorito: 1 });
  assert.equal(svc.podarHistorico(db), 0);
  assert.equal(contar(), 31);
});
