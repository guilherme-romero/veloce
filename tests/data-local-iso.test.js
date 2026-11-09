'use strict';
// Utils.dataLocalISO / Utils.mesLocalISO — fonte única de "YYYY-MM-DD no fuso
// LOCAL" (#151). Antes desta extração a lógica vivia copiada inline 11 vezes
// (desktop, mobile, js/core/* e backend), sempre com variação de escrita.
//
// Fuso FIXO antes do require, pelo mesmo motivo que tests/treino-ia-job.test.js
// documenta: o default de container é TZ=UTC, e é exatamente em UTC que o bug
// que este helper existe para impedir DESAPARECE — local e UTC coincidem, o
// teste passa vazio e não prova nada. Com America/Sao_Paulo (-03:00) a borda
// das 21h-24h volta a existir.
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

if (!global.window) global.window = {};
require(path.join(__dirname, '..', 'js', 'utils.js'));
const { dataLocalISO, mesLocalISO, fmtDataHoraLocal, segundaDaSemanaISO } = global.window.Utils;

test('dataLocalISO: formata a data no fuso local', () => {
  assert.equal(dataLocalISO(new Date(2026, 10, 8, 14, 30)), '2026-11-08');
  assert.equal(dataLocalISO(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});

test('dataLocalISO: zero-pad em mês e dia de um dígito', () => {
  // O motivo do padStart: sem ele sairia "2026-3-7", que quebra ordenação
  // lexicográfica — e várias das 11 cópias usavam a string como chave de
  // objeto ordenada por sort().
  assert.equal(dataLocalISO(new Date(2026, 2, 7, 10, 0)), '2026-03-07');
});

test('dataLocalISO: 23h num fuso negativo devolve o dia LOCAL, não o de UTC', () => {
  // ESTE é o teste que justifica o helper existir. Às 23h de 08/11 em
  // São Paulo (-03:00) já são 02h de 09/11 em UTC, então toISOString()
  // devolveria o dia errado — o BUG-#88.
  const d = new Date(2026, 10, 8, 23, 0);
  assert.equal(dataLocalISO(d), '2026-11-08');
  assert.notEqual(dataLocalISO(d), d.toISOString().slice(0, 10));
  assert.equal(d.toISOString().slice(0, 10), '2026-11-09', 'confirma que UTC de fato virou o dia');
});

test('dataLocalISO: 00h30 continua no dia local correto', () => {
  // A outra ponta da borda: em fuso negativo a madrugada local ainda é o
  // mesmo dia em UTC, então aqui os dois coincidem — serve de controle.
  assert.equal(dataLocalISO(new Date(2026, 10, 9, 0, 30)), '2026-11-09');
});

test('dataLocalISO: sem argumento usa agora', () => {
  const agora = new Date();
  assert.equal(dataLocalISO(), dataLocalISO(agora));
  assert.match(dataLocalISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('dataLocalISO: aceita timestamp e string de data', () => {
  const d = new Date(2026, 10, 8, 14, 0);
  assert.equal(dataLocalISO(d.getTime()), '2026-11-08');
  // String ISO com hora local explícita — o formato que o projeto usa ao
  // reidratar data vinda do banco (new Date(iso + 'T12:00:00')).
  assert.equal(dataLocalISO('2026-11-08T12:00:00'), '2026-11-08');
});

test('dataLocalISO: entrada inválida devolve null, não "NaN-NaN-NaN"', () => {
  // As cópias inline não tinham guard: uma data inválida virava a string
  // "NaN-NaN-NaN" e ia parar numa chave de agrupamento sem ninguém notar.
  for (const ruim of ['não é data', new Date('x'), NaN]) {
    assert.equal(dataLocalISO(ruim), null);
  }
});

test('mesLocalISO: devolve YYYY-MM e respeita o fuso local', () => {
  assert.equal(mesLocalISO(new Date(2026, 10, 8, 14, 0)), '2026-11');
  // Último dia do mês às 23h: em UTC já virou dezembro, localmente não.
  const virada = new Date(2026, 10, 30, 23, 0);
  assert.equal(mesLocalISO(virada), '2026-11');
  assert.equal(virada.toISOString().slice(0, 7), '2026-12', 'UTC de fato já virou o mês');
});

test('mesLocalISO: entrada inválida devolve null', () => {
  assert.equal(mesLocalISO('não é data'), null);
});

/* ── #158: fmtDataHoraLocal ──────────────────────────────────────────────
   O teste que importa é o primeiro: sem o `Z` acrescentado, o V8 lê o
   timestamp do SQLite como hora local e o resultado sai 3h adiantado. Era
   exatamente o que as telas de Análise de Performance mostravam, sem rótulo.
   Em TZ=UTC este arquivo inteiro passaria vazio — daí o pino no topo.      */

test('fmtDataHoraLocal: timestamp UTC do SQLite vira hora LOCAL', () => {
  // 09:03 UTC = 06:03 em São Paulo (-03:00). Antes da #158 as cópias cruas
  // devolviam "09 de nov às 09:03" — o número de UTC vestido de local.
  assert.equal(fmtDataHoraLocal('2026-11-09 09:03:11'), '09 de nov às 06:03');
});

test('fmtDataHoraLocal: a conversão atravessa a virada de dia', () => {
  // 01:30 UTC do dia 09 é ainda 22:30 do dia 08 em São Paulo. Se alguém
  // "simplificar" a função tirando o Z, este caso passa a errar o DIA também,
  // não só a hora.
  assert.equal(fmtDataHoraLocal('2026-11-09 01:30:00'), '08 de nov às 22:30');
});

test('fmtDataHoraLocal: entrada que já traz fuso é respeitada, não re-rotulada', () => {
  assert.equal(fmtDataHoraLocal('2026-11-09T09:03:11Z'), '09 de nov às 06:03');
  assert.equal(fmtDataHoraLocal('2026-11-09T06:03:11-03:00'), '09 de nov às 06:03');
});

test('fmtDataHoraLocal: entrada inválida volta como veio (contrato das 4 cópias)', () => {
  // As quatro cópias originais tinham try/catch devolvendo a string crua. A UI
  // conta com isso: prefere mostrar o valor bruto a mostrar "Invalid Date".
  assert.equal(fmtDataHoraLocal('nao é data'), 'nao é data');
  assert.equal(fmtDataHoraLocal(''), '');
  assert.equal(fmtDataHoraLocal(null), null);
  assert.equal(fmtDataHoraLocal(undefined), undefined);
});

test('fmtDataHoraLocal: NÃO rotula fuso', () => {
  // Decisão de produto da #158: app de um único usuário em São Paulo, rótulo
  // de fuso é ruído. O " UTC" que o Treino IA mostrava saiu.
  assert.ok(!/UTC/.test(fmtDataHoraLocal('2026-11-09 09:03:11')));
});

/* ── #160: segundaDaSemanaISO ────────────────────────────────────────────
   Fonte única entre backend (ancora as datas do plano) e frontend (decide se
   o plano ainda cobre a semana corrente). Divergir aqui faz plano válido
   aparecer como vencido, ou pior, o contrário.                             */

test('segundaDaSemanaISO: segunda devolve ela mesma', () => {
  assert.equal(segundaDaSemanaISO(new Date(2026, 10, 9, 6, 0)), '2026-11-09');
});

test('segundaDaSemanaISO: domingo pertence à semana que COMEÇOU, não à seguinte', () => {
  // O caso que quebra a conta ingênua `1 - getDay()`: no domingo (getDay()=0)
  // ela devolveria a segunda de AMANHÃ. Domingo 15/11 pertence à semana de
  // 09/11 — é assim que atribuirDatas monta o plano (segunda→domingo).
  assert.equal(segundaDaSemanaISO(new Date(2026, 10, 15, 23, 0)), '2026-11-09');
});

test('segundaDaSemanaISO: qualquer dia do meio da semana aponta a mesma segunda', () => {
  const esperado = '2026-11-09';
  for (const dia of [10, 11, 12, 13, 14]) {
    assert.equal(segundaDaSemanaISO(new Date(2026, 10, dia, 12, 0)), esperado, 'dia ' + dia);
  }
});

test('segundaDaSemanaISO: a âncora de meio-dia sobrevive às bordas do dia', () => {
  // É o ponto do setHours(12): às 23h num fuso -03:00, um toISOString() sobre
  // a hora original cairia no dia seguinte em UTC e a segunda sairia errada.
  assert.equal(segundaDaSemanaISO(new Date(2026, 10, 11, 23, 59)), '2026-11-09');
  assert.equal(segundaDaSemanaISO(new Date(2026, 10, 11, 0, 1)), '2026-11-09');
});

test('segundaDaSemanaISO: atravessa a virada de ano', () => {
  // 01/01/2027 é uma sexta; a semana dela começou em 28/12/2026.
  assert.equal(segundaDaSemanaISO(new Date(2027, 0, 1, 10, 0)), '2026-12-28');
});

test('segundaDaSemanaISO: entrada inválida devolve null', () => {
  assert.equal(segundaDaSemanaISO('nao é data'), null);
  assert.equal(segundaDaSemanaISO(NaN), null);
});
