'use strict';
// Testes unitários de js/core/metrics.js (Issue #72 item 2) — FCmax, TRIMP,
// TSS, EMA, média móvel, CTL/ATL/TSB e classificação de TSB. Lógica pura.
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./core-load.js');

const { Metrics } = loadCore('metrics.js');
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

test('intensityFallback: faixas por duração', () => {
  assert.equal(Metrics.intensityFallback({ tempoMovS: 30 * 60 }), 0.75); // < 45 min
  assert.equal(Metrics.intensityFallback({ tempoMovS: 200 * 60 }), 0.65); // > 3 h
  assert.equal(Metrics.intensityFallback({ tempoMovS: 60 * 60 }), 0.70); // intermediário
  assert.equal(Metrics.intensityFallback({}), 0.70); // sem tempo → neutro
});

test('calcFCMax: usa fcMax explícito, senão deriva da idade, senão null', () => {
  assert.equal(Metrics.calcFCMax({ fcMax: 185 }), 185);
  assert.equal(Metrics.calcFCMax({}), null);
  const porIdade = Metrics.calcFCMax({ dataNascimento: '1990-05-10' });
  assert.equal(typeof porIdade, 'number');
  assert.ok(porIdade > 150 && porIdade < 200, `fcMax derivado plausível: ${porIdade}`);
});

test('trimpDeAtividade: quadrático na intensidade; 0 sem dados', () => {
  assert.equal(Metrics.trimpDeAtividade(null, 190), 0);
  assert.equal(Metrics.trimpDeAtividade({ tempoMovS: 3600 }, null), 0);
  // fcMedia 150 / fcMax 190 = 0.7895; 60 min × 0.7895² ≈ 37.40
  assert.ok(near(Metrics.trimpDeAtividade({ tempoMovS: 3600, fcMedia: 150 }, 190), 37.40, 0.1));
  // sem fcMedia → fallback 0.70 (60 min, intermediário): 60 × 0.49 = 29.4
  assert.ok(near(Metrics.trimpDeAtividade({ tempoMovS: 3600 }, 190), 29.4, 0.05));
});

test('trimpDeAtividade: clampa fcMedia > fcMax a intensidade 1.0', () => {
  // 60 min × 1.0² = 60 (intensidade não passa de 1.0 mesmo com fc > fcMax)
  assert.ok(near(Metrics.trimpDeAtividade({ tempoMovS: 3600, fcMedia: 210 }, 190), 60, 0.01));
});

test('tssDeAtividade: ~tempoH × intensity² × 100', () => {
  assert.equal(Metrics.tssDeAtividade({}, 190), 0);
  // 1 h × 0.7895² × 100 ≈ 62.33
  assert.ok(near(Metrics.tssDeAtividade({ tempoMovS: 3600, fcMedia: 150 }, 190), 62.33, 0.1));
});

test('emaSeries: warm-up a partir de 0, converge para o valor constante', () => {
  assert.deepEqual(Metrics.emaSeries([10], 1), [10]);
  const s = Metrics.emaSeries([7, 7, 7, 7, 7, 7, 7], 7);
  assert.equal(s.length, 7);
  assert.ok(near(s[0], 1, 1e-9)); // 0 + (7-0)/7 = 1
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], 'estritamente crescente');
  assert.ok(s[s.length - 1] < 7, 'ainda não convergiu em 7 passos');
});

test('movingAvg: média móvel de N ignorando nulos', () => {
  assert.deepEqual(Metrics.movingAvg([2, 4, 6], 2), [2, 3, 5]);
  assert.deepEqual(Metrics.movingAvg([2, null, 6], 2), [2, 2, 6]);
});

test('tsbStatus: cortes e tokens de cor', () => {
  assert.deepEqual(pick(Metrics.tsbStatus(15)), { status: 'Fresco', token: 'green' });
  assert.deepEqual(pick(Metrics.tsbStatus(0)), { status: 'Ótimo', token: 'teal' });
  assert.deepEqual(pick(Metrics.tsbStatus(-10)), { status: 'Carregado', token: 'amber' });
  assert.deepEqual(pick(Metrics.tsbStatus(-25)), { status: 'Sobrecarga', token: 'red' });
  // cutoff customizado: -15 não passa de -10 → Sobrecarga
  assert.deepEqual(pick(Metrics.tsbStatus(-15, -10)), { status: 'Sobrecarga', token: 'red' });
  function pick(o) { return { status: o.status, token: o.token }; }
});

test('calcTSBMetrics: vazio → zeros; com carga recente → atl > ctl, tsb < 0', () => {
  assert.deepEqual(Metrics.calcTSBMetrics([], 190), { ctl: 0, atl: 0, tsb: 0, ctlSerie: [], atlSerie: [] });

  const ref = new Date('2026-06-15T12:00:00');
  const r = Metrics.calcTSBMetrics([{ data: '2026-06-15', tempoMovS: 3600, fcMedia: 150 }], 190, ref);
  assert.equal(r.ctlSerie.length, 60);
  assert.equal(r.atlSerie.length, 60);
  assert.ok(r.ctl > 0 && r.atl > 0);
  assert.ok(r.atl > r.ctl, 'ATL (7d) reage mais rápido à carga recente que CTL (42d)');
  assert.ok(near(r.tsb, r.ctl - r.atl, 1e-9));
  assert.ok(r.tsb < 0);
});
