'use strict';
// Teste de integração de /api/push (#3 Nível B — F1): vapid-public-key +
// subscribe (upsert) + unsubscribe, contra o app Fastify real + SQLite
// temporário. VAPID_* são setados ANTES do buildTestApp (config lê o env no 1º
// require) para o endpoint da chave pública responder como "configurado".
const test = require('node:test');
const assert = require('node:assert');

process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

const { buildTestApp, cleanup } = require('./app-harness.js');

let h, cookie;
test.before(() => { h = buildTestApp(); cookie = h.authCookie(); });
test.after(() => cleanup(h));

const SUB = {
  endpoint: 'https://push.example.com/sub/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

test('GET /api/push/vapid-public-key: sem autenticação → 401', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
  assert.equal(res.statusCode, 401);
});

test('GET /api/push/vapid-public-key: configurado → devolve a chave', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/push/vapid-public-key', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().key, 'test-public-key');
});

test('POST /api/push/subscribe: body inválido → 400', async () => {
  const casos = [
    {},                                                                      // sem nada
    { endpoint: 'https://push.example.com/x', keys: {} },                    // keys vazias
    { endpoint: 'https://push.example.com/x', keys: { p256dh: 'só-um' } },   // auth faltando
    { endpoint: 'nao-e-url', keys: { p256dh: 'pk', auth: 'ak' } },           // endpoint não-URL
    { endpoint: 'http://push.example.com/x', keys: { p256dh: 'pk', auth: 'ak' } }, // http (não https) → SSRF guard
    { endpoint: { foo: 1 }, keys: { p256dh: 'pk', auth: 'ak' } },            // endpoint não-string
  ];
  for (const payload of casos) {
    const res = await h.app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie }, payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
});

test('POST /api/push/subscribe: válido → 201 e persiste', async () => {
  const res = await h.app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie }, payload: SUB });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json(), { ok: true });

  const row = h.app.db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(SUB.endpoint);
  assert.equal(row.p256dh, 'p256dh-key');
  assert.equal(row.auth, 'auth-key');
});

test('POST /api/push/subscribe: re-subscribe atualiza (upsert, sem duplicar)', async () => {
  const res = await h.app.inject({
    method: 'POST', url: '/api/push/subscribe', headers: { cookie },
    payload: { ...SUB, keys: { p256dh: 'novo-p256dh', auth: 'novo-auth' } },
  });
  assert.equal(res.statusCode, 201);

  const rows = h.app.db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').all(SUB.endpoint);
  assert.equal(rows.length, 1, 'não duplica o mesmo endpoint');
  assert.equal(rows[0].p256dh, 'novo-p256dh');
});

test('DELETE /api/push/subscribe: remove e é idempotente', async () => {
  const del = await h.app.inject({ method: 'DELETE', url: '/api/push/subscribe', headers: { cookie }, payload: { endpoint: SUB.endpoint } });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.json(), { ok: true });

  const row = h.app.db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(SUB.endpoint);
  assert.equal(row, undefined);

  // de novo → ainda ok (idempotente)
  const again = await h.app.inject({ method: 'DELETE', url: '/api/push/subscribe', headers: { cookie }, payload: { endpoint: SUB.endpoint } });
  assert.equal(again.statusCode, 200);
});

test('DELETE /api/push/subscribe: sem endpoint → 400', async () => {
  const res = await h.app.inject({ method: 'DELETE', url: '/api/push/subscribe', headers: { cookie }, payload: {} });
  assert.equal(res.statusCode, 400);
});
