#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   STRAVA — troca um authorization_code pelo refresh_token definitivo.
   Uso: node scripts/strava-exchange.js <code>
   Le STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET de server/.env.
   Imprime os tokens recebidos e a linha pronta pra colar no .env.
═══════════════════════════════════════════════════════════════════════ */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const code = process.argv[2];
if (!code) {
  console.error('Uso: node scripts/strava-exchange.js <code>');
  process.exit(1);
}
const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = process.env;
if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
  console.error('STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET ausentes no .env');
  process.exit(1);
}

(async () => {
  const body = new URLSearchParams({
    client_id:     STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    code,
    grant_type:    'authorization_code',
  });
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const txt = await resp.text();
  if (!resp.ok) {
    console.error('Falha:', resp.status, txt);
    process.exit(1);
  }
  const data = JSON.parse(txt);
  console.log('OK — escopo:', data.scope || '(nao retornado)');
  console.log('athlete:', data.athlete && {
    id: data.athlete.id,
    name: `${data.athlete.firstname} ${data.athlete.lastname}`,
  });
  console.log('\nCole esta linha em server/.env (substituindo a atual):');
  console.log(`STRAVA_REFRESH_TOKEN=${data.refresh_token}`);
})().catch(e => { console.error(e); process.exit(1); });
