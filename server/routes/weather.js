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

function buildUrl({ lat, lon, days = 7 }) {
  return `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=${DAILY_FIELDS}` +
    `&timezone=America%2FSao_Paulo&forecast_days=${days}`;
}

async function fetchOpenMeteo(url, reply, log) {
  const resp = await fetch(url);
  if (!resp.ok) {
    log.warn({ status: resp.status }, 'open-meteo respondeu não-ok');
    return reply.code(502).send({ error: 'Previsão indisponível' });
  }
  return await resp.json();
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── GET /api/weather/forecast — São Paulo (Passeios) ──────────────────
  fastify.get('/api/weather/forecast', async (req, reply) => {
    try {
      const json = await fetchOpenMeteo(buildUrl({ lat: SP_LAT, lon: SP_LON }), reply, req.log);
      if (reply.sent) return;
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
    try {
      const json = await fetchOpenMeteo(buildUrl({ lat, lon }), reply, req.log);
      if (reply.sent) return;
      const daily = json.daily;

      // Se uma data específica foi pedida, retorna apenas aquele dia
      const dateISO = req.query?.date ? String(req.query.date).slice(0, 10) : null;
      if (dateISO) {
        const idx = daily.time.indexOf(dateISO);
        if (idx < 0) {
          return reply.code(404).send({ error: 'Data fora do range de 7 dias' });
        }
        const day = {};
        for (const key of Object.keys(daily)) {
          day[key] = daily[key][idx];
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
