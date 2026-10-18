'use strict';
// Testes do digest de push da véspera (#3 F2). buildDigestPayload é puro;
// runDigest roda contra um SQLite temporário com stubs injetados de push e de
// previsão. Env setado ANTES dos requires (config/db-init leem no 1º require).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-digest-'));
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASS_HASH = '$2b$12$ZSJrjrNAiKHPNUWEbcoteeCmdEQXDRVhfz7fbTPIxpQRWGzHilBT2';
process.env.JWT_SECRET = 'test-secret';
process.env.VAPID_PUBLIC_KEY = 'pub';
process.env.VAPID_PRIVATE_KEY = 'priv';
process.env.DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'training.db');

const db = require('../server/db/init.js');
const pushDigest = require('../server/services/push-digest.js');

test.after(() => {
  try { db.close(); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

// ── buildDigestPayload (puro) ──────────────────────────────────────────
test('buildDigestPayload: 1 passeio com horário e clima', () => {
  const p = pushDigest.buildDigestPayload(
    [{ id: 'r1', horaInicio: '07:00', destino: 'Trilha X', distancia: 30 }],
    { label: '✅ Ideal' }
  );
  assert.equal(p.title, 'Pedal amanhã 🚴');
  assert.equal(p.body, 'Trilha X às 7h — clima ✅ Ideal');
  assert.equal(p.url, './#/passeios');
});

test('buildDigestPayload: vários passeios, um push só', () => {
  const p = pushDigest.buildDigestPayload([
    { id: 'r1', horaInicio: '07:30', destino: 'Serra' },
    { id: 'r2', horaInicio: '14:00', destino: 'Represa' },
  ], { label: 'Médio' });
  assert.equal(p.body, '2 passeios: Serra 7h30, Represa 14h — clima Médio');
});

test('buildDigestPayload: sem clima omite o sufixo', () => {
  const p = pushDigest.buildDigestPayload([{ id: 'r1', horaInicio: '', destino: 'Passeio sem hora' }], null);
  assert.equal(p.body, 'Passeio sem hora');
});

test('fmtHora: formatos', () => {
  assert.equal(pushDigest.fmtHora('07:00'), '7h');
  assert.equal(pushDigest.fmtHora('07:30'), '7h30');
  assert.equal(pushDigest.fmtHora('14:00'), '14h');
  assert.equal(pushDigest.fmtHora(''), '');
  assert.equal(pushDigest.fmtHora(null), '');
});

// ── runDigest (com stubs) ──────────────────────────────────────────────
function amanhaISO() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}
const okForecast = async () => {
  const iso = amanhaISO();
  return {
    time: [iso], weathercode: [1],
    temperature_2m_max: [28], temperature_2m_min: [18],
    apparent_temperature_max: [29], apparent_temperature_min: [17],
    precipitation_probability_max: [10], precipitation_sum: [0],
    wind_speed_10m_max: [12], windgusts_10m_max: [20], uv_index_max: [6],
    sunrise: [iso + 'T06:00'], sunset: [iso + 'T18:00'],
  };
};
const silent = { info() {}, warn() {}, error() {} };

test.beforeEach(() => {
  db.prepare('DELETE FROM rides').run();
  db.prepare('DELETE FROM push_sent').run();
});

test('runDigest: VAPID não configurado → skipped', async () => {
  const push = { isConfigured: () => false, sendToAll: async () => ({ sent: 0 }) };
  const r = await pushDigest.runDigest(db, silent, { push, getForecastDaily: okForecast });
  assert.equal(r.skipped, 'no-vapid');
});

test('runDigest: sem passeios amanhã → skipped', async () => {
  const push = { isConfigured: () => true, sendToAll: async () => ({ sent: 1 }) };
  const r = await pushDigest.runDigest(db, silent, { push, getForecastDaily: okForecast });
  assert.equal(r.skipped, 'no-rides');
});

test('runDigest: passeio amanhã + assinante → envia, marca e não repete', async () => {
  const iso = amanhaISO();
  db.prepare('INSERT INTO rides (id, data, destino, hora_inicio) VALUES (?, ?, ?, ?)')
    .run('r1', iso, 'Trilha X', '07:00');

  let enviado = null;
  const push = { isConfigured: () => true, sendToAll: async (_db, payload) => { enviado = payload; return { sent: 1, removed: 0, failed: 0 }; } };

  const r1 = await pushDigest.runDigest(db, silent, { push, getForecastDaily: okForecast });
  assert.equal(r1.sent, 1);
  assert.match(enviado.body, /Trilha X às 7h — clima/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_sent WHERE dia = ?').get(iso).c, 1);

  // Segunda rodada no mesmo dia: já notificado → pula, sem reenviar.
  enviado = null;
  const r2 = await pushDigest.runDigest(db, silent, { push, getForecastDaily: okForecast });
  assert.equal(r2.skipped, 'already-sent');
  assert.equal(enviado, null);

  // Passeio NOVO cadastrado depois do envio, no mesmo dia: ainda assim não sai
  // um 2º push hoje (requisito "no máximo 1 push/dia").
  db.prepare('INSERT INTO rides (id, data, destino, hora_inicio) VALUES (?, ?, ?, ?)')
    .run('r2', iso, 'Represa', '14:00');
  const r3 = await pushDigest.runDigest(db, silent, { push, getForecastDaily: okForecast });
  assert.equal(r3.skipped, 'already-sent');
  assert.equal(enviado, null);
});

test('runDigest: sem assinante (sent=0) não marca push_sent — tenta de novo', async () => {
  const iso = amanhaISO();
  db.prepare('INSERT INTO rides (id, data, destino, hora_inicio) VALUES (?, ?, ?, ?)')
    .run('r1', iso, 'Trilha X', '07:00');

  const push = { isConfigured: () => true, sendToAll: async () => ({ sent: 0, removed: 0, failed: 0 }) };
  const r1 = await pushDigest.runDigest(db, silent, { push, getForecastDaily: okForecast });
  assert.equal(r1.sent, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM push_sent').get().c, 0, 'não marca sem envio');

  // Reprocessa (não caiu em already-sent)
  const r2 = await pushDigest.runDigest(db, silent, { push, getForecastDaily: okForecast });
  assert.equal(r2.sent, 0);
});

test('runDigest: clima indisponível → envia sem veredito', async () => {
  const iso = amanhaISO();
  db.prepare('INSERT INTO rides (id, data, destino, hora_inicio) VALUES (?, ?, ?, ?)')
    .run('r1', iso, 'Trilha X', '07:00');

  let enviado = null;
  const push = { isConfigured: () => true, sendToAll: async (_db, payload) => { enviado = payload; return { sent: 1 }; } };
  const boom = async () => { throw new Error('open-meteo offline'); };

  const r = await pushDigest.runDigest(db, silent, { push, getForecastDaily: boom });
  assert.equal(r.sent, 1);
  assert.equal(enviado.body, 'Trilha X às 7h'); // sem sufixo de clima
});
