/* ═══════════════════════════════════════════════════════════════════════
   BROWSER-SETUP — infraestrutura para dirigir o app num Chromium real
   contra o backend REAL, com SQLite TEMPORÁRIO.

   Não termina em `.test.js`: `node --test tests/*.test.js` não roda isto, e a
   CI não tem Chromium. É suíte LOCAL, como tests/drive.js e tests/pwa.js.

   Diferença importante em relação a tests/run-all.js: aquelas suítes rodam
   contra o banco de PRODUÇÃO e pedem TB_USER/TB_PASS. Esta sobe o Fastify com
   `app.inject()` sobre um SQLite temporário (via tests/app-harness.js), então
   pode exercitar ESCRITA — excluir plano, limpar histórico — sem tocar em dado
   real e sem credencial nenhuma.

   ─── As duas armadilhas que isto existe para resolver ──────────────────

   1. `serviceWorkers: 'block'` é OBRIGATÓRIO. O service worker do PWA
      intercepta o `fetch` ANTES do `page.route` do Playwright, e as chamadas
      `/api/*` caem no servidor estático como 404. O sintoma é a view nunca
      renderizar, sem erro que aponte a causa — custou duas rodadas de
      diagnóstico em 2026-11-09, uma delas com conclusão errada (culpei a glob
      de rota do Playwright).

   2. Stub de `window.Chart`. O Chart.js vem de CDN (Issue #169) e, sem rede
      para ele, `Charts.init()` lança durante o boot do `app.js` — a wiring da
      seção nunca acontece e a tela fica inerte. De novo: o sintoma não aponta
      a causa.

   Uso:
     const { abrirApp, fechar } = require('./browser-setup.js');
     const ctx = await abrirApp({ mobile: true, semear: (db) => {...} });
     // ctx.pg (página), ctx.db (SQLite temporário), ctx.ok(...) ...
     await fechar(ctx);
═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SERVER_DIR = path.join(RAIZ, 'server');
const { chromium } = require(require.resolve('playwright', { paths: [SERVER_DIR] }));
const harness = require('./app-harness.js');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

/** Serve o repositório como o nginx faz: arquivo do disco, sem rota especial. */
function servirRepo() {
  const srv = http.createServer((req, res) => {
    const caminho = decodeURIComponent(req.url.split('?')[0]);
    const arq = path.join(RAIZ, caminho === '/' ? 'index.html' : caminho);
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404); return res.end('nao encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });
  return srv;
}

/**
 * Sobe app + servidor + navegador e abre a página pedida.
 * @param {object} opts
 * @param {boolean} [opts.mobile]  viewport/UA de celular (serve mobile.html)
 * @param {string}  [opts.pagina]  'mobile.html' | 'index.html' (default: pelo mobile)
 * @param {(db) => void} [opts.semear] recebe o SQLite temporário antes de abrir
 */
async function abrirApp({ mobile = false, pagina, semear } = {}) {
  const H = harness.buildTestApp();
  await H.app.ready();
  if (semear) semear(H.app.db);

  const srv = servirRepo();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;

  const nav = await chromium.launch();
  const ctxBrowser = await nav.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile,
    serviceWorkers: 'block',   // ← ver armadilha 1 no cabeçalho
  });
  const pg = await ctxBrowser.newPage();

  // ← armadilha 2: o boot morre sem Chart.js, e nada aqui depende de gráfico.
  await pg.addInitScript(() => {
    const noop = function () { return { destroy() {}, update() {}, resize() {}, data: {}, options: {} }; };
    noop.register = () => {}; noop.defaults = { font: {}, plugins: {}, scale: {} };
    window.Chart = noop;
  });
  await pg.route(/cdnjs|jsdelivr|unpkg|fonts\.googleapis|fonts\.gstatic/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));

  // Regex e não glob: `**/api/**` já deixou passar uma URL com query.
  const cookie = H.authCookie();
  await pg.route(/\/api\//, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const r = await H.app.inject({
      method: req.method(), url: u.pathname + u.search,
      headers: { cookie, 'content-type': 'application/json' },
      payload: req.postData() || undefined,
    });
    return route.fulfill({ status: r.statusCode, contentType: 'application/json', body: r.body });
  });
  pg.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 180)));

  const alvo = pagina || (mobile ? 'mobile.html' : 'index.html');
  await pg.goto(base + '/' + alvo, { waitUntil: 'load' });

  return { H, srv, nav, ctxBrowser, pg, base, db: H.app.db };
}

async function fechar(ctx) {
  try { await ctx.ctxBrowser.close(); } catch (_) {}
  try { await ctx.nav.close(); } catch (_) {}
  try { ctx.srv.close(); } catch (_) {}
  try { await harness.cleanup(ctx.H); } catch (_) {}
}

/** Contador de asserções, no formato das outras suítes locais do projeto. */
function placar() {
  let pass = 0, fail = 0;
  return {
    ok(nome, cond, extra = '') {
      if (cond) { pass++; console.log('  PASS  ' + nome + (extra ? ' — ' + extra : '')); }
      else { fail++; console.log('  FAIL  ' + nome + (extra ? ' — ' + extra : '')); }
    },
    fim() {
      console.log('\n  ' + pass + ' pass, ' + fail + ' fail');
      return fail;
    },
  };
}

module.exports = { abrirApp, fechar, placar, RAIZ };
