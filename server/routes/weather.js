/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/weather (proxy server-side para Open-Meteo)
   Evita problemas de CORS/CSP no cliente ao fazer o fetch pelo servidor.
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

const SP_LAT = -23.5505;
const SP_LON = -46.6333;

// Campos diários expandidos para ciclismo (Fase 12.3.2)
const DAILY_FIELDS = [
  'weathercode',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
  'windgusts_10m_max',
  'uv_index_max',
  'sunrise',
  'sunset',
].join(',');

// Campos horários para modal de rota (4 h após saída)
const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weathercode',
  'wind_speed_10m',
  'windgusts_10m',
  'uv_index',
].join(',');

function buildUrl({ lat, lon, days = 7, includeHourly = false }) {
  let url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=${DAILY_FIELDS}` +
    `&timezone=America%2FSao_Paulo&forecast_days=${days}`;
  if (includeHourly) url += `&hourly=${HOURLY_FIELDS}`;
  return url;
}

// Lança em caso de falha — o caller decide o status. Evita o antipadrão
// de escrever no reply dentro de um helper (BUG-011).
async function fetchOpenMeteo(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = new Error(`open-meteo respondeu ${resp.status}`);
    err.upstreamStatus = resp.status;
    throw err;
  }
  return await resp.json();
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── GET /api/weather/forecast — São Paulo (Passeios) ──────────────────
  fastify.get('/api/weather/forecast', async (req, reply) => {
    try {
      const json = await fetchOpenMeteo(buildUrl({ lat: SP_LAT, lon: SP_LON }));
      return json.daily;
    } catch (err) {
      req.log.warn({ err }, 'weather proxy falhou');
      return reply.code(502).send({ error: 'Previsão indisponível' });
    }
  });

  // ── GET /api/weather/point — coordenadas dinâmicas (Rotas GPX) ────────
  // Query: lat=, lon=, date=YYYY-MM-DD (opcional, retorna o dia específico)
  fastify.get('/api/weather/point', async (req, reply) => {
    const lat = parseFloat(req.query?.lat);
    const lon = parseFloat(req.query?.lon);
    if (!isFinite(lat) || !isFinite(lon)) {
      return reply.code(400).send({ error: 'lat/lon obrigatorios' });
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return reply.code(400).send({ error: 'lat/lon fora do intervalo' });
    }
    // Valida formato da data antes de bater no upstream (BUG-018)
    const rawDate = req.query?.date ? String(req.query.date).slice(0, 10) : null;
    if (rawDate && !ISO_DATE_RE.test(rawDate)) {
      return reply.code(400).send({ error: 'date deve estar em YYYY-MM-DD' });
    }
    try {
      const json = await fetchOpenMeteo(buildUrl({ lat, lon, includeHourly: !!rawDate }));
      const daily = json.daily;

      if (rawDate) {
        const idx = daily.time.indexOf(rawDate);
        if (idx < 0) {
          return reply.code(404).send({ error: 'Data fora do range de 7 dias' });
        }
        const day = {};
        for (const key of Object.keys(daily)) {
          day[key] = daily[key][idx];
        }
        // Agrega dados horários do dia solicitado
        if (json.hourly && json.hourly.time) {
          const prefix = rawDate + 'T';
          const hourly = {};
          for (const key of Object.keys(json.hourly)) {
            if (key === 'time') continue;
            hourly[key] = [];
          }
          const hours = [];
          json.hourly.time.forEach((t, i) => {
            if (!t.startsWith(prefix)) return;
            hours.push(t.slice(11, 16)); // "HH:MM"
            for (const key of Object.keys(hourly)) {
              hourly[key].push(json.hourly[key][i]);
            }
          });
          day.hourly = { time: hours, ...hourly };
        }
        return day;
      }

      return daily;
    } catch (err) {
      req.log.warn({ err }, 'weather point falhou');
      return reply.code(502).send({ error: 'Previsão indisponível' });
    }
  });
}

module.exports = routes;
