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
    velMaxKmh:    r.velocidade_max != null ? +(r.velocidade_max * 3.6).toFixed(2) : null,
    wattsAvg:     r.watts_avg,
    cadenciaAvg:  r.cadencia_avg,
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
    const days = Math.min(Math.max(parseInt(req.query?.days || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), 1825);
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

    const all = [...garmin, ...strava].sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));

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
        strava: strava.length,
        garmin: garmin.length,
        links: totalLinks,
        total: all.length,   // total antes da paginação (novo, aditivo)
      },
    };
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
