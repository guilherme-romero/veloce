'use strict';
// window.BikeComp — rótulo e desgaste de componente de bike (#142).
//
// Por que este arquivo existe: até a #142 esta lógica vivia DUAS vezes, dentro
// de funções que são serializadas por toString() e executadas no Chromium
// (reportRenderClient e reportResumoClient, server/routes/report.js). Lá dentro
// não havia como testá-la sem tautologia — e foi exatamente por estar duplicada
// que a correção do #134 chegou ao resumo do Telegram e não ao PDF. Com a
// lógica em js/utils.js, ela vira código comum de Node e dá para provar as duas
// falhas de verdade.
//
// js/utils.js não é IIFE nem CommonJS: é script de browser que atribui a
// `window`. Mesmo shim de tests/core-load.js, só que apontando para js/ em vez
// de js/core/ (loadCore só varre js/core/). Não toca `document` no nível
// superior, então carrega limpo.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

if (!global.window) global.window = {};
require(path.join(__dirname, '..', 'js', 'utils.js'));
const { label, razaoUso, LABELS } = global.window.BikeComp;

// ── Falha 1: rótulo de componente custom ────────────────────────────────
const TIPOS = [{ id: 'ctype_abc', nome: 'Guidão' }, { id: 'ctype_xyz', nome: 'Selim' }];

test('label: tipo conhecido devolve o rótulo da tabela', () => {
  assert.equal(label('corrente', TIPOS), 'Corrente');
  assert.equal(label('pastilha_diant', TIPOS), 'Pastilha dianteira');
  assert.equal(label('cabo_freio', TIPOS), 'Cabo/Óleo de freio');
});

test('label: custom:<id> resolve pelo nome de /component-types', () => {
  // A falha vista no PDF de produção: sem isto sai "custom:ctype_abc".
  assert.equal(label('custom:ctype_abc', TIPOS), 'Guidão');
  assert.equal(label('custom:ctype_xyz', TIPOS), 'Selim');
});

test('label: id custom que não existe mais vira "Outro", não a chave crua', () => {
  // Tipo excluído depois de já ter sido usado num componente. O que não pode
  // acontecer é a chave vazar para o relatório.
  const r = label('custom:ctype_sumiu', TIPOS);
  assert.equal(r, 'Outro');
  assert.ok(!r.includes('custom:'), 'a chave interna nunca aparece');
});

test('label: sem a lista de tipos (fetch falhou) ainda não vaza a chave', () => {
  for (const lista of [undefined, null, [], 'nao é array']) {
    assert.equal(label('custom:ctype_abc', lista), 'Outro');
  }
});

test('label: entrada estranha não quebra', () => {
  assert.equal(label('tipo_inexistente', TIPOS), 'tipo_inexistente');
  assert.doesNotThrow(() => label(undefined, TIPOS));
  assert.doesNotThrow(() => label(null, TIPOS));
  // Tabela usada por Object.hasOwn: chave herdada não pode ser confundida
  // com rótulo (era o motivo de usar hasOwn em vez de `in`).
  assert.notEqual(label('toString', TIPOS), LABELS.toString);
});

// ── Falha 2: barra × banner no critério de "vencido" ────────────────────
// A barra desenha Math.floor(razão*100) e marca VENC. em pct >= 100; o banner
// conta razão >= 1. Com Math.round os dois discordam numa faixa estreita, e o
// PDF saía com "1 componente vencido" embaixo de DUAS barras VENC.
const pctBarra  = (c) => { const r = razaoUso(c); return r == null ? null : Math.floor(r * 100); };
const vencBarra = (c) => pctBarra(c) >= 100;
const vencBanner = (c) => razaoUso(c) >= 1;

test('razaoUso: a borda de 0,996 — barra e banner concordam', () => {
  const c = { vidaUtilKm: 1000, kmDesgastado: 996 };
  assert.equal(pctBarra(c), 99, 'com Math.round isto seria 100 e a barra mentiria');
  assert.equal(vencBarra(c), false);
  assert.equal(vencBanner(c), false);
  assert.equal(vencBarra(c), vencBanner(c), 'é esta igualdade que a #142 quebrava');
});

test('razaoUso: barra e banner concordam em toda a faixa crítica', () => {
  for (const km of [994, 995, 996, 997, 998, 999, 1000, 1001, 1500]) {
    const c = { vidaUtilKm: 1000, kmDesgastado: km };
    assert.equal(vencBarra(c), vencBanner(c), `divergiram em ${km} km`);
  }
});

test('razaoUso: exatamente 100% é vencido nos dois', () => {
  const c = { vidaUtilKm: 2000, kmDesgastado: 2000 };
  assert.equal(pctBarra(c), 100);
  assert.equal(vencBarra(c), true);
  assert.equal(vencBanner(c), true);
});

test('razaoUso: a borda do âmbar (80%) não arredonda para cima', () => {
  // Mesmo raciocínio da borda do vermelho: 0,795 não é 80%.
  const c = { vidaUtilKm: 1000, kmDesgastado: 795 };
  assert.equal(pctBarra(c), 79, 'com Math.round viraria 80 e a barra ficaria âmbar cedo demais');
});

test('razaoUso: sem vida útil cadastrada devolve null (barra mostra "—")', () => {
  // null é diferente de 0: "não dá para calcular" não é "zerado".
  assert.equal(razaoUso({ vidaUtilKm: 0, kmDesgastado: 500 }), null);
  assert.equal(razaoUso({ kmDesgastado: 500 }), null);
  assert.equal(razaoUso({ vidaUtilKm: 1000, kmDesgastado: null }), null);
  assert.equal(razaoUso({ vidaUtilKm: 1000 }), null);
  assert.equal(razaoUso(null), null);
  assert.equal(razaoUso({ vidaUtilKm: 1000, kmDesgastado: 0 }), 0, 'zero km rodados é 0, não null');
});
