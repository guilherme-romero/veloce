'use strict';
// Testes unitários de js/core/route-viability.js (#2) — classificação de
// viabilidade de percurso vs histórico. Lógica pura (função de tempo injetada).
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./core-load.js');

const { RouteViability } = loadCore('route-viability.js');
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Stub determinístico do estimateRideTimeMin: tempo plano puro (ignora elev —
// a trava de elevação é testada separadamente).
const estimateTime = ({ dist, speed }) => ({ movTimeMin: (dist / speed) * 60 });

// Histórico: 3 saídas, todas a 20 km/h, durações 60/90/120 min, elev máx 500m.
function hist() {
  return [
    { data: daysAgo(10), distanciaKm: 20, tempoMovS: 3600, elevacaoM: 200 },
    { data: daysAgo(20), distanciaKm: 30, tempoMovS: 5400, elevacaoM: 300 },
    { data: daysAgo(30), distanciaKm: 40, tempoMovS: 7200, elevacaoM: 500 },
  ];
}

test('route-viability: < 3 saídas comparáveis → insuficiente', () => {
  const r = RouteViability.analyze({ distKm: 20, desnivelPos: 100, activities: hist().slice(0, 2), estimateTime });
  assert.equal(r.ok, false);
  assert.equal(r.insuf, true);
  assert.equal(r.baseN, 2);
});

test('route-viability: duração ≤ p75 e elev ok → viável', () => {
  const r = RouteViability.analyze({ distKm: 20, desnivelPos: 100, activities: hist(), estimateTime });
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'viavel');       // 60 min ≤ p75 (105)
  assert.equal(r.tempoMin, 60);
  assert.equal(r.baseSpeed, 20);
  assert.equal(r.recordeKm, 40);
  assert.equal(r.recordeElev, 500);
});

test('route-viability: duração acima do máximo recente → além do histórico', () => {
  const r = RouteViability.analyze({ distKm: 45, desnivelPos: 100, activities: hist(), estimateTime });
  assert.equal(r.tier, 'alem');         // 135 min > maxDur (120)
  assert.equal(r.esforco, 'muito pesado');
});

test('route-viability: trava de elevação sobe o tier mesmo com duração viável', () => {
  const r = RouteViability.analyze({ distKm: 25, desnivelPos: 600, activities: hist(), estimateTime });
  // 75 min ≤ p75 → seria viável pela duração, mas 600m > elev máx (500) → sobe
  assert.equal(r.tier, 'limitrofe');
});

test('route-viability: janela exclui saídas fora dos 6 meses', () => {
  const antigos = hist().map(r => ({ ...r, data: daysAgo(400) }));
  const r = RouteViability.analyze({ distKm: 20, desnivelPos: 100, activities: antigos, estimateTime });
  assert.equal(r.ok, false);
  assert.equal(r.insuf, true);
  assert.equal(r.baseN, 0);
});
