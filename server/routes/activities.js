/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/activities (visao unificada Strava + Garmin)
   GET /api/activities/unified?days=N
     Retorna lista combinada, deduplicada via activity_links.
     Regra de prioridade: Garmin > Strava quando ha link.
   POST /api/activities/match
     Roda o matcher manualmente (geralmente automatico apos sync).
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const { runMatching } = require('../utils/activity-matcher');
const { getUnifiedActivities, getMaxHr } = require('../services/activities');

const DEFAULT_DAYS = 180;

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // Issue #43: refinar a FC máxima (js/profile.js) só precisa do pico, não
  // da lista inteira de atividades — MAX(fc_max) em SQL.
  fastify.get('/api/activities/max-hr', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), 1825);
    return { maxHr: getMaxHr(fastify.db, days) };
  });

  fastify.get('/api/activities/unified', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), 1825);
    const { items: all, garminCount, stravaCount } = getUnifiedActivities(fastify.db, days);
    const totalLinks = fastify.db.prepare('SELECT COUNT(*) AS n FROM activity_links').get().n || 0;

    // Paginação OPT-IN e não-quebrável: sem ?limit, retorna tudo (comportamento
    // atual — os gráficos dependem da janela completa por ?days). Com ?limit, capa
    // em [offset, offset+limit) para consumidores que só querem as primeiras N.
    const rawLimit  = parseInt(req.query?.limit, 10);
    const rawOffset = parseInt(req.query?.offset, 10);
    const limit  = (Number.isFinite(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 1000) : null;
    const offset = (Number.isFinite(rawOffset) && rawOffset > 0) ? rawOffset : 0;
    const items  = limit != null ? all.slice(offset, offset + limit) : all;

    return {
      items,
      counts: {
        strava: stravaCount,
        garmin: garminCount,
        links: totalLinks,
        total: all.length,   // total antes da paginação (novo, aditivo)
      },
    };
  });

  // GET /api/activities/weekly-records
  // Maior distância e maior elevação SEMANAL (semana começando no domingo),
  // considerando só atividades de ciclismo, sobre todo o histórico. Usa a mesma
  // regra de dedup do /unified (Garmin + Strava sem link — Garmin vence).
  fastify.get('/api/activities/weekly-records', async () => {
    const CYCLING = ['cycling', 'road_biking', 'mountain_biking', 'gravel_cycling'];
    const ph = CYCLING.map(() => '?').join(',');

    const garmin = fastify.db.prepare(
      `SELECT data_inicio AS d, distancia_m AS dist, elevacao_m AS elev
         FROM garmin_activities WHERE tipo IN (${ph})`
    ).all(...CYCLING);

    const strava = fastify.db.prepare(
      `SELECT s.data_inicio AS d, s.distancia_m AS dist, s.elevacao_m AS elev
         FROM strava_activities s
         LEFT JOIN activity_links l ON l.strava_id = s.id_strava
        WHERE l.strava_id IS NULL AND s.tipo IN (${ph})`
    ).all(...CYCLING);

    // Início da semana (domingo) para uma data YYYY-MM-DD, em UTC (evita desvio de fuso).
    const weekStart = (iso) => {
      const dt = new Date(iso + 'T12:00:00Z');
      if (isNaN(dt.getTime())) return null;
      dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); // getUTCDay(): 0 = domingo
      return dt.toISOString().slice(0, 10);
    };

    const weeks = new Map(); // weekStartISO -> { dist, elev }
    for (const a of [...garmin, ...strava]) {
      const wk = a.d ? weekStart(a.d) : null;
      if (!wk) continue;
      const cur = weeks.get(wk) || { dist: 0, elev: 0 };
      cur.dist += a.dist || 0;
      cur.elev += a.elev || 0;
      weeks.set(wk, cur);
    }

    let distancia = null, elevacao = null;
    for (const [wk, v] of weeks) {
      if (v.dist > 0 && (!distancia || v.dist > distancia.value)) distancia = { value: v.dist, weekStart: wk };
      if (v.elev > 0 && (!elevacao || v.elev > elevacao.value)) elevacao = { value: v.elev, weekStart: wk };
    }
    return { distancia, elevacao };
  });

  fastify.post('/api/activities/match', async () => {
    const res = runMatching(fastify.db);
    return { ok: true, ...res };
  });

  // DELETE /api/activities/:fonte/:id
  // Remove atividade do banco local. O próximo sync re-importará se ainda existir na fonte.
  fastify.delete('/api/activities/:fonte/:id', async (req, reply) => {
    const { fonte, id } = req.params;
    const numId = parseInt(id, 10);
    if (!isFinite(numId)) return reply.code(400).send({ error: 'id inválido' });

    let result;
    if (fonte === 'garmin') {
      result = fastify.db.prepare('DELETE FROM garmin_activities WHERE id_garmin = ?').run(numId);
    } else if (fonte === 'strava') {
      result = fastify.db.prepare('DELETE FROM strava_activities WHERE id_strava = ?').run(numId);
    } else {
      return reply.code(400).send({ error: 'fonte inválida' });
    }
    if (result.changes === 0) return reply.code(404).send({ error: 'atividade não encontrada' });
    return { ok: true, fonte, id: numId };
  });
}

module.exports = routes;
