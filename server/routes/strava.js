/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/strava
   GET  /api/strava/status        estado da integracao
   POST /api/strava/sync          importa atividades de bike dos ultimos N dias
   GET  /api/strava/activities    lista atividades importadas (cache local)
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const strava = require('../services/strava');
const { autoFillBike } = require('../utils/training-log-helper');
const { runMatching } = require('../utils/activity-matcher');

const DEFAULT_DAYS = 90;

function rowToActivity(r) {
  return {
    id:            r.id_strava,
    nome:          r.nome,
    tipo:          r.tipo,
    data:          r.data_inicio,
    inicio:        r.inicio_iso,
    distanciaKm:   r.distancia_m != null ? +(r.distancia_m / 1000).toFixed(2) : null,
    tempoMovS:     r.tempo_mov_s,
    tempoTotalS:   r.tempo_total_s,
    elevacaoM:     r.elevacao_m,
    fcMedia:       r.fc_media,
    fcMax:         r.fc_max,
    wattsAvg:      r.watts_avg,
    cadenciaAvg:   r.cadencia_avg,
    velMediaKmh:   r.velocidade_avg != null ? +(r.velocidade_avg * 3.6).toFixed(2) : null,
    velMaxKmh:     r.velocidade_max != null ? +(r.velocidade_max * 3.6).toFixed(2) : null,
    kudos:         r.kudos,
    importedAt:    r.imported_at,
  };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── helpers internos ─────────────────────────────────────────────
  const upsertStmt = fastify.db.prepare(`
    INSERT INTO strava_activities (
      id_strava, nome, tipo, data_inicio, inicio_iso, distancia_m,
      tempo_mov_s, tempo_total_s, elevacao_m, fc_media, fc_max,
      watts_avg, cadencia_avg, velocidade_avg, velocidade_max, kudos, payload
    ) VALUES (
      @id_strava, @nome, @tipo, @data_inicio, @inicio_iso, @distancia_m,
      @tempo_mov_s, @tempo_total_s, @elevacao_m, @fc_media, @fc_max,
      @watts_avg, @cadencia_avg, @velocidade_avg, @velocidade_max, @kudos, @payload
    )
    ON CONFLICT(id_strava) DO UPDATE SET
      nome=excluded.nome, tipo=excluded.tipo, distancia_m=excluded.distancia_m,
      tempo_mov_s=excluded.tempo_mov_s, tempo_total_s=excluded.tempo_total_s,
      elevacao_m=excluded.elevacao_m, fc_media=excluded.fc_media, fc_max=excluded.fc_max,
      watts_avg=excluded.watts_avg, cadencia_avg=excluded.cadencia_avg,
      velocidade_avg=excluded.velocidade_avg, velocidade_max=excluded.velocidade_max,
      kudos=excluded.kudos, payload=excluded.payload
  `);

  // Helper de auto-enriquecimento extraido em utils/training-log-helper.js
  function markBikeDay(dataISO, bikeMetrics, fonteId) {
    return autoFillBike(fastify.db, dataISO, bikeMetrics, 'strava', fonteId);
  }

  // ── GET /api/strava/status ───────────────────────────────────────
  fastify.get('/api/strava/status', async (req, reply) => {
    try {
      const status = await strava.getStatus();
      const meta = fastify.db.prepare('SELECT last_sync, last_count FROM strava_sync_meta WHERE id = 1').get();
      if (meta) {
        status.lastSyncAt = meta.last_sync;
        status.lastSyncCount = meta.last_count;
      }
      const total = fastify.db.prepare('SELECT COUNT(*) AS n FROM strava_activities').get();
      status.totalActivities = total?.n || 0;
      return status;
    } catch (err) {
      req.log.error({ err }, 'strava status falhou');
      return reply.code(500).send({ error: 'Falha ao consultar Strava' });
    }
  });

  // ── POST /api/strava/sync ────────────────────────────────────────
  fastify.post('/api/strava/sync', async (req, reply) => {
    if (!strava.isConfigured()) {
      return reply.code(400).send({ error: 'Strava nao configurado' });
    }
    const daysRaw = parseInt((req.body && req.body.days) || DEFAULT_DAYS, 10);
    const days = Math.min(Math.max(daysRaw || DEFAULT_DAYS, 1), 365);
    const after = Math.floor((Date.now() - days * 86400_000) / 1000);

    try {
      const activities = await strava.listActivities({ after });
      const bikeActs = activities.filter(strava.isBikeActivity);

      let imported = 0, updated = 0, daysMarked = 0;
      const trx = fastify.db.transaction((items) => {
        for (const a of items) {
          const dataIso = (a.start_date_local || a.start_date || '').slice(0, 10);
          if (!dataIso) continue;
          const before = fastify.db.prepare('SELECT 1 FROM strava_activities WHERE id_strava = ?').get(a.id);
          upsertStmt.run({
            id_strava:       a.id,
            nome:            a.name || null,
            tipo:            a.sport_type || a.type || null,
            data_inicio:     dataIso,
            inicio_iso:      a.start_date_local || a.start_date,
            distancia_m:     a.distance ?? null,
            tempo_mov_s:     a.moving_time ?? null,
            tempo_total_s:   a.elapsed_time ?? null,
            elevacao_m:      a.total_elevation_gain ?? null,
            fc_media:        a.average_heartrate ?? null,
            fc_max:          a.max_heartrate ?? null,
            watts_avg:       a.average_watts ?? null,
            cadencia_avg:    a.average_cadence ?? null,
            velocidade_avg:  a.average_speed ?? null,
            velocidade_max:  a.max_speed ?? null,
            kudos:           a.kudos_count ?? null,
            payload:         JSON.stringify(a),
          });
          if (before) updated++; else imported++;
          const bikeMetrics = {
            km:        a.distance != null ? +(a.distance / 1000).toFixed(2) : null,
            tempoMovS: a.moving_time ?? null,
            elevM:     a.total_elevation_gain ?? null,
            fcMedia:   a.average_heartrate ?? null,
            fcMax:     a.max_heartrate ?? null,
          };
          const tag = markBikeDay(dataIso, bikeMetrics, a.id);
          if (tag === 'created' || tag === 'updated') daysMarked++;
        }
      });
      trx(bikeActs);

      const nowIso = new Date().toISOString();
      fastify.db.prepare(`
        INSERT INTO strava_sync_meta (id, last_sync, last_count) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_sync = excluded.last_sync, last_count = excluded.last_count
      `).run(nowIso, bikeActs.length);

      // Roda matching cruzado (custo baixo, so atividades sem link)
      const matchRes = runMatching(fastify.db);

      return {
        ok: true,
        days,
        totalRetornadas: activities.length,
        totalBike: bikeActs.length,
        imported,
        updated,
        daysMarked,
        links: matchRes.created,
        lastSync: nowIso,
      };
    } catch (err) {
      req.log.error({ err }, 'strava sync falhou');
      return reply.code(502).send({ error: 'Falha ao sincronizar com Strava' });
    }
  });

  // ── GET /api/strava/activity/:id — detalhe (com polyline) ──────
  fastify.get('/api/strava/activity/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });
    const row = fastify.db
      .prepare('SELECT id_strava, nome, payload, data_inicio, inicio_iso FROM strava_activities WHERE id_strava = ?')
      .get(id);
    if (!row) return reply.code(404).send({ error: 'atividade nao encontrada' });
    let raw = {};
    try { raw = JSON.parse(row.payload || '{}'); } catch (_) {}
    return {
      id:       row.id_strava,
      nome:     row.nome,
      data:    row.data_inicio,
      inicio:  row.inicio_iso,
      polyline: raw.map?.summary_polyline || null,
    };
  });

  // ── GET /api/strava/activities ───────────────────────────────────
  fastify.get('/api/strava/activities', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const rows = fastify.db
      .prepare(`SELECT id_strava, nome, tipo, data_inicio, inicio_iso, distancia_m,
                       tempo_mov_s, tempo_total_s, elevacao_m, fc_media, fc_max,
                       watts_avg, cadencia_avg, velocidade_avg, velocidade_max, kudos, imported_at
                  FROM strava_activities
                 WHERE data_inicio >= ?
                 ORDER BY inicio_iso DESC`)
      .all(cutoff);
    return rows.map(rowToActivity);
  });
}

module.exports = routes;
