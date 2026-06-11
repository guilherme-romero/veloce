/* ═══════════════════════════════════════════════════════════════════════
   STRAVA — cliente single-user.
   Mantem access_token em memoria e refresca via POST /oauth/token quando
   expirado. O refresh_token vem do .env (visivel no painel Strava do
   proprio dono do app — nao precisa de OAuth porque so existe 1 usuario).
═══════════════════════════════════════════════════════════════════════ */
const config = require('../config');

const STRAVA_OAUTH_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE  = 'https://www.strava.com/api/v3';

// Cache em memoria
let _accessToken = null;
let _expiresAt   = 0;        // unix seconds
let _athlete     = null;     // { id, firstname, lastname, ... } populado no primeiro refresh
let _lastSync    = null;     // ISO string da ultima chamada bem-sucedida a API Strava

function isConfigured() {
  return !!(config.STRAVA_CLIENT_ID && config.STRAVA_CLIENT_SECRET && config.STRAVA_REFRESH_TOKEN);
}

async function refreshAccessToken() {
  if (!isConfigured()) throw new Error('Strava nao configurado no .env');

  const body = new URLSearchParams({
    client_id:     config.STRAVA_CLIENT_ID,
    client_secret: config.STRAVA_CLIENT_SECRET,
    grant_type:    'refresh_token',
    refresh_token: config.STRAVA_REFRESH_TOKEN,
  });

  const resp = await fetch(STRAVA_OAUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Strava oauth/token ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  _accessToken = data.access_token;
  _expiresAt   = data.expires_at; // unix seconds
  // Se o Strava devolver um novo refresh_token, fica registrado em log para
  // o usuario atualizar o .env. Tokens raramente rotacionam, mas pode acontecer.
  if (data.refresh_token && data.refresh_token !== config.STRAVA_REFRESH_TOKEN) {
    console.warn('[strava] Novo refresh_token recebido — atualize STRAVA_REFRESH_TOKEN no .env:', data.refresh_token);
  }
  return _accessToken;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  // refresh com 60s de folga
  if (!_accessToken || _expiresAt - now < 60) {
    await refreshAccessToken();
  }
  return _accessToken;
}

async function apiGet(path, query = {}) {
  const token = await getAccessToken();
  const url = new URL(STRAVA_API_BASE + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Strava GET ${path} ${resp.status}: ${txt}`);
  }
  _lastSync = new Date().toISOString();
  return resp.json();
}

async function fetchAthlete() {
  const data = await apiGet('/athlete');
  _athlete = {
    id:        data.id,
    firstname: data.firstname,
    lastname:  data.lastname,
    username:  data.username,
    profile:   data.profile_medium || data.profile || null,
    city:      data.city,
    country:   data.country,
  };
  return _athlete;
}

async function getStatus() {
  if (!isConfigured()) {
    return { configured: false, connected: false };
  }
  try {
    if (!_athlete) await fetchAthlete();
    return {
      configured: true,
      connected:  true,
      athlete:    _athlete,
      lastSync:   _lastSync,
      tokenExpiresAt: _expiresAt ? new Date(_expiresAt * 1000).toISOString() : null,
    };
  } catch (err) {
    return { configured: true, connected: false, error: err.message };
  }
}

const BIKE_TYPES = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide']);

// Lista atividades paginadas a partir de "after" (epoch seconds)
async function listActivities({ after, perPage = 100, maxPages = 5 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await apiGet('/athlete/activities', { after, per_page: perPage, page });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

function isBikeActivity(a) {
  return BIKE_TYPES.has(a.type) || BIKE_TYPES.has(a.sport_type);
}

module.exports = {
  isConfigured,
  getAccessToken,
  apiGet,
  fetchAthlete,
  getStatus,
  listActivities,
  isBikeActivity,
};
