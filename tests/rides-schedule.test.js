'use strict';
// Teste unitário de js/core/rides-schedule.js — seleção pura de passeios por
// data (ridesOn) e próximo passeio no horizonte (nextRide). Carregado no shim
// de window via tests/core-load.js (mesmo padrão de metrics.test.js).
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./core-load.js');
const { RidesSchedule } = loadCore('rides-schedule.js');

const R = (id, data, horaInicio = '') => ({ id, data, horaInicio, destino: `D${id}`, distancia: 10 });

test('ridesOn: filtra pela data exata', () => {
  const rides = [R('a', '2026-01-10'), R('b', '2026-01-11'), R('c', '2026-01-10')];
  const out = RidesSchedule.ridesOn(rides, '2026-01-10');
  assert.deepEqual(out.map(r => r.id).sort(), ['a', 'c']);
});

test('ridesOn: ordena por horaInicio, sem-hora vai pro fim', () => {
  const rides = [
    R('tarde', '2026-01-10', '15:00'),
    R('semhora', '2026-01-10', ''),
    R('manha', '2026-01-10', '07:30'),
  ];
  const out = RidesSchedule.ridesOn(rides, '2026-01-10');
  assert.deepEqual(out.map(r => r.id), ['manha', 'tarde', 'semhora']);
});

test('ridesOn: data sem passeios → []', () => {
  assert.deepEqual(RidesSchedule.ridesOn([R('a', '2026-01-10')], '2026-01-99'), []);
});

test('ridesOn: entrada inválida → []', () => {
  assert.deepEqual(RidesSchedule.ridesOn(null, '2026-01-10'), []);
  assert.deepEqual(RidesSchedule.ridesOn([R('a', '2026-01-10')], ''), []);
});

test('nextRide: pega o futuro mais próximo dentro do horizonte', () => {
  const rides = [R('hoje', '2026-01-10'), R('amanha', '2026-01-11'), R('longe', '2026-01-20')];
  assert.equal(RidesSchedule.nextRide(rides, '2026-01-10', 2).id, 'hoje');
  assert.equal(RidesSchedule.nextRide(rides.filter(r => r.id !== 'hoje'), '2026-01-10', 2).id, 'amanha');
});

test('nextRide: fora do horizonte → null', () => {
  const rides = [R('longe', '2026-01-20')];
  assert.equal(RidesSchedule.nextRide(rides, '2026-01-10', 2), null);
});

test('nextRide: ignora passado e lista vazia → null', () => {
  assert.equal(RidesSchedule.nextRide([R('ontem', '2026-01-09')], '2026-01-10', 2), null);
  assert.equal(RidesSchedule.nextRide([], '2026-01-10', 2), null);
});
