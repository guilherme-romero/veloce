/* ═══════════════════════════════════════════════════════════════════════
   REPORT-RENDER — gera o relatório de evolução server-side via Playwright.

   Um único renderizador, duas saídas (a 2ª — PNG — chega na Fase 2 da #95):
   o Chromium headless abre a rota de impressão interna `/api/report/print`
   (gateada por requireAuth) em http://127.0.0.1:PORT, espera a página montar
   os dados (busca os mesmos /api/* do app) e as fontes carregarem, e então
   `page.pdf()`.

   A rota de print é protegida — o navegador do Playwright passa pelo gate com
   um cookie de sessão JWT MINTADO INTERNAMENTE (mesmo JWT_SECRET/COOKIE_NAME
   do requireAuth), nunca pela URL pública. Tudo via loopback (127.0.0.1).
═══════════════════════════════════════════════════════════════════════ */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { COOKIE_NAME } = require('../middleware/auth');

// Browser reutilizado entre chamadas (o launch do Chromium é caro). Lazy:
// só sobe quando o primeiro PDF é pedido — a maioria dos boots nunca gera um.
let _browserPromise = null;

async function getBrowser() {
  // Reusa o browser vivo; se ele caiu (OOM/SIGKILL/crash) o isConnected() dá
  // false e a gente relança — sem isso, um crash deixaria TODO relatório
  // quebrado até reiniciar o processo.
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      if (b.isConnected()) return b;
    } catch (_) { /* launch anterior falhou — cai no relaunch abaixo */ }
    _browserPromise = null;
  }
  const { chromium } = require('playwright');
  _browserPromise = chromium.launch({
    // --no-sandbox: o backend roda num LXC sem user namespaces; sem isso o
    // Chromium não sobe. O conteúdo renderizado é 100% nosso (loopback), não
    // navegação web arbitrária, então o sandbox aqui protege pouco.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  }).catch(err => { _browserPromise = null; throw err; });
  return _browserPromise;
}

// Token de sessão de curta duração só para o Playwright passar pelo requireAuth.
// iat = agora ⇒ nunca é revogado por um logout anterior (requireAuth usa `<`).
function mintInternalToken() {
  // 10 min cobre folgado o pior caso de render (PDF de 2 págs ~1-2s). Mesmo
  // assim, o get() das páginas usa fetch direto (não o Api global), então um
  // 401 eventual vira dado nulo em vez de redirecionar a página pro login.
  return jwt.sign({ user: config.ADMIN_USER, internal: 'report' }, config.JWT_SECRET, { expiresIn: '10m' });
}

async function withReportPage(pathWithQuery, fn) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    await context.addCookies([{
      name: COOKIE_NAME,
      value: mintInternalToken(),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    }]);
    const page = await context.newPage();
    const url = `http://127.0.0.1:${config.PORT}${pathWithQuery}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // A página busca /api/* de forma assíncrona e sinaliza quando terminou de
    // montar. Esperamos esse sinal (não só o networkidle) antes de imprimir.
    await page.waitForFunction(() => window.__reportReady === true, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await context.close();
  }
}

/**
 * Gera o PDF completo (2 páginas A4). @return {Promise<Buffer>}
 * @param {{days?: number|string}} opts — janela em dias (vazio = tudo).
 */
async function renderPdf({ days } = {}) {
  const qs = days ? `?days=${encodeURIComponent(days)}` : '';
  return withReportPage(`/api/report/print${qs}`, (page) =>
    page.pdf({
      format: 'A4',
      printBackground: true,          // sem isso o fundo escuro some
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  );
}

/**
 * Gera o PNG resumido (card único) para o Telegram. @return {Promise<Buffer>}
 */
async function renderPng() {
  const browser = await getBrowser();
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  try {
    await context.addCookies([{
      name: COOKIE_NAME, value: mintInternalToken(),
      domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict',
    }]);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${config.PORT}/api/report/print-resumo`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => window.__reportReady === true, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    return await page.locator('#resumo').screenshot({ type: 'png' });
  } finally {
    await context.close();
  }
}

// Fecha o browser no shutdown (chamado pelos handlers de sinal em index.js).
async function close() {
  if (_browserPromise) {
    try { const b = await _browserPromise; await b.close(); } catch (_) {}
    _browserPromise = null;
  }
}

module.exports = { renderPdf, renderPng, close };
