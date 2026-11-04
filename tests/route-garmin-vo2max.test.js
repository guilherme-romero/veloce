'use strict';
// Teste de integração de /api/garmin/vo2max (#134).
//
// Por que existe: a tabela garmin_fitness_scores guarda uma leitura por dia,
// mas o endpoint só sabia responder "a mais recente de todas". O resumo mensal
// do Telegram precisa do valor NAQUELE ponto do tempo — o do mês que fechou e o
// do mês anterior, para a nota de variação —, e sem isso o PNG mostraria um
// VO2máx posterior ao mês do relatório (o render pode rodar sob demanda, dias
// ou semanas depois) e não teria como calcular variação nenhuma.
//
// O `?asOf=` é a única parte do #134 que dá para testar de verdade aqui: o
// resto do épico é layout dentro de uma função que roda no Chromium e chega ao
// servidor apenas como texto serializado — ali a verificação é o PNG.
const test = require('node:test');
const assert = require('node:assert');
const { buildTestApp, cleanup } = require('./app-harness.js');

let h, cookie;
test.before(() => {
  h = buildTestApp();
  cookie = h.authCookie();
  // Três leituras em meses distintos, fora de ordem na inserção de propósito:
  // o endpoint tem de ordenar por data, não confiar na ordem física das linhas.
  const ins = h.app.db.prepare('INSERT INTO garmin_fitness_scores (data, vo2_max) VALUES (?, ?)');
  ins.run('2026-09-10', 44.0); // mês de comparação
  ins.run('2026-11-02', 48.0); // já no mês do render, posterior ao fechamento
  ins.run('2026-10-20', 46.0); // mês que fechou
});
test.after(() => cleanup(h));

test('GET /api/garmin/vo2max: sem autenticação → 401', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/garmin/vo2max' });
  assert.equal(res.statusCode, 401);
});

test('GET /api/garmin/vo2max: sem asOf → mais recente de todas (comportamento antigo)', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/garmin/vo2max', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.latest.value, 48.0, 'latest = leitura mais recente');
  assert.equal(j.latest.date, '2026-11-02');
  assert.equal(j.max.value, 48.0, 'max = maior valor');
});

test('GET /api/garmin/vo2max?asOf=: latest vira o último valor ATÉ a data', async () => {
  // Fim do mês fechado: tem de ignorar a leitura de novembro, que é posterior.
  const fechado = await h.app.inject({ method: 'GET', url: '/api/garmin/vo2max?asOf=2026-10-31', headers: { cookie } });
  assert.equal(fechado.statusCode, 200);
  assert.equal(fechado.json().latest.value, 46.0, 'outubro, não a leitura de novembro');

  // Fim do mês de comparação: tem de ignorar outubro E novembro.
  const anterior = await h.app.inject({ method: 'GET', url: '/api/garmin/vo2max?asOf=2026-09-30', headers: { cookie } });
  assert.equal(anterior.json().latest.value, 44.0, 'setembro');

  // `max` é global por contrato (é o recorde, não o do período) e não muda.
  assert.equal(anterior.json().max.value, 48.0, 'max segue sendo o recorde absoluto');
});

test('GET /api/garmin/vo2max?asOf=: a fronteira é inclusiva (<=, não <)', async () => {
  // A data exata de uma leitura TEM de incluí-la. É o caso que pega a troca de
  // `data <= ?` por `data < ?`: com `<`, isto devolveria 44 (setembro) em vez
  // de 46, e a comparação mês a mês do resumo ficaria deslocada em um mês
  // inteiro sem nada quebrar visivelmente.
  const res = await h.app.inject({ method: 'GET', url: '/api/garmin/vo2max?asOf=2026-10-20', headers: { cookie } });
  assert.equal(res.json().latest.value, 46.0);
  assert.equal(res.json().latest.date, '2026-10-20');
});

test('GET /api/garmin/vo2max?asOf=: data com formato válido mas inexistente → comparação textual, sem erro', async () => {
  // '2026-13-45' passa pela regex e vira comparação de string no SQLite (as
  // datas são TEXT ISO). Ordena depois de qualquer mês real de 2026, então o
  // efeito é "sem filtro". Documentado aqui para que o comportamento seja uma
  // escolha conhecida e não uma surpresa.
  const res = await h.app.inject({ method: 'GET', url: '/api/garmin/vo2max?asOf=2026-13-45', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().latest.value, 48.0);
});

test('GET /api/garmin/vo2max?asOf=: data anterior a tudo → latest nulo, sem quebrar', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/garmin/vo2max?asOf=2020-01-01', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().latest, null, 'nada até essa data');
});

test('GET /api/garmin/vo2max?asOf= inválido → ignora o filtro em vez de estourar', async () => {
  // Quem chama é um template de render: um PNG sem a comparação é melhor que um
  // PNG que não sai. Então lixo no parâmetro cai no caminho sem filtro.
  for (const ruim of ['2026-13', 'ontem', '31/10/2026', '']) {
    const res = await h.app.inject({ method: 'GET', url: `/api/garmin/vo2max?asOf=${encodeURIComponent(ruim)}`, headers: { cookie } });
    assert.equal(res.statusCode, 200, `asOf=${ruim}: responde 200`);
    assert.equal(res.json().latest.value, 48.0, `asOf=${ruim}: cai no sem-filtro`);
  }
});
