'use strict';
// Testes unitários de js/core/weight-stats.js (Issue #72 item 2) — consolidação
// diária e análise de peso (regressão linear + previsão da meta). Lógica pura.
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./core-load.js');

const { WeightStats } = loadCore('weight-stats.js');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test("dailyWeights: só 'atual', média por dia, ordem cronológica", () => {
  const r = WeightStats.dailyWeights([
    { data: '2026-01-02', peso: 79, tipo: 'atual' },
    { data: '2026-01-01', peso: 80, tipo: 'atual' },
    { data: '2026-01-01', peso: 82, tipo: 'atual' }, // mesmo dia → média
    { data: '2026-01-03', peso: 70, tipo: 'meta' },   // tipo meta → ignorado
  ]);
  assert.deepEqual(r, [
    { data: '2026-01-01', peso: 81 }, // (80+82)/2
    { data: '2026-01-02', peso: 79 },
  ]);
});

test('weightAnalysis: sem base → ok:false (poucos dados ou sem meta)', () => {
  assert.deepEqual(WeightStats.weightAnalysis({ pesoMeta: 70 }, [{ data: '2026-01-01', peso: 80, tipo: 'atual' }]), { ok: false });
  assert.deepEqual(WeightStats.weightAnalysis({}, [
    { data: '2026-01-01', peso: 80, tipo: 'atual' },
    { data: '2026-01-02', peso: 79, tipo: 'atual' },
  ]), { ok: false });
});

test('weightAnalysis: perda linear → slope, taxa e direção corretos + previsão', () => {
  const weights = [
    { data: daysAgo(60), peso: 80, tipo: 'atual' },
    { data: daysAgo(40), peso: 78, tipo: 'atual' },
    { data: daysAgo(20), peso: 76, tipo: 'atual' },
    { data: daysAgo(0), peso: 74, tipo: 'atual' },
  ];
  const r = WeightStats.weightAnalysis({ pesoMeta: 70 }, weights);
  assert.equal(r.ok, true);
  assert.ok(near(r.slope, -0.1, 1e-9), `slope ${r.slope}`); // -2 kg / 20 dias
  assert.equal(r.taxaKgSem, -0.7); // slope × 7
  assert.equal(r.objetivoGanho, false); // meta 70 < peso inicial 80 → perda
  assert.equal(r.taxaPositiva, true);   // perder (taxa < 0) é "bom" no objetivo de perda
  assert.equal(r.metaAtingida, false);
  assert.equal(r.pesoAtual, 74);
  assert.equal(r.semanas, '6'); // 4 kg / 0.1 kg-dia = 40 dias → ceil(40/7)
  assert.notEqual(r.previsao, '—');
});

test('weightAnalysis: meta de perda já atingida', () => {
  const weights = [
    { data: daysAgo(40), peso: 80, tipo: 'atual' },
    { data: daysAgo(20), peso: 77, tipo: 'atual' },
    { data: daysAgo(0), peso: 75, tipo: 'atual' },
  ];
  const r = WeightStats.weightAnalysis({ pesoMeta: 78 }, weights); // já abaixo de 78
  assert.equal(r.ok, true);
  assert.equal(r.objetivoGanho, false);
  assert.equal(r.metaAtingida, true);
  assert.equal(r.previsao, 'Meta atingida!');
});

test('weightAnalysis: objetivo de ganho inverte a semântica da direção', () => {
  const weights = [
    { data: daysAgo(40), peso: 70, tipo: 'atual' },
    { data: daysAgo(20), peso: 72, tipo: 'atual' },
    { data: daysAgo(0), peso: 74, tipo: 'atual' },
  ];
  const r = WeightStats.weightAnalysis({ pesoMeta: 80 }, weights); // meta acima → ganho
  assert.equal(r.objetivoGanho, true);
  assert.ok(r.slope > 0);
  assert.equal(r.taxaPositiva, true); // ganhar (taxa > 0) é "bom" no objetivo de ganho
  assert.equal(r.metaAtingida, false);
});

/* ── #92: aderência + cenário potencial ──────────────────────────────── */

test('adherence: razão realizado/planejado na janela (null sem plano)', () => {
  assert.equal(WeightStats.adherence(0, 300, 4), null);       // sem plano → null
  assert.equal(WeightStats.adherence(null, 300, 4), null);
  assert.ok(near(WeightStats.adherence(100, 200, 4), 0.5));   // 200 / (100×4)
  assert.ok(near(WeightStats.adherence(100, 400, 4), 1.0));
  assert.ok(near(WeightStats.adherence(60, 120, 2), 1.0));    // janela custom
});

// Base reutilizada: perda em ritmo que progride rumo à meta.
function basePerda() {
  return WeightStats.weightAnalysis({ pesoMeta: 70 }, [
    { data: daysAgo(60), peso: 80, tipo: 'atual' },
    { data: daysAgo(40), peso: 78, tipo: 'atual' },
    { data: daysAgo(20), peso: 76, tipo: 'atual' },
    { data: daysAgo(0),  peso: 74, tipo: 'atual' },
  ]);
}

test('metaScenario: sem aderência (sem plano) → não mostra', () => {
  const s = WeightStats.metaScenario(basePerda(), { aderencia: null });
  assert.equal(s.mostra, false);
  assert.equal(s.motivo, 'sem-plano');
});

test('metaScenario: aderência 0 e sentido errado → guarda-corpos', () => {
  assert.equal(WeightStats.metaScenario(basePerda(), { aderencia: 0 }).motivo, 'sem-treino');
  // ganho quando a meta é perder → sentido errado
  const baseSentidoErrado = WeightStats.weightAnalysis({ pesoMeta: 70 }, [
    { data: daysAgo(40), peso: 74, tipo: 'atual' },
    { data: daysAgo(20), peso: 76, tipo: 'atual' },
    { data: daysAgo(0),  peso: 78, tipo: 'atual' },
  ]);
  assert.equal(WeightStats.metaScenario(baseSentidoErrado, { aderencia: 0.5 }).motivo, 'sentido-errado');
});

test('metaScenario: aderência ≥ 100% → já cumpre, sem potencial', () => {
  assert.equal(WeightStats.metaScenario(basePerda(), { aderencia: 1 }).motivo, 'ja-cumpre');
  assert.equal(WeightStats.metaScenario(basePerda(), { aderencia: 1.3 }).motivo, 'ja-cumpre');
});

test('metaScenario: aderência parcial → potencial mais rápido que o real, capado a 1%/sem', () => {
  const base = basePerda();
  const s = WeightStats.metaScenario(base, { aderencia: 0.5, pesoCorporal: base.pesoAtual });
  assert.equal(s.mostra, true);
  // ritmo potencial > ritmo real (escala por 1/0.5 = 2×) → menos dias que o real
  assert.ok(s.diasNec < base.diasNec, `pot ${s.diasNec} < real ${base.diasNec}`);
  // cap fisiológico: nunca passa de 1%/semana do peso → kg/dia
  const capKgDia = (base.pesoAtual * 0.01) / 7;
  assert.ok(s.slopeAlvoPot <= capKgDia + 1e-9, `slope ${s.slopeAlvoPot} <= cap ${capKgDia}`);
  assert.notEqual(s.previsao, undefined);
});
