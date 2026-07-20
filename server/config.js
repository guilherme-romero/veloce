/* ═══════════════════════════════════════════════════════════════════════
   CONFIG — leitura e validacao do .env
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
// ENV_FILE permite que uma 2a instancia (ex.: demo) carregue um arquivo de
// ambiente proprio SEM ler o server/.env de producao (que tem tokens reais
// Strava/Garmin). Sem ENV_FILE, comportamento padrao: carrega ./.env.
require('dotenv').config(process.env.ENV_FILE ? { path: process.env.ENV_FILE } : undefined);

const required = ['ADMIN_USER', 'ADMIN_PASS_HASH', 'JWT_SECRET'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[config] Variaveis obrigatorias ausentes no .env: ${missing.join(', ')}`);
  console.error('Veja server/.env.example para referencia.');
  process.exit(1);
}

module.exports = {
  ADMIN_USER:      process.env.ADMIN_USER,
  ADMIN_PASS_HASH: process.env.ADMIN_PASS_HASH,
  JWT_SECRET:      process.env.JWT_SECRET,
  SESSION_DAYS:    parseInt(process.env.SESSION_DAYS || '7', 10),
  PORT:            parseInt(process.env.PORT || '3000', 10),
  HOST:            process.env.HOST || '127.0.0.1',
  COOKIE_SECURE:   process.env.COOKIE_SECURE === 'true',

  // Banco/cookie parametrizaveis (default = comportamento single-user atual).
  // Permite rodar uma 2a instancia (ex.: demo) apontando para outro DB_PATH
  // e com COOKIE_NAME distinto, sem tocar no codigo. Ver docs/instancia demo.
  DATA_DIR:        process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'),
  DB_PATH:         process.env.DB_PATH || path.join(process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'), 'training.db'),
  COOKIE_NAME:     process.env.COOKIE_NAME || 'tb_session',
  COOKIE_PATH:     process.env.COOKIE_PATH || '/',

  // Origens permitidas pelo CORS (hardening — mesmo servindo same-origin via
  // nginx). Lista separada por virgula no .env; default cobre producao + dev.
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS ||
    'https://bike.arkhamcloud.net,http://localhost:8000,http://127.0.0.1:8000')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Strava (opcional — se nao configurado, /api/strava/* retorna disconnected)
  STRAVA_CLIENT_ID:     process.env.STRAVA_CLIENT_ID || '',
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
  STRAVA_REFRESH_TOKEN: process.env.STRAVA_REFRESH_TOKEN || '',
};
