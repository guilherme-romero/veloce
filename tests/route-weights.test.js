'use strict';
// Teste de integração de /api/weights (Issue #72 item 3) — CRUD + validação,
// contra o app Fastify real + SQLite temporário (isolado, nunca produção).
const test = require('node:test');
const assert = require('node:assert');
const { buildTestApp, cleanup } = require('./app-harness.js');

let h, cookie;
test.before(() => { h = buildTestApp(); cookie = h.authCookie(); });
test.after(() => cleanup(h));

test('GET /api/weights: sem autenticação → 401', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/weights' });
  assert.equal(res.statusCode, 401);
});

test('GET /api/weights: banco novo → lista vazia', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/weights', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
});

test('POST /api/weights: payloads inválidos → 400', async () => {
  const casos = [
    { data: '2026/01/01', peso: 80, tipo: 'atual' }, // data fora de YYYY-MM-DD
    { data: '2026-01-01', peso: 0, tipo: 'atual' },   // peso <= 0
    { data: '2026-01-01', peso: 80, tipo: 'xpto' },   // tipo inválido
  ];
  for (const payload of casos) {
    const res = await h.app.inject({ method: 'POST', url: '/api/weights', headers: { cookie }, payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
});

test('POST /api/weights: válido → 201 e aparece no GET', async () => {
  const post = await h.app.inject({
    method: 'POST', url: '/api/weights', headers: { cookie },
    payload: { data: '2026-02-10', peso: 78.5, tipo: 'atual' },
  });
  assert.equal(post.statusCode, 201);
  const criado = post.json();
  assert.equal(criado.data, '2026-02-10');
  assert.equal(criado.peso, 78.5);
  assert.equal(criado.tipo, 'atual');
  assert.equal(criado.fonte, 'manual'); // default
  assert.ok(criado.id > 0);

  const get = await h.app.inject({ method: 'GET', url: '/api/weights', headers: { cookie } });
  const lista = get.json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, criado.id);
});

test('DELETE /api/weights/:id: inexistente → 404; existente → ok e some do GET', async () => {
  const ausente = await h.app.inject({ method: 'DELETE', url: '/api/weights/999999', headers: { cookie } });
  assert.equal(ausente.statusCode, 404);

  // cria e apaga
  const post = await h.app.inject({
    method: 'POST', url: '/api/weights', headers: { cookie },
    payload: { data: '2026-03-01', peso: 77, tipo: 'historico' },
  });
  const id = post.json().id;
  const del = await h.app.inject({ method: 'DELETE', url: `/api/weights/${id}`, headers: { cookie } });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.json(), { ok: true });

  const get = await h.app.inject({ method: 'GET', url: '/api/weights', headers: { cookie } });
  assert.ok(!get.json().some(w => w.id === id), 'id apagado não aparece mais');
});

test('404 genérico para /api/* desconhecido', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/rota-que-nao-existe', headers: { cookie } });
  assert.equal(res.statusCode, 404);
  assert.match(res.json().error, /encontrada/i);
});
