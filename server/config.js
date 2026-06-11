/* ═══════════════════════════════════════════════════════════════════════
   CONFIG — leitura e validacao do .env
═══════════════════════════════════════════════════════════════════════ */
require('dotenv').config();

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

  // Strava (opcional — se nao configurado, /api/strava/* retorna disconnected)
  STRAVA_CLIENT_ID:     process.env.STRAVA_CLIENT_ID || '',
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
  STRAVA_REFRESH_TOKEN: process.env.STRAVA_REFRESH_TOKEN || '',
};
