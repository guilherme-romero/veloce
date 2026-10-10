'use strict';
// Testes unitários de js/core/fatigue.js (Issue #72 item 2) — Índice de Fadiga
// (heurística) e Training Readiness (Garmin). Lógica pura.
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./core-load.js');

const { Fatigue } = loadCore('fatigue.js');

// Gera N dias idênticos com os campos dados (mais recente primeiro é indiferente
// aqui — todos iguais).
const dias = (n, campos) => Array.from({ length: n }, () => ({ ...campos }));

test('fatigueIndex: sem dados → ok:false', () => {
  assert.deepEqual(Fatigue.fatigueIndex([]), { ok: false });
  assert.deepEqual(Fatigue.fatigueIndex(null), { ok: false });
});

test('fatigueIndex: sem body_battery_drain ou stress → ok:false', () => {
  const r = Fatigue.fatigueIndex(dias(7, { hrv_noite_avg: 50 }));
  assert.equal(r.ok, false);
});

test('fatigueIndex: 2 fontes (sem HRV utilizável) → score e banda conhecidos', () => {
  // 7 dias: drain 30, max 80, stress 40. Sem baseline (só 7 dias) e sem semana
  // anterior → HRV entra neutro (50). bbi=37.5, stress=60, hrv=50 →
  // round(37.5·.40 + 50·.35 + 60·.25) = round(47.5) = 48 → Moderado/amber.
  const r = Fatigue.fatigueIndex(dias(7, { body_battery_drain: 30, body_battery_max: 80, stress_avg: 40, hrv_noite_avg: 50 }));
  assert.equal(r.ok, true);
  assert.equal(r.score, 48);
  assert.equal(r.status, 'Moderado');
  assert.equal(r.token, 'amber');
  assert.equal(r.fonteCount, 2);
  assert.match(r.msg, /2\/3 fontes/);
});

test('fatigueIndex: bandas de status por score', () => {
  // Carga leve → Recuperado/green. drain 10/max 90 → bbi≈11; stress 10 → 15.
  const leve = Fatigue.fatigueIndex(dias(7, { body_battery_drain: 10, body_battery_max: 90, stress_avg: 10, hrv_noite_avg: 60 }));
  assert.equal(leve.status, 'Recuperado');
  assert.equal(leve.token, 'green');
  // Carga pesada → Fadigado/red. drain 90/max 95 → bbi≈95; stress 70 → 100.
  const pesado = Fatigue.fatigueIndex(dias(7, { body_battery_drain: 90, body_battery_max: 95, stress_avg: 70, hrv_noite_avg: 40 }));
  assert.equal(pesado.status, 'Fadigado');
  assert.equal(pesado.token, 'red');
});

test('fatigueIndex: com baseline, HRV abaixo da baseline aumenta a fadiga (z-score)', () => {
  const base = { body_battery_drain: 40, body_battery_max: 80, stress_avg: 40 };
  // baseline (dias 7..34): HRV ~60 com leve variação (SD>0).
  const baseline = Array.from({ length: 28 }, (_, i) => ({ ...base, hrv_noite_avg: i % 2 ? 61 : 59 }));

  const recenteAbaixo = dias(7, { ...base, hrv_noite_avg: 45 }).concat(baseline);
  const recenteIgual = dias(7, { ...base, hrv_noite_avg: 60 }).concat(baseline);

  const rAbaixo = Fatigue.fatigueIndex(recenteAbaixo);
  const rIgual = Fatigue.fatigueIndex(recenteIgual);

  assert.equal(rAbaixo.ok, true);
  assert.equal(rAbaixo.fonteCount, 3); // usa as 3 fontes (baseline qualifica o HRV)
  assert.ok(['green', 'amber', 'red'].includes(rAbaixo.token));
  assert.ok(rAbaixo.score > rIgual.score, 'HRV abaixo da baseline → mais fadiga que HRV na baseline');
});

test('readiness: vazio → ok:false', () => {
  assert.deepEqual(Fatigue.readiness([]), { ok: false });
  assert.deepEqual(Fatigue.readiness('nope'), { ok: false });
});

test('readiness: pega o mais recente por data e mapeia o nível', () => {
  const r = Fatigue.readiness([
    { data: '2026-01-01', level: 'HIGH', score: 80, sleep_score: 90, recovery_time_min: 120, hrv_weekly_avg: 55 },
    { data: '2026-01-03', level: 'LOW', score: 30, sleep_score: 50, recovery_time_min: 1440, hrv_weekly_avg: 40 },
    { data: '2026-01-02', level: 'MODERATE', score: 60 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.score, 30); // o de 2026-01-03
  assert.equal(r.label, 'Baixa');
  assert.equal(r.token, 'red');
  assert.equal(r.sleep, '50');
  assert.equal(r.recoveryH, '24h'); // 1440 min / 60
  assert.equal(r.hrv, '40 ms');
  assert.equal(r.serie.length, 3);
  assert.deepEqual(r.serie.map(s => s.data), ['2026-01-01', '2026-01-02', '2026-01-03']); // cronológico
});

test('readiness: nível desconhecido → token muted2', () => {
  const r = Fatigue.readiness([{ data: '2026-01-01', level: 'ZZZ', score: 10 }]);
  assert.equal(r.token, 'muted2');
  assert.equal(r.label, 'ZZZ');
});

test('READINESS_INFO: mapeamento de tokens', () => {
  assert.equal(Fatigue.READINESS_INFO.POOR.token, 'red');
  assert.equal(Fatigue.READINESS_INFO.VERY_HIGH.token, 'green');
  assert.equal(Fatigue.READINESS_INFO.MODERATE.token, 'amber');
});
