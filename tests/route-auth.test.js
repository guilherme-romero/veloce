'use strict';
// Teste de integração de /api/auth/* (Issue #72 item 3) — login, me, logout e
// revogação de sessão, contra o app Fastify real + SQLite temporário.
const test = require('node:test');
const assert = require('node:assert');
const { buildTestApp, cleanup } = require('./app-harness.js');

let h;
test.before(() => { h = buildTestApp(); });
test.after(() => cleanup(h));

test('POST /api/auth/login: payload incompleto → 400', async () => {
  const res = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { user: 'tester' } });
  assert.equal(res.statusCode, 400);
});

test('POST /api/auth/login: senha errada → 401 (sem cookie)', async () => {
  const res = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { user: h.creds.user, pass: 'errada' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.cookies.length, 0);
});

test('POST /api/auth/login: credenciais corretas → 200 + cookie de sessão', async () => {
  const res = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: h.creds });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, user: h.creds.user });
  const cookie = res.cookies.find(c => c.name === 'tb_session');
  assert.ok(cookie && cookie.value, 'setou o cookie tb_session');
  assert.equal(cookie.httpOnly, true);
});

test('GET /api/auth/me: sem cookie → 401', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(res.statusCode, 401);
});

test('GET /api/auth/me: com cookie válido → 200 + usuário', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: h.authCookie() } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { user: h.creds.user });
});

test('logout revoga tokens emitidos antes dele (BUG-005)', async () => {
  // logout grava last_logout_at = agora e invalida o cache de revogação.
  const logout = await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: h.authCookie() } });
  assert.equal(logout.statusCode, 200);

  // Token com iat anterior ao logout → rejeitado.
  const antigo = h.authCookie(h.creds.user, { iat: Math.floor(Date.now() / 1000) - 60 });
  const res = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: antigo } });
  assert.equal(res.statusCode, 401);
  assert.match(res.json().error, /revogada/i);
});
