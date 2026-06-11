/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/garmin
   GET  /api/garmin/status        estado da sessao
   POST /api/garmin/login         primeiro login (opcional: { mfa })
   POST /api/garmin/logout        remove sessao salva
   POST /api/garmin/sync          importa atividades de bike
   GET  /api/garmin/activities    lista atividades importadas
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');
const garmin = require('../services/garmin');
const { autoFillBike } = require('../utils/training-log-helper');
const { runMatching } = require('../utils/activity-matcher');

const DEFAULT_DAYS = 90;

function rowToActivity(r) {
  return {
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
    wattsAvg:     r.watts_avg,
    wattsMax:     r.watts_max,
    cadenciaAvg:  r.cadencia_avg,
    velMediaKmh:  r.velocidade_avg != null ? +(r.velocidade_avg * 3.6).toFixed(2) : null,
    velMaxKmh:    r.velocidade_max != null ? +(r.velocidade_max * 3.6).toFixed(2) : null,
    calorias:     r.calorias,
    deviceId:     r.device_id,
    importedAt:   r.imported_at,
  };
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  const upsertStmt = fastify.db.prepare(`
    INSERT INTO garmin_activities (
      id_garmin, nome, tipo, data_inicio, inicio_local, inicio_gmt, distancia_m,
      tempo_mov_s, tempo_total_s, elevacao_m, fc_media, fc_max,
      watts_avg, watts_max, cadencia_avg, velocidade_avg, velocidade_max,
      calorias, device_id, payload
    ) VALUES (
      @id_garmin, @nome, @tipo, @data_inicio, @inicio_local, @inicio_gmt, @distancia_m,
      @tempo_mov_s, @tempo_total_s, @elevacao_m, @fc_media, @fc_max,
      @watts_avg, @watts_max, @cadencia_avg, @velocidade_avg, @velocidade_max,
      @calorias, @device_id, @payload
    )
    ON CONFLICT(id_garmin) DO UPDATE SET
      nome=excluded.nome, tipo=excluded.tipo, distancia_m=excluded.distancia_m,
      tempo_mov_s=excluded.tempo_mov_s, tempo_total_s=excluded.tempo_total_s,
      elevacao_m=excluded.elevacao_m, fc_media=excluded.fc_media, fc_max=excluded.fc_max,
      watts_avg=excluded.watts_avg, watts_max=excluded.watts_max,
      cadencia_avg=excluded.cadencia_avg, velocidade_avg=excluded.velocidade_avg,
      velocidade_max=excluded.velocidade_max, calorias=excluded.calorias,
      device_id=excluded.device_id, payload=excluded.payload
  `);

  function markBikeDay(dataISO, bikeMetrics, fonteId) {
    return autoFillBike(fastify.db, dataISO, bikeMetrics, 'garmin', fonteId);
  }

  // ── GET /api/garmin/status ───────────────────────────────────────
  fastify.get('/api/garmin/status', async () => {
    const st = await garmin.status();
    const meta = fastify.db.prepare('SELECT last_sync, last_count FROM garmin_sync_meta WHERE id = 1').get();
    if (meta) { st.lastSyncAt = meta.last_sync; st.lastSyncCount = meta.last_count; }
    const total = fastify.db.prepare('SELECT COUNT(*) AS n FROM garmin_activities').get();
    st.totalActivities = total?.n || 0;
    return st;
  });

  // ── POST /api/garmin/login ───────────────────────────────────────
  fastify.post('/api/garmin/login', async (req, reply) => {
    const mfa = (req.body && req.body.mfa) || null;
    try {
      const res = await garmin.login(mfa);
      return res;
    } catch (err) {
      if (err.code === 'MFA_REQUIRED') {
        return reply.code(409).send({ error: 'MFA_REQUIRED' });
      }
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── POST /api/garmin/logout ──────────────────────────────────────
  fastify.post('/api/garmin/logout', async () => garmin.logout());

  // ── POST /api/garmin/sync ────────────────────────────────────────
  fastify.post('/api/garmin/sync', async (req, reply) => {
    const days = Math.min(Math.max(parseInt((req.body && req.body.days) || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), 365);
    try {
      const acts = await garmin.listActivities(days);
      const bikeActs = acts.filter(garmin.isBikeActivity);

      let imported = 0, updated = 0, daysMarked = 0;
      const trx = fastify.db.transaction((items) => {
        for (const a of items) {
          const startLocal = a.startTimeLocal || a.startTimeGMT;
          if (!startLocal) continue;
          const dataIso = String(startLocal).slice(0, 10);
          const before = fastify.db.prepare('SELECT 1 FROM garmin_activities WHERE id_garmin = ?').get(a.activityId);
          upsertStmt.run({
            id_garmin:       a.activityId,
            nome:            a.activityName || null,
            tipo:            a.activityType || null,
            data_inicio:     dataIso,
            inicio_local:    a.startTimeLocal || null,
            inicio_gmt:      a.startTimeGMT || null,
            distancia_m:     a.distance ?? null,
            tempo_mov_s:     a.movingDuration != null ? Math.round(a.movingDuration) : null,
            tempo_total_s:   a.duration != null ? Math.round(a.duration) : null,
            elevacao_m:      a.elevationGain ?? null,
            fc_media:        a.averageHR ?? null,
            fc_max:          a.maxHR ?? null,
            watts_avg:       a.averagePower ?? null,
            watts_max:       a.maxPower ?? null,
            cadencia_avg:    a.averageBikingCadenceInRevPerMinute ?? null,
            velocidade_avg:  a.averageSpeed ?? null,
            velocidade_max:  a.maxSpeed ?? null,
            calorias:        a.calories ?? null,
            device_id:       a.deviceId ?? null,
            payload:         JSON.stringify(a),
          });
          if (before) updated++; else imported++;
          const bikeMetrics = {
            km:        a.distance != null ? +(a.distance / 1000).toFixed(2) : null,
            tempoMovS: a.movingDuration != null ? Math.round(a.movingDuration) : null,
            elevM:     a.elevationGain ?? null,
            fcMedia:   a.averageHR ?? null,
            fcMax:     a.maxHR ?? null,
          };
          const tag = markBikeDay(dataIso, bikeMetrics, a.activityId);
          if (tag === 'created' || tag === 'updated') daysMarked++;
        }
      });
      trx(bikeActs);

      const nowIso = new Date().toISOString();
      fastify.db.prepare(`
        INSERT INTO garmin_sync_meta (id, last_sync, last_count) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_sync = excluded.last_sync, last_count = excluded.last_count
      `).run(nowIso, bikeActs.length);

      const matchRes = runMatching(fastify.db);

      return {
        ok: true,
        days,
        totalRetornadas: acts.length,
        totalBike: bikeActs.length,
        imported, updated, daysMarked,
        links: matchRes.created,
        lastSync: nowIso,
      };
    } catch (err) {
      req.log.error({ err }, 'garmin sync falhou');
      if (err.code === 'NO_SESSION' || err.code === 'MFA_REQUIRED') {
        return reply.code(401).send({ error: err.code });
      }
      return reply.code(502).send({ error: 'Falha ao sincronizar com Garmin' });
    }
  });

  // ── POST /api/garmin/sync-weights ────────────────────────────────
  // Importa pesagens da Garmin. Manual vence; pesagem garmin existente
  // do mesmo dia eh atualizada pra mais recente.
  fastify.post('/api/garmin/sync-weights', async (req, reply) => {
    const days = Math.min(Math.max(parseInt((req.body && req.body.days) || 365, 10) || 365, 1), 3650);
    try {
      const weighins = await garmin.listWeighIns(days);
      let imported = 0, updated = 0, skipped = 0;

      const findByDateStmt = fastify.db.prepare('SELECT id, fonte FROM weights WHERE data = ? ORDER BY id DESC');
      const updateStmt     = fastify.db.prepare('UPDATE weights SET peso = ? WHERE id = ?');
      const insertStmt     = fastify.db.prepare('INSERT INTO weights (data, peso, tipo, fonte) VALUES (?, ?, ?, ?)');

      const trx = fastify.db.transaction((items) => {
        for (const w of items) {
          if (!w.data || w.pesoKg == null) continue;
          const existing = findByDateStmt.all(w.data);
          const hasManual = existing.some(r => (r.fonte || 'manual') === 'manual');
          if (hasManual) { skipped++; continue; }
          const existingGarmin = existing.find(r => r.fonte === 'garmin');
          if (existingGarmin) {
            updateStmt.run(w.pesoKg, existingGarmin.id);
            updated++;
          } else {
            insertStmt.run(w.data, w.pesoKg, 'atual', 'garmin');
            imported++;
          }
        }
      });
      trx(weighins);

      return { ok: true, days, totalRetornadas: weighins.length, imported, updated, skipped };
    } catch (err) {
      req.log.error({ err }, 'garmin sync-weights falhou');
      if (err.code === 'NO_SESSION') return reply.code(401).send({ error: err.code });
      return reply.code(502).send({ error: 'Falha ao sincronizar pesagens' });
    }
  });

  // ── POST /api/garmin/sync-health ─────────────────────────────────
  fastify.post('/api/garmin/sync-health', async (req, reply) => {
    const days = Math.min(Math.max(parseInt((req.body && req.body.days) || 30, 10) || 30, 1), 365);
    try {
      const items = await garmin.listDailyHealth(days);
      const upsert = fastify.db.prepare(`
        INSERT INTO garmin_daily_health (
          data, passos, kcal_total, kcal_ativa, distancia_m, fc_repouso, fc_min, fc_max,
          sono_total_s, sono_deep_s, sono_light_s, sono_rem_s, stress_avg, stress_max,
          body_battery_max, body_battery_drain, hrv_semanal_avg, hrv_noite_avg, hrv_status
        ) VALUES (
          @data, @passos, @kcal_total, @kcal_ativa, @distancia_m, @fc_repouso, @fc_min, @fc_max,
          @sono_total_s, @sono_deep_s, @sono_light_s, @sono_rem_s, @stress_avg, @stress_max,
          @body_battery_max, @body_battery_drain, @hrv_semanal_avg, @hrv_noite_avg, @hrv_status
        ) ON CONFLICT(data) DO UPDATE SET
          passos=excluded.passos, kcal_total=excluded.kcal_total, kcal_ativa=excluded.kcal_ativa,
          distancia_m=excluded.distancia_m, fc_repouso=excluded.fc_repouso, fc_min=excluded.fc_min,
          fc_max=excluded.fc_max, sono_total_s=excluded.sono_total_s, sono_deep_s=excluded.sono_deep_s,
          sono_light_s=excluded.sono_light_s, sono_rem_s=excluded.sono_rem_s,
          stress_avg=excluded.stress_avg, stress_max=excluded.stress_max,
          body_battery_max=excluded.body_battery_max, body_battery_drain=excluded.body_battery_drain,
          hrv_semanal_avg=excluded.hrv_semanal_avg, hrv_noite_avg=excluded.hrv_noite_avg,
          hrv_status=excluded.hrv_status
      `);
      const trx = fastify.db.transaction((rows) => rows.forEach(r => upsert.run({
        data: r.data, passos: r.passos ?? null, kcal_total: r.kcal_total ?? null,
        kcal_ativa: r.kcal_ativa ?? null, distancia_m: r.distancia_m ?? null,
        fc_repouso: r.fc_repouso ?? null, fc_min: r.fc_min ?? null, fc_max: r.fc_max ?? null,
        sono_total_s: r.sono_total_s ?? null, sono_deep_s: r.sono_deep_s ?? null,
        sono_light_s: r.sono_light_s ?? null, sono_rem_s: r.sono_rem_s ?? null,
        stress_avg: r.stress_avg ?? null, stress_max: r.stress_max ?? null,
        body_battery_max: r.body_battery_max ?? null, body_battery_drain: r.body_battery_drain ?? null,
        hrv_semanal_avg: r.hrv_semanal_avg ?? null, hrv_noite_avg: r.hrv_noite_avg ?? null,
        hrv_status: r.hrv_status ?? null,
      })));
      trx(items);
      return { ok: true, days, synced: items.length };
    } catch (err) {
      req.log.error({ err }, 'garmin sync-health falhou');
      return reply.code(502).send({ error: 'Falha ao sincronizar saude' });
    }
  });

  // ── GET /api/garmin/health?days=N ────────────────────────────────
  fastify.get('/api/garmin/health', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || 30, 10) || 30, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return fastify.db.prepare('SELECT * FROM garmin_daily_health WHERE data >= ? ORDER BY data DESC').all(cutoff);
  });

  // ── GET /api/garmin/activities ───────────────────────────────────
  fastify.get('/api/garmin/activities', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const rows = fastify.db
      .prepare(`SELECT * FROM garmin_activities WHERE data_inicio >= ? ORDER BY inicio_local DESC`)
      .all(cutoff);
    return rows.map(rowToActivity);
  });
}

module.exports = routes;
