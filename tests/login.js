/* Loga UMA vez e guarda o cookie. /api/auth/login tem rate-limit de 5/min,
   entao todo run reusa o cookie salvo em vez de logar de novo. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '.cookie');
const cfg = require('./config.js');
const _u = new URL(cfg.BASE);
const BASE = { host: _u.hostname, port: _u.port || 80 };

function post(pathname, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = http.request({ ...BASE, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      r => { let d = ''; r.on('data', c => d += c);
             r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: d })); });
    req.on('error', rej); req.write(data); req.end();
  });
}

async function login(user, pass) {
  const r = await post('/api/auth/login', { user, pass });
  if (r.status !== 200) throw new Error(`login falhou: ${r.status} ${r.body}`);
  const setCookie = r.headers['set-cookie'];
  if (!setCookie || !setCookie.length) throw new Error('login sem Set-Cookie');
  const raw = setCookie[0];
  const [nameValue] = raw.split(';');
  const [name, ...rest] = nameValue.split('=');
  const cookie = { name: name.trim(), value: rest.join('='), domain: '127.0.0.1', path: '/' };
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookie), { mode: 0o600 });
  return cookie;
}

function saved() {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
}

module.exports = { login, saved, COOKIE_FILE };

if (require.main === module) {
  // Preferir TB_USER/TB_PASS: argv fica no historico do shell.
  const user = cfg.USER || process.argv[2];
  const pass = cfg.PASS || process.argv[3];
  if (!user || !pass) {
    console.error('uso: TB_USER=… TB_PASS=… node login.js   (ou: node login.js <user> <pass>)');
    process.exit(1);
  }
  login(user, pass)
    .then(c => console.log('cookie salvo:', c.name))
    .catch(e => { console.error(String(e.message)); process.exit(1); });
}
