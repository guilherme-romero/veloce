/* Harness dos testes de integração de rotas (Issue #72 item 3).
 *
 * Monta o app Fastify real (server/index.js → buildApp) contra um SQLite
 * TEMPORÁRIO e isolado, nunca o banco de produção. O schema é aplicado pelo
 * próprio db/init ao abrir o arquivo novo. Usa app.inject() — sem porta, sem
 * scheduler.
 *
 * Não termina em `.test.js`, então `node --test tests/*.test.js` não o executa
 * como suíte. Requer as deps do backend (fastify, better-sqlite3, jsonwebtoken,
 * bcrypt) em server/node_modules — por isso o CI roda `npm ci` em server/ antes
 * dos testes (ver .github/workflows). Cada arquivo de teste roda em processo
 * próprio (isolamento do node:test) e deve chamar buildTestApp() UMA vez: config
 * e db/init são singletons cacheados no 1º require, então o env tem de estar
 * setado antes disso.
 */
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

const SERVER_DIR = path.join(__dirname, '..', 'server');
// jsonwebtoken vive em server/node_modules — resolve a partir de lá para usar a
// MESMA lib (e assim o mesmo formato) que o middleware de auth verifica.
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER_DIR] }));

// Credenciais de teste. O hash é bcrypt (cost 12) de TEST_PASS, gerado com o
// próprio server/utils/password — senha descartável, não é segredo real.
const TEST_USER = 'tester';
const TEST_PASS = 'senha-teste-123';
const TEST_PASS_HASH = '$2b$12$ZSJrjrNAiKHPNUWEbcoteeCmdEQXDRVhfz7fbTPIxpQRWGzHilBT2';
const JWT_SECRET = 'test-secret-only-for-integration';
const COOKIE_NAME = 'tb_session';

/**
 * Sobe o app contra um DB temporário novo. Chamar UMA vez por arquivo de teste.
 * @returns {{ app, dir, dbPath, creds, authCookie }}
 */
function buildTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-itest-'));
  // Env ANTES de requerer o app (config/db-init leem no 1º require).
  process.env.ADMIN_USER = TEST_USER;
  process.env.ADMIN_PASS_HASH = TEST_PASS_HASH;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.COOKIE_SECURE = 'false';
  process.env.COOKIE_NAME = COOKIE_NAME;
  process.env.DATA_DIR = dir;
  process.env.DB_PATH = path.join(dir, 'training.db');

  const { buildApp } = require('../server/index.js');
  const app = buildApp({ logger: false });

  // Cookie de sessão forjado (mesma lib/segredo que o requireAuth verifica) —
  // testa rotas protegidas sem passar pelo login/bcrypt a cada caso. `iat` em
  // segundos pode ser forçado (ex.: token antigo para exercitar a revogação,
  // que usa comparação estrita iat < last_logout_at).
  const authCookie = (user = TEST_USER, { iat } = {}) => {
    const payload = iat != null ? { user, iat } : { user };
    return `${COOKIE_NAME}=${jwt.sign(payload, JWT_SECRET)}`;
  };

  return {
    app, dir, dbPath: process.env.DB_PATH, authCookie,
    creds: { user: TEST_USER, pass: TEST_PASS },
  };
}

/** Remove o DB temporário e fecha o app. Chamar no teardown. */
async function cleanup(h) {
  try { await h.app.close(); } catch (_) {}
  try { fs.rmSync(h.dir, { recursive: true, force: true }); } catch (_) {}
}

module.exports = { buildTestApp, cleanup, TEST_USER, TEST_PASS, COOKIE_NAME };
