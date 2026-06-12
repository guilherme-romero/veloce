/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/weather (proxy server-side para Open-Meteo)
   Evita problemas de CORS/CSP no cliente ao fazer o fetch pelo servidor.
   Coordenadas fixas: São Paulo/SP (lat=-23.5505, lon=-46.6333)
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

const SP_LAT = -23.5505;
const SP_LON = -46.6333;

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${SP_LAT}&longitude=${SP_LON}` +
  `&daily=weathercode,temperature_2m_max,temperature_2m_min,` +
  `precipitation_probability_max,wind_speed_10m_max` +
  `&timezone=America%2FSao_Paulo&forecast_days=7`;

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/weather/forecast', async (req, reply) => {
    try {
      const resp = await fetch(OPEN_METEO_URL);
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      const json = await resp.json();
      return json.daily;
    } catch (err) {
      req.log.warn({ err }, 'weather proxy falhou');
      return reply.code(502).send({ error: 'Previsão indisponível' });
    }
  });
}

module.exports = routes;
