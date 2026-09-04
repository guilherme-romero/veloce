/* Harness CDP mínimo — WebSocket cru contra chrome-headless-shell.
   Reconstruído na FASE 25 (os scratchpads da v2.9.0 foram limpos).
   Regra aprendida na v2.9.0: --user-data-dir NOVO a cada run. Reusar perfil
   fez o service worker servir JS velho e produzir falso-negativo. */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CHROME } = require('./config.js');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launch(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'f25-chrome-'));
  const proc = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--headless=new',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', () => {});

  for (let i = 0; i < 100; i++) {
    try {
      const v = await get(`http://127.0.0.1:${port}/json/version`);
      return { proc, profile, ws: JSON.parse(v).webSocketDebuggerUrl, port };
    } catch (e) { await sleep(100); }
  }
  throw new Error('chrome nao subiu');
}

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); })
        .on('error', rej);
  });
}

/* Cliente CDP sobre a implementação de WebSocket nativa do Node 22. */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.sessions = new Map();
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id != null && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        this.handlers.forEach(h => h(m));
      }
    });
  }
  ready() { return new Promise(r => this.ws.readyState === 1 ? r() : this.ws.addEventListener('open', r)); }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  close() { this.ws.close(); }
}

/* Espera uma condição no page context (poll), com timeout explícito.
   Nunca usar sleep fixo para "esperar renderizar" — a v2.9.0 gastou 120 s
   num hang assim. */
async function waitFor(cdp, sid, expr, { timeout = 15000, label = expr } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await cdp.send('Runtime.evaluate',
      { expression: `!!(${expr})`, returnByValue: true }, sid);
    if (r.result && r.result.value === true) return true;
    await sleep(150);
  }
  throw new Error(`timeout esperando: ${label}`);
}

async function evalJson(cdp, sid, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `Promise.resolve((async()=>{${expr}})()).then(JSON.stringify)`,
    returnByValue: true, awaitPromise: true,
  }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return JSON.parse(r.result.value);
}


/* Emula um celular DE VERDADE. So setDeviceMetricsOverride nao basta: o
   js/variant.js decide por userAgentData.mobile / userAgent / pointer:coarse
   (nunca por innerWidth — ver BUG-069), entao um viewport estreito com UA de
   desktop e redirecionado para index.html. Isto exercita o caminho real de
   deteccao em vez de curto-circuitar com ?ui=mobile. */
const UA_PIXEL7 = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

async function emularCelular(cdp, sid) {
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: UA_PIXEL7,
    acceptLanguage: 'pt-BR,pt;q=0.9',
    platform: 'Linux armv8l',
    userAgentMetadata: {
      brands: [{ brand: 'Chromium', version: '125' }, { brand: 'Google Chrome', version: '125' }],
      fullVersion: '125.0.0.0', platform: 'Android', platformVersion: '14',
      architecture: '', model: 'Pixel 7', mobile: true,
    },
  }, sid);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    screenWidth: 390, screenHeight: 844,
  }, sid);
}

module.exports = { launch, CDP, waitFor, evalJson, sleep, get, emularCelular };
