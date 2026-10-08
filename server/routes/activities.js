/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/activities (visao unificada Strava + Garmin)
   GET /api/activities/unified?days=N
     Retorna lista combinada, deduplicada via activity_links.
     Regra de prioridade: Garmin > Strava quando ha link.
   GET /api/activities/latest
     Só a atividade mais recente (issue #42) — sino de notificações.
   POST /api/activities/match
     Roda o matcher manualmente (geralmente automatico apos sync).
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const { runMatching } = require('../utils/activity-matcher');
const { getUnifiedActivities, getLatestActivity } = require('../services/activities');

const DEFAULT_DAYS = 180;

// Tipos excluídos do record semanal: e-bike e indoor/virtual contam para
// fitness mas não são "saída de bike" pra fins de recorde de distância/
// elevação. Mesmo critério de server/routes/bikes.js (EXCLUDED_*_TYPES) —
// duplicado aqui de propósito, ver issue #13 (unificação de módulos, ainda
// não feita).
const EXCLUDED_STRAVA_TYPES = ['VirtualRide', 'EBikeRide'];
const EXCLUDED_GARMIN_TYPES = ['virtual_ride', 'indoor_cycling', 'e_bike_fitness'];

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // Issue #42: o sino de notificações só precisa de 1 item, mas chamava
  // /unified?days=1825&limit=1 — paginação acontecia DEPOIS do SELECT *
  // completo. Endpoint dedicado com ORDER BY + LIMIT 1 em SQL.
  fastify.get('/api/activities/latest', async () => {
    return { item: getLatestActivity(fastify.db) };
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
  // considerando só atividades de ciclismo real (exclui e-bike/indoor/virtual),
  // sobre todo o histórico. Usa a mesma regra de dedup do /unified (Garmin +
  // Strava sem link — Garmin vence).
  //
  // Issue #41: antes, agrupava por semana num Map em JS depois de puxar TODAS
  // as linhas pro Node. Agora o agrupamento (strftime pra achar o domingo da
  // semana + SUM) e o top-1 de cada métrica são feitos em SQL — só 1 linha
  // volta pro JS. Bônus: a query antiga filtrava Strava por `tipo IN
  // ('cycling','road_biking',...)` (vocabulário do GARMIN) — o `tipo` real do
  // Strava é 'Ride'/'VirtualRide'/etc., então NENHUMA atividade Strava jamais
  // entrava nesse cálculo. Corrigido usando o vocabulário certo de cada fonte.
  const weeklyRecordsStmt = fastify.db.prepare(`
    WITH combined AS (
      SELECT data_inicio AS d, distancia_m AS dist, elevacao_m AS elev
        FROM garmin_activities
       WHERE tipo IS NULL OR tipo NOT IN (${EXCLUDED_GARMIN_TYPES.map(() => '?').join(',')})
      UNION ALL
      SELECT s.data_inicio AS d, s.distancia_m AS dist, s.elevacao_m AS elev
        FROM strava_activities s
        LEFT JOIN activity_links l ON l.strava_id = s.id_strava
       WHERE l.strava_id IS NULL
         AND (s.tipo IS NULL OR s.tipo NOT IN (${EXCLUDED_STRAVA_TYPES.map(() => '?').join(',')}))
    ),
    weekly AS (
      SELECT date(d, '-' || strftime('%w', d) || ' days') AS wk,
             SUM(dist) AS dist, SUM(elev) AS elev
        FROM combined
       WHERE d IS NOT NULL
       GROUP BY wk
    )
    SELECT
      (SELECT wk   FROM weekly WHERE dist > 0 ORDER BY dist DESC LIMIT 1) AS dist_week,
      (SELECT dist FROM weekly WHERE dist > 0 ORDER BY dist DESC LIMIT 1) AS dist_value,
      (SELECT wk   FROM weekly WHERE elev > 0 ORDER BY elev DESC LIMIT 1) AS elev_week,
      (SELECT elev FROM weekly WHERE elev > 0 ORDER BY elev DESC LIMIT 1) AS elev_value
  `);

  fastify.get('/api/activities/weekly-records', async () => {
    const row = weeklyRecordsStmt.get(...EXCLUDED_GARMIN_TYPES, ...EXCLUDED_STRAVA_TYPES);
    return {
      distancia: row.dist_week != null ? { value: row.dist_value, weekStart: row.dist_week } : null,
      elevacao:  row.elev_week != null ? { value: row.elev_value, weekStart: row.elev_week } : null,
    };
  });

  // ?full=1 força reexame total, ignorando a otimização de last_run (issue
  // #40) — ferramenta manual/debug pra recuperar um match perdido.
  fastify.post('/api/activities/match', async (req) => {
    const full = req.query?.full === '1' || req.query?.full === 'true';
    const res = runMatching(fastify.db, { full });
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
