'use strict';
// server/scripts/enviar-resumo.js (#156) — o gatilho manual do relatório
// mensal do Telegram. Aqui só a lógica pura de CLI: o render de verdade pede
// Chromium e o envio pede token, e nenhum dos dois pertence a um teste.
//
// Fuso FIXO antes do require, pelo mesmo motivo dos outros arquivos de data:
// rotuloMes monta a data em hora local, e em TZ=UTC o caso de borda que o
// "dia 2 ao meio-dia" existe para evitar simplesmente desaparece.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');

// require.main === module no script impede que isto dispare o main().
const { parseArgs, rotuloMes, mesAnterior } = require('../server/scripts/enviar-resumo.js');

const argv = (...a) => ['node', 'enviar-resumo.js', ...a];

test('parseArgs: sem argumentos é envio real do mês anterior', () => {
  const r = parseArgs(argv());
  assert.equal(r.dryRun, false);
  assert.equal(r.mes, null);
  assert.ok(!r.erro);
});

test('parseArgs: --dry-run e -n são o mesmo', () => {
  assert.equal(parseArgs(argv('--dry-run')).dryRun, true);
  assert.equal(parseArgs(argv('-n')).dryRun, true);
});

test('parseArgs: --mes captura o valor', () => {
  assert.equal(parseArgs(argv('--mes=2026-10')).mes, '2026-10');
  assert.equal(parseArgs(argv('--mes=2026-10', '-n')).dryRun, true);
});

test('parseArgs: argumento desconhecido é registrado, não ignorado', () => {
  // Importa porque o script sai com código 2 nesse caso: um typo em
  // "--dry-run" NÃO pode virar um envio real silencioso.
  assert.equal(parseArgs(argv('--dryrun')).erro, '--dryrun');
  assert.equal(parseArgs(argv('--mes')).erro, '--mes', '--mes sem valor também é erro');
});

test('parseArgs: --help é reconhecido nas duas formas', () => {
  assert.equal(parseArgs(argv('--help')).help, true);
  assert.equal(parseArgs(argv('-h')).help, true);
});

test('rotuloMes: formata o mês pedido em português', () => {
  assert.equal(rotuloMes('2026-10'), 'outubro de 2026');
  assert.equal(rotuloMes('2026-01'), 'janeiro de 2026');
  assert.equal(rotuloMes('2026-12'), 'dezembro de 2026');
});

test('rotuloMes: o mês pedido não escorrega por causa do fuso', () => {
  // A âncora é dia 2 ao meio-dia. Com dia 1 à meia-noite, num fuso -03:00 a
  // data cairia no último dia do mês ANTERIOR e o rótulo sairia errado —
  // justamente o tipo de erro que a #158 e a #151 documentam neste projeto.
  for (const [arg, esperado] of [['2026-03', 'março de 2026'], ['2026-11', 'novembro de 2026']]) {
    assert.equal(rotuloMes(arg), esperado, arg);
  }
});

test('rotuloMes: formato inválido lança, em vez de mandar legenda errada', () => {
  assert.throws(() => rotuloMes('abc'), /YYYY-MM/);
  assert.throws(() => rotuloMes('2026-13-01'), /YYYY-MM/);
  assert.throws(() => rotuloMes('26-10'), /YYYY-MM/);
});

test('rotuloMes: sem argumento usa o mês fechado anterior', () => {
  const esperado = mesAnterior().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  assert.equal(rotuloMes(null), esperado);
});

test('mesAnterior: cai sempre no mês anterior ao de hoje', () => {
  const hoje = new Date();
  const ant = mesAnterior();
  const difMeses = (hoje.getFullYear() - ant.getFullYear()) * 12 + (hoje.getMonth() - ant.getMonth());
  assert.equal(difMeses, 1, 'exatamente um mês atrás, inclusive na virada de ano');
});
