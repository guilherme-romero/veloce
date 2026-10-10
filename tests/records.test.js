'use strict';
// Testes unitários de js/core/records.js (Issue #72 item 2) — formatação de
// valores de PR por type_id e montagem da lista de recordes. Lógica pura.
// (Usa toLocaleString/toLocaleDateString 'pt-BR' — Node tem ICU completo.)
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./core-load.js');

const { Records } = loadCore('records.js');
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('formatValue: ciclismo (type 8 distância, type 9 elevação)', () => {
  assert.equal(Records.formatValue(8, 42000, 'cycling'), '42,0 km');
  assert.equal(Records.formatValue(9, 1234, 'cycling'), '1.234 m');
});

test('formatValue: velocidade, cadência, tempo 40km, passos', () => {
  assert.equal(Records.formatValue(5, 10, 'cycling'), '36,0 km/h'); // 10 m/s × 3.6
  assert.equal(Records.formatValue(10, 95.4), '95 rpm');
  assert.equal(Records.formatValue(11, 3661), '1:01:01'); // h:mm:ss
  assert.equal(Records.formatValue(12, 15000), '15.000 passos');
});

test('formatValue: nulo → travessão; type 8 fora de ciclismo vira tempo', () => {
  assert.equal(Records.formatValue(8, 42000, null), '11h40m'); // sem ciclismo → formato de tempo
  assert.equal(Records.formatValue(8, 3661, 'running'), '1h01m');
  assert.equal(Records.formatValue(5, null), '—');
});

test('personalRecords: sem PRs e sem sintéticos → ok:false', () => {
  assert.deepEqual(Records.personalRecords([], null, null), { ok: false, linhas: [], total: 0, temNovo: false });
});

test('personalRecords: PR nativo de ciclismo (type 8) formatado e marcado como novo', () => {
  const r = Records.personalRecords(
    [{ type_id: 8, valor: 42000, activity_type: 'cycling', activity_name: 'Pedal longo', pr_date: daysAgo(10) }],
    null, null,
  );
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.equal(r.temNovo, true); // pr_date há 10 dias < 30
  assert.equal(r.linhas.length, 1);
  const l = r.linhas[0];
  assert.equal(l.label, 'Maior distância (ciclismo)'); // override de ciclismo p/ type 8
  assert.equal(l.valor, '42,0 km');
  assert.equal(l.sintetica, false);
  assert.equal(l.isNew, true);
  assert.match(l.meta, /Pedal longo/);
});

test('personalRecords: filtra type_ids não permitidos e type 8/9 de corrida', () => {
  const r = Records.personalRecords([
    { type_id: 5, valor: 10, activity_type: 'cycling' },            // não está em ALLOWED (8,9,11)
    { type_id: 8, valor: 1000, activity_type: 'running' },          // type 8 mas não ciclismo
    { type_id: 8, valor: 50000, activity_type: 'cycling', pr_date: daysAgo(100) },
  ], null, null);
  assert.equal(r.total, 1); // só o type 8 de ciclismo sobrevive
  assert.equal(r.linhas.length, 1);
  assert.equal(r.temNovo, false); // o válido tem 100 dias
});

test('personalRecords: linhas sintéticas (semanal + VO2máx) sem PRs nativos', () => {
  const r = Records.personalRecords(
    [],
    { max: { value: 52.4, date: '2026-01-02' } },
    { elevacao: { value: 500, weekStart: '2026-01-05' }, distancia: { value: 120000, weekStart: '2026-01-05' } },
  );
  assert.equal(r.ok, true);
  assert.equal(r.total, 3); // elevação + distância + vo2max
  const labels = r.linhas.map(l => l.label);
  assert.ok(labels.includes('Maior elevação semanal'));
  assert.ok(labels.includes('Maior distância semanal'));
  assert.ok(labels.includes('Melhor VO2máx estimado'));
  assert.ok(r.linhas.every(l => l.sintetica === true));
  const vo2 = r.linhas.find(l => l.label === 'Melhor VO2máx estimado');
  assert.equal(vo2.valor, '52 mL/kg/min');
  const dist = r.linhas.find(l => l.label === 'Maior distância semanal');
  assert.equal(dist.valor, '120,0 km');
});
