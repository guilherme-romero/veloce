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

  // ── GET /api/garmin/activity/:id/polyline ────────────────────────
  // Cache: salva no campo polyline da tabela garmin_activities
  fastify.get('/api/garmin/activity/:id/polyline', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });
    try {
      const row = fastify.db.prepare('SELECT polyline FROM garmin_activities WHERE id_garmin = ?').get(id);
      if (!row) return reply.code(404).send({ error: 'atividade nao encontrada' });
      if (row.polyline) return { id, polyline: row.polyline, cached: true };
      const polyline = await garmin.getActivityPolyline(id);
      if (polyline) {
        fastify.db.prepare('UPDATE garmin_activities SET polyline = ? WHERE id_garmin = ?').run(polyline, id);
      }
      return { id, polyline, cached: false };
    } catch (err) {
      req.log.warn({ err }, 'garmin polyline falhou');
      return { id, polyline: null, error: 'fetch_failed' };
    }
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

  // ═══════════════════════════════════════════════════════════════
  // FASE 9 — extras (Training Readiness, Training Status, PBs, Hill+Endurance)
  // ═══════════════════════════════════════════════════════════════

  // Mapa numérico do trainingStatus (Garmin retorna código)
  const TS_LABELS = {
    0: 'NO_STATUS', 1: 'DETRAINING', 2: 'RECOVERY', 3: 'MAINTAINING',
    4: 'PRODUCTIVE', 5: 'RECOVERY', 6: 'PEAKING', 7: 'OVERREACHING',
    8: 'UNPRODUCTIVE', 9: 'STRAINED',
  };

  // ── POST /api/garmin/sync-extras ─────────────────────────────────
  fastify.post('/api/garmin/sync-extras', async (req, reply) => {
    const days = Math.min(Math.max(parseInt((req.body && req.body.days) || 7, 10) || 7, 1), 90);
    try {
      const [readiness, status, prs, scores] = await Promise.all([
        garmin.listTrainingReadiness(days).catch(e => { req.log.warn('readiness:' + e.message); return []; }),
        garmin.listTrainingStatus(Math.min(days, 30)).catch(e => { req.log.warn('status:' + e.message); return []; }),
        garmin.listPersonalRecords().catch(e => { req.log.warn('pr:' + e.message); return []; }),
        garmin.listFitnessScores(days).catch(e => { req.log.warn('scores:' + e.message); return []; }),
      ]);

      // Upserts
      const upReadiness = fastify.db.prepare(`
        INSERT INTO garmin_training_readiness
          (data, score, level, feedback_short, feedback_long, sleep_score,
           sleep_factor_pct, recovery_time_h, recovery_factor_pct,
           acwr_factor_pct, hrv_factor_pct, hrv_weekly_avg, stress_factor_pct)
        VALUES
          (@data, @score, @level, @feedback_short, @feedback_long, @sleep_score,
           @sleep_factor_pct, @recovery_time_h, @recovery_factor_pct,
           @acwr_factor_pct, @hrv_factor_pct, @hrv_weekly_avg, @stress_factor_pct)
        ON CONFLICT(data) DO UPDATE SET
          score=excluded.score, level=excluded.level,
          feedback_short=excluded.feedback_short, feedback_long=excluded.feedback_long,
          sleep_score=excluded.sleep_score, sleep_factor_pct=excluded.sleep_factor_pct,
          recovery_time_h=excluded.recovery_time_h, recovery_factor_pct=excluded.recovery_factor_pct,
          acwr_factor_pct=excluded.acwr_factor_pct, hrv_factor_pct=excluded.hrv_factor_pct,
          hrv_weekly_avg=excluded.hrv_weekly_avg, stress_factor_pct=excluded.stress_factor_pct
      `);
      const upStatus = fastify.db.prepare(`
        INSERT INTO garmin_training_status
          (data, status_code, status_label, status_feedback, load_ratio, load_balance,
           fitness_trend, fitness_trend_sport, vo2max_cycling, vo2max_generic, weekly_load)
        VALUES
          (@data, @status_code, @status_label, @status_feedback, @load_ratio, @load_balance,
           @fitness_trend, @fitness_trend_sport, @vo2max_cycling, @vo2max_generic, @weekly_load)
        ON CONFLICT(data) DO UPDATE SET
          status_code=excluded.status_code, status_label=excluded.status_label,
          status_feedback=excluded.status_feedback, load_ratio=excluded.load_ratio,
          load_balance=excluded.load_balance, fitness_trend=excluded.fitness_trend,
          fitness_trend_sport=excluded.fitness_trend_sport,
          vo2max_cycling=excluded.vo2max_cycling, vo2max_generic=excluded.vo2max_generic,
          weekly_load=excluded.weekly_load
      `);
      const upPR = fastify.db.prepare(`
        INSERT INTO garmin_personal_records
          (id, type_id, status, valor, activity_id, activity_name, activity_type, pr_date, activity_date)
        VALUES (@id, @type_id, @status, @valor, @activity_id, @activity_name, @activity_type, @pr_date, @activity_date)
        ON CONFLICT(id) DO UPDATE SET
          type_id=excluded.type_id, status=excluded.status, valor=excluded.valor,
          activity_id=excluded.activity_id, activity_name=excluded.activity_name,
          activity_type=excluded.activity_type, pr_date=excluded.pr_date,
          activity_date=excluded.activity_date
      `);
      const upScore = fastify.db.prepare(`
        INSERT INTO garmin_fitness_scores
          (data, hill_score, hill_classification, endurance_score, endurance_classification,
           endurance_gauge_lower, endurance_gauge_upper, vo2_max)
        VALUES
          (@data, @hill_score, @hill_classification, @endurance_score, @endurance_classification,
           @endurance_gauge_lower, @endurance_gauge_upper, @vo2_max)
        ON CONFLICT(data) DO UPDATE SET
          hill_score=excluded.hill_score, hill_classification=excluded.hill_classification,
          endurance_score=excluded.endurance_score,
          endurance_classification=excluded.endurance_classification,
          endurance_gauge_lower=excluded.endurance_gauge_lower,
          endurance_gauge_upper=excluded.endurance_gauge_upper,
          vo2_max=excluded.vo2_max
      `);

      const trx = fastify.db.transaction(() => {
        readiness.forEach(r => upReadiness.run({
          data: r.data, score: r.score ?? null, level: r.level ?? null,
          feedback_short: r.feedbackShort ?? null, feedback_long: r.feedbackLong ?? null,
          sleep_score: r.sleepScore ?? null, sleep_factor_pct: r.sleepScoreFactorPercent ?? null,
          recovery_time_h: r.recoveryTime ?? null, recovery_factor_pct: r.recoveryTimeFactorPercent ?? null,
          acwr_factor_pct: r.acwrFactorPercent ?? null, hrv_factor_pct: r.hrvFactorPercent ?? null,
          hrv_weekly_avg: r.hrvWeeklyAverage ?? null, stress_factor_pct: r.stressHistoryFactorPercent ?? null,
        }));
        status.forEach(s => upStatus.run({
          data: s.data,
          status_code: typeof s.status === 'number' ? s.status : null,
          status_label: typeof s.status === 'number' ? (TS_LABELS[s.status] || null) : (s.status ?? null),
          status_feedback: s.statusFeedback ?? null,
          load_ratio: s.loadRatio ?? null, load_balance: s.loadBalance ?? null,
          fitness_trend: typeof s.fitnessTrend === 'number' ? s.fitnessTrend : null,
          fitness_trend_sport: s.fitnessTrendSport ?? null,
          vo2max_cycling: s.vo2MaxCycling ?? null, vo2max_generic: s.vo2MaxGeneric ?? null,
          weekly_load: s.weeklyTrainingLoad ?? null,
        }));
        prs.forEach(p => upPR.run({
          id: p.id, type_id: p.typeId ?? null, status: p.status ?? null,
          valor: p.value ?? null, activity_id: p.activityId ?? null,
          activity_name: p.activityName ?? null, activity_type: p.activityType ?? null,
          pr_date: p.prDate ?? null, activity_date: p.activityDate ?? null,
        }));
        scores.forEach(s => upScore.run({
          data: s.data, hill_score: s.hillScore ?? null,
          hill_classification: s.hillClassification ?? null,
          endurance_score: s.enduranceScore ?? null,
          endurance_classification: s.enduranceClassification ?? null,
          endurance_gauge_lower: s.enduranceGaugeLower ?? null,
          endurance_gauge_upper: s.enduranceGaugeUpper ?? null,
          vo2_max: s.vo2Max ?? null,
        }));
      });
      trx();

      return {
        ok: true, days,
        readiness: readiness.length, status: status.length,
        prs: prs.length, scores: scores.length,
      };
    } catch (err) {
      req.log.error({ err }, 'garmin sync-extras falhou');
      return reply.code(502).send({ error: 'Falha ao sincronizar extras' });
    }
  });

  // ── GET endpoints dos extras ─────────────────────────────────────
  fastify.get('/api/garmin/training-readiness', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || 14, 10) || 14, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return fastify.db.prepare(
      'SELECT * FROM garmin_training_readiness WHERE data >= ? ORDER BY data DESC'
    ).all(cutoff);
  });

  fastify.get('/api/garmin/training-status', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || 30, 10) || 30, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return fastify.db.prepare(
      'SELECT * FROM garmin_training_status WHERE data >= ? ORDER BY data DESC'
    ).all(cutoff);
  });

  fastify.get('/api/garmin/personal-records', async () => {
    return fastify.db.prepare(
      `SELECT * FROM garmin_personal_records
       WHERE status = 'ACCEPTED'
       ORDER BY pr_date DESC, activity_date DESC`
    ).all();
  });

  fastify.get('/api/garmin/fitness-scores', async (req) => {
    const days = Math.min(Math.max(parseInt(req.query?.days || 90, 10) || 90, 1), 365);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return fastify.db.prepare(
      'SELECT * FROM garmin_fitness_scores WHERE data >= ? ORDER BY data DESC'
    ).all(cutoff);
  });
}

module.exports = routes;
