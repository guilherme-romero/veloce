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

const DEFAULT_DAYS = 180;

function stravaRow(r) {
  return {
    fonte:        'strava',
    id:           r.id_strava,
    nome:         r.nome,
    tipo:         r.tipo,
    data:         r.data_inicio,
    inicio:       r.inicio_iso,
    distanciaKm:  r.distancia_m != null ? +(r.distancia_m / 1000).toFixed(2) : null,
    tempoMovS:    r.tempo_mov_s,
    tempoTotalS:  r.tempo_total_s,
    elevacaoM:    r.elevacao_m,
    fcMedia:      r.fc_media,
    fcMax:        r.fc_max,
    velMediaKmh:  r.velocidade_avg != null ? +(r.velocidade_avg * 3.6).toFixed(2) : null,
  };
}
function garminRow(r) {
  return {
    fonte:        'garmin',
    id:           r.id_garmin,
    nome:         r.nome,
    tipo:         r.tipo,
    data:         r.data_inicio,
    inicio:       r.inicio_local,
    distanciaKm:  r.distancia_m != null ? +(r.distancia_m / 1000).toFixed(2) : null,
    tempoMovS:    r.tempo_mov_s,
    tempoTotalS:  r.tempo_total_s,
    elevacaoM:    r.elevacao_m,
    fcMedia:      r.fc_media,
    fcMax:        r.fc_max,
    velMediaKmh:  r.velocidade_avg != null ? +(r.velocidade_avg * 3.6).toFixed(2) : null,
    velMaxKmh:    r.velocidade_max != null ? +(r.velocidade_max * 3.6).toFixed(2) : null,
    wattsAvg:     r.watts_avg,
    wattsMax:     r.watts_max,
    cadenciaAvg:  r.cadencia_avg,
    calorias:     r.calorias,
  };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/activities/unified', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    const garmin = fastify.db
      .prepare(`SELECT * FROM garmin_activities WHERE data_inicio >= ? ORDER BY inicio_local DESC`)
      .all(cutoff)
      .map(garminRow);

    // Strava EXCLUINDO os que tem link com Garmin (Garmin vence)
    const strava = fastify.db
      .prepare(`
        SELECT s.* FROM strava_activities s
        LEFT JOIN activity_links l ON l.strava_id = s.id_strava
        WHERE s.data_inicio >= ? AND l.strava_id IS NULL
        ORDER BY s.inicio_iso DESC
      `)
      .all(cutoff)
      .map(stravaRow);

    const totalLinks = fastify.db.prepare('SELECT COUNT(*) AS n FROM activity_links').get().n || 0;

    return {
      items: [...garmin, ...strava].sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))),
      counts: {
        strava: strava.length,
        garmin: garmin.length,
        links: totalLinks,
      },
    };
  });

  fastify.post('/api/activities/match', async () => {
    const res = runMatching(fastify.db);
    return { ok: true, ...res };
  });
}

module.exports = routes;
