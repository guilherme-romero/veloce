'use strict';
// Teste de integração de /api/report (Issue #95) — a rota de impressão expõe
// dados pessoais e o webroot do nginx é público, então ela TEM de ser gateada
// (ver BUG-072 no CLAUDE.md). Aqui garantimos o gate e a forma da página.
// O /api/report/pdf (Playwright + Chromium + porta) fica fora da suíte rápida:
// é verificado manualmente (ver README/HISTORICO), não no CI.
const test = require('node:test');
const assert = require('node:assert');
const { buildTestApp, cleanup } = require('./app-harness.js');

let h, cookie;
test.before(() => { h = buildTestApp(); cookie = h.authCookie(); });
test.after(() => cleanup(h));

test('GET /api/report/print: sem autenticação → 401 (não vaza dados)', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/report/print' });
  assert.equal(res.statusCode, 401);
});

test('GET /api/report/print: autenticado → 200 HTML com shell do relatório', async () => {
  const res = await h.app.inject({ method: 'GET', url: '/api/report/print', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const html = res.body;
  // Páginas A4 que o Playwright imprime
  assert.ok(html.includes('id="p1"'), 'tem a página 1');
  assert.ok(html.includes('id="p2"'), 'tem a página 2');
  // Fontes auto-hospedadas inlinadas (sem rede no render)
  assert.ok(html.includes("font-family:'Bebas Neue'"), 'inlina Bebas Neue');
  assert.ok(html.includes('data:font/woff2;base64,'), 'fontes como data: URI');
  // Módulos core reusados (mesma fonte de verdade do app)
  assert.ok(html.includes('window.Records'), 'inlina js/core/records.js');
  assert.ok(html.includes('window.WeightStats'), 'inlina js/core/weight-stats.js');
  assert.ok(html.includes('window.Fatigue'), 'inlina js/core/fatigue.js');
  // Sinal que o renderizador espera antes de imprimir
  assert.ok(html.includes('__reportReady'), 'marca o pronto p/ o Playwright');
});

test('GET /api/report/print?days=30: aceita a janela e segue gateado', async () => {
  const semAuth = await h.app.inject({ method: 'GET', url: '/api/report/print?days=30' });
  assert.equal(semAuth.statusCode, 401);
  const comAuth = await h.app.inject({ method: 'GET', url: '/api/report/print?days=30', headers: { cookie } });
  assert.equal(comAuth.statusCode, 200);
});

// Issue #132: 30d e 90d percorrem o MESMO código (fetchDays = max(days,120)),
// e o único efeito do parâmetro na página 1 é o rótulo do período e a contagem
// de passeios. Fixar isso evita que uma refatoração faça um período divergir do
// outro em silêncio — foi o que o relato de "só o de 30 não gera" obrigou a
// auditar. O render em si (Playwright) segue fora da suíte rápida.
test('GET /api/report/print: os três períodos servem a mesma página, sem divergir', async () => {
  // O rótulo e o filtro são calculados NO BROWSER a partir de location.search,
  // então o HTML servido é idêntico nos três casos — e é justamente isso que
  // vale fixar: nenhum período tem caminho próprio no servidor que possa
  // quebrar sozinho (foi o que o relato "só o de 30 não gera" obrigou a
  // auditar). O render em si (Playwright) segue fora da suíte rápida.
  const corpos = [];
  for (const qs of ['?days=30', '?days=90', '']) {
    const res = await h.app.inject({ method: 'GET', url: '/api/report/print' + qs, headers: { cookie } });
    assert.equal(res.statusCode, 200, `status de ${qs || '(tudo)'}`);
    corpos.push(res.body);
  }
  assert.equal(corpos[0], corpos[1], '30d e 90d servem o mesmo HTML');
  assert.equal(corpos[1], corpos[2], '90d e "tudo" servem o mesmo HTML');
});

test('as páginas de impressão sinalizam falha de montagem para o renderizador', async () => {
  // Contrato com server/services/report-render.js: marcar __reportReady mesmo
  // em falha é deliberado (imprimir o que deu em vez de estourar timeout), e
  // __reportError é o que permite à rota devolver 500 em vez de um PDF em
  // branco com HTTP 200 (Issue #132). É verificação ESTÁTICA do contrato — o
  // comportamento em runtime só o Playwright exercita, e isso fica fora do CI
  // rápido; quebrar o nome do sinal aqui é o erro que este teste pega.
  for (const url of ['/api/report/print', '/api/report/print-resumo']) {
    const res = await h.app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('__reportReady'), `${url}: sinaliza pronto`);
    assert.ok(res.body.includes('__reportError'), `${url}: sinaliza falha de montagem`);
  }
});

test('GET /api/report/print-resumo: gateado + card do resumo (PNG do Telegram)', async () => {
  const semAuth = await h.app.inject({ method: 'GET', url: '/api/report/print-resumo' });
  assert.equal(semAuth.statusCode, 401);
  const res = await h.app.inject({ method: 'GET', url: '/api/report/print-resumo', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes('id="resumo"'), 'tem o card do resumo');
  assert.ok(res.body.includes("font-family:'Bebas Neue'"), 'inlina as fontes');
  assert.ok(res.body.includes('__reportReady'), 'sinaliza pronto p/ screenshot');
});
