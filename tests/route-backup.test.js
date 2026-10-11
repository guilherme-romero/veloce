'use strict';
// Teste de integração do tratamento de ERRO das rotas de backup/restore e de
// training-log (Issue #38, parte 3 do PR #37 — converte os checks manuais de
// curl em cobertura automatizada). Contra o app real + SQLite temporário.
//
// Invariantes de segurança verificadas:
//  - mensagem genérica ao cliente (sem vazar stack/caminho interno);
//  - um restore malformado NÃO troca nem corrompe o banco.
const test = require('node:test');
const assert = require('node:assert');
const { buildTestApp, cleanup } = require('./app-harness.js');

let h, cookie;
test.before(() => { h = buildTestApp(); cookie = h.authCookie(); });
test.after(() => cleanup(h));

// Nenhuma mensagem de erro ao cliente deve vazar stack/caminho/identificador interno.
const semVazamento = (msg) => typeof msg === 'string'
  && !/\bat\s|Error:|\/home\/|node_modules|better-sqlite3|\.js:\d/.test(msg);

// A rota /restore tem rate-limit 2/5min por IP; cada caso usa um remoteAddress
// distinto para não compartilhar bucket (senão o 3º vira 429, não 400).
test('POST /api/backup/restore: corpo vazio → 400 genérico', async () => {
  const res = await h.app.inject({
    method: 'POST', url: '/api/backup/restore', remoteAddress: '10.0.0.1',
    headers: { cookie, 'content-type': 'application/zip' }, payload: Buffer.alloc(0),
  });
  assert.equal(res.statusCode, 400);
  assert.ok(semVazamento(res.json().error), res.json().error);
});

test('POST /api/backup/restore: não-ZIP (sem assinatura PK) → 400 genérico', async () => {
  const res = await h.app.inject({
    method: 'POST', url: '/api/backup/restore', remoteAddress: '10.0.0.2',
    headers: { cookie, 'content-type': 'application/zip' }, payload: Buffer.from('isto não é um zip'),
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /zip/i);
  assert.ok(semVazamento(res.json().error));
});

test('POST /api/backup/restore: ZIP malformado NÃO troca o banco (invariante)', async () => {
  // Semeia um dado sentinela: se o restore trocasse/corrompesse o banco, sumiria.
  const post = await h.app.inject({
    method: 'POST', url: '/api/weights', headers: { cookie },
    payload: { data: '2026-05-05', peso: 80, tipo: 'atual' },
  });
  assert.equal(post.statusCode, 201);
  const sentinelaId = post.json().id;

  // PK + lixo: passa da checagem de assinatura, mas o unzip falha.
  const res = await h.app.inject({
    method: 'POST', url: '/api/backup/restore', remoteAddress: '10.0.0.3',
    headers: { cookie, 'content-type': 'application/zip' },
    payload: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('lixo corrompido')]),
  });
  assert.equal(res.statusCode, 400);
  assert.ok(semVazamento(res.json().error));

  // Banco intacto: a sentinela continua lá.
  const get = await h.app.inject({ method: 'GET', url: '/api/weights', headers: { cookie } });
  assert.ok(get.json().some(w => w.id === sentinelaId), 'sentinela sobreviveu ao restore malformado');
});

test('POST /api/training-log: payload inválido → 400 genérico', async () => {
  for (const payload of [{}, { id: 'abc' }]) { // falta id e/ou data
    const res = await h.app.inject({
      method: 'POST', url: '/api/training-log', headers: { cookie }, payload,
    });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.ok(semVazamento(res.json().error), res.json().error);
  }
});

test('POST /api/backup/snapshot: gera snapshot com prefixo veloce-data- e lista', async () => {
  // Caminho feliz, determinístico. Também cobre a mudança do #16: snapshots
  // novos usam o prefixo veloce-data- (forçar o erro de escrita é dependente
  // de ambiente; o erro genérico já é coberto por restore + training-log).
  const res = await h.app.inject({ method: 'POST', url: '/api/backup/snapshot', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.match(body.file, /^veloce-data-\d{4}-\d{2}-\d{2}\.zip$/);

  const list = await h.app.inject({ method: 'GET', url: '/api/backup/list', headers: { cookie } });
  assert.ok(list.json().items.some(i => i.name === body.file), 'snapshot aparece na listagem');
});
