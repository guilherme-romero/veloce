'use strict';
// Teste do serviço Telegram (Issue #95 Fase 2) — monta o multipart e trata a
// resposta da Bot API, com fetch mockado (sem rede). Config é singleton lido no
// 1º require, então o env tem de ser setado ANTES de requerer o serviço.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', 'server');

// Env mínimo p/ config.js não abortar + credenciais do Telegram.
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASS_HASH = '$2b$12$ZSJrjrNAiKHPNUWEbcoteeCmdEQXDRVhfz7fbTPIxpQRWGzHilBT2';
process.env.JWT_SECRET = 'test-secret-only-for-integration';
process.env.TELEGRAM_BOT_TOKEN = '123456:FAKE-TOKEN';
process.env.TELEGRAM_CHAT_ID = '999';

const telegram = require(path.join(SERVER_DIR, 'services', 'telegram.js'));

test('isConfigured: true com token + chat_id no env', () => {
  assert.equal(telegram.isConfigured(), true);
});

test('sendPhoto: sucesso → chama a Bot API e devolve messageId', async () => {
  let calledUrl = null, calledBody = null;
  global.fetch = async (url, opts) => {
    calledUrl = url; calledBody = opts.body;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
  };
  const res = await telegram.sendPhoto(Buffer.from('fake-png'), 'legenda');
  assert.equal(res.ok, true);
  assert.equal(res.messageId, 42);
  assert.ok(calledUrl.includes('/bot123456:FAKE-TOKEN/sendPhoto'), 'usa o token na URL');
  assert.ok(calledBody instanceof FormData, 'envia multipart (FormData)');
  assert.equal(calledBody.get('chat_id'), '999');
  assert.equal(calledBody.get('caption'), 'legenda');
});

test('sendPhoto: erro da Bot API → lança com a descrição', async () => {
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'chat not found' }) });
  await assert.rejects(() => telegram.sendPhoto(Buffer.from('x')), /chat not found/);
});
