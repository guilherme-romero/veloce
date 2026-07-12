/* ═══════════════════════════════════════════════════════════════════════
   SCHEDULER — sincronização automática a cada 30 minutos (horário local).
   Chamado uma vez em index.js após o servidor subir.
═══════════════════════════════════════════════════════════════════════ */
const garmin = require('./services/garmin');
const strava = require('./services/strava');
const { autoFillBike } = require('./utils/training-log-helper');
const { runMatching }  = require('./utils/activity-matcher');

const SYNC_INTERVAL_MIN = 30;     // intervalo do sync automático (minutos)
const CHECK_INTERVAL_MS = 60_000; // verifica a cada minuto

// Evita disparo duplo no mesmo slot (chave = "YYYY-MM-DD:HH:bloco")
const _synced = new Set();

function slotKey() {
  const now = new Date();
  const block = Math.floor(now.getMinutes() / SYNC_INTERVAL_MIN);
  return `${now.toISOString().slice(0, 10)}:${now.getHours()}:${block}`;
}

// ── Garmin: atividades de bike ─────────────────────────────────────────
async function syncGarminActivities(db, log) {
  const upsert = db.prepare(`
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

  const acts      = await garmin.listActivities(90);
  const bikeActs  = acts.filter(garmin.isBikeActivity);
  let imported = 0, updated = 0;

  const trx = db.transaction((items) => {
    for (const a of items) {
      const startLocal = a.startTimeLocal || a.startTimeGMT;
      if (!startLocal) continue;
      const dataIso = String(startLocal).slice(0, 10);
      const before = db.prepare('SELECT 1 FROM garmin_activities WHERE id_garmin = ?').get(a.activityId);
      upsert.run({
        id_garmin:      a.activityId,
        nome:           a.activityName   || null,
        tipo:           a.activityType   || null,
        data_inicio:    dataIso,
        inicio_local:   a.startTimeLocal || null,
        inicio_gmt:     a.startTimeGMT   || null,
        distancia_m:    a.distance       ?? null,
        tempo_mov_s:    a.movingDuration != null ? Math.round(a.movingDuration) : null,
        tempo_total_s:  a.duration       != null ? Math.round(a.duration)       : null,
        elevacao_m:     a.elevationGain  ?? null,
        fc_media:       a.averageHR      ?? null,
        fc_max:         a.maxHR          ?? null,
        watts_avg:      a.averagePower   ?? null,
        watts_max:      a.maxPower       ?? null,
        cadencia_avg:   a.averageBikingCadenceInRevPerMinute ?? null,
        velocidade_avg: a.averageSpeed   ?? null,
        velocidade_max: a.maxSpeed       ?? null,
        calorias:       a.calories       ?? null,
        device_id:      a.deviceId       ?? null,
        payload:        JSON.stringify(a),
      });
      if (before) updated++; else imported++;
      autoFillBike(db, dataIso, {
        km:        a.distance != null ? +(a.distance / 1000).toFixed(2) : null,
        tempoMovS: a.movingDuration != null ? Math.round(a.movingDuration) : null,
        elevM:     a.elevationGain ?? null,
        fcMedia:   a.averageHR ?? null,
        fcMax:     a.maxHR ?? null,
      }, 'garmin', a.activityId);
    }
  });
  trx(bikeActs);

  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO garmin_sync_meta (id, last_sync, last_count, last_total_count) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync=excluded.last_sync, last_count=excluded.last_count,
      last_total_count=excluded.last_total_count
  `).run(nowIso, bikeActs.length, acts.length);

  log.info({ imported, updated, total: bikeActs.length }, '[scheduler] garmin atividades');
  return { imported, updated };
}

// ── Garmin: saúde diária ───────────────────────────────────────────────
async function syncGarminHealth(db, log) {
  const items = await garmin.listDailyHealth(30);
  const upsert = db.prepare(`
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
      distancia_m=excluded.distancia_m, fc_repouso=excluded.fc_repouso,
      fc_min=excluded.fc_min, fc_max=excluded.fc_max,
      sono_total_s=excluded.sono_total_s, sono_deep_s=excluded.sono_deep_s,
      sono_light_s=excluded.sono_light_s, sono_rem_s=excluded.sono_rem_s,
      stress_avg=excluded.stress_avg, stress_max=excluded.stress_max,
      body_battery_max=excluded.body_battery_max, body_battery_drain=excluded.body_battery_drain,
      hrv_semanal_avg=excluded.hrv_semanal_avg, hrv_noite_avg=excluded.hrv_noite_avg,
      hrv_status=excluded.hrv_status
  `);
  const trx = db.transaction((rows) => rows.forEach(r => upsert.run({
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
  log.info({ synced: items.length }, '[scheduler] garmin saúde');
}

// ── Garmin: readiness ──────────────────────────────────────────────────
async function syncGarminReadiness(db, log) {
  const items = await garmin.listTrainingReadiness(14);
  const upsert = db.prepare(`
    INSERT INTO garmin_training_readiness
      (data, score, level, feedback_short, feedback_long, sleep_score,
       sleep_factor_pct, recovery_time_min, recovery_factor_pct,
       acwr_factor_pct, hrv_factor_pct, hrv_weekly_avg, stress_factor_pct)
    VALUES
      (@data, @score, @level, @feedback_short, @feedback_long, @sleep_score,
       @sleep_factor_pct, @recovery_time_min, @recovery_factor_pct,
       @acwr_factor_pct, @hrv_factor_pct, @hrv_weekly_avg, @stress_factor_pct)
    ON CONFLICT(data) DO UPDATE SET
      score=excluded.score, level=excluded.level,
      feedback_short=excluded.feedback_short, feedback_long=excluded.feedback_long,
      sleep_score=excluded.sleep_score, sleep_factor_pct=excluded.sleep_factor_pct,
      recovery_time_min=excluded.recovery_time_min, recovery_factor_pct=excluded.recovery_factor_pct,
      acwr_factor_pct=excluded.acwr_factor_pct, hrv_factor_pct=excluded.hrv_factor_pct,
      hrv_weekly_avg=excluded.hrv_weekly_avg, stress_factor_pct=excluded.stress_factor_pct
  `);
  const trx = db.transaction((rows) => rows.forEach(r => upsert.run({
    data: r.data, score: r.score ?? null, level: r.level ?? null,
    feedback_short: r.feedbackShort ?? null, feedback_long: r.feedbackLong ?? null,
    sleep_score: r.sleepScore ?? null, sleep_factor_pct: r.sleepScoreFactorPercent ?? null,
    recovery_time_min: r.recoveryTime ?? null, recovery_factor_pct: r.recoveryTimeFactorPercent ?? null,
    acwr_factor_pct: r.acwrFactorPercent ?? null, hrv_factor_pct: r.hrvFactorPercent ?? null,
    hrv_weekly_avg: r.hrvWeeklyAverage ?? null, stress_factor_pct: r.stressHistoryFactorPercent ?? null,
  })));
  trx(items);
  log.info({ synced: items.length }, '[scheduler] garmin readiness');
}

// ── Garmin: pesagens ───────────────────────────────────────────────────
async function syncGarminWeights(db, log) {
  const weighins = await garmin.listWeighIns(30);
  const findStmt = db.prepare('SELECT id, fonte FROM weights WHERE data = ? ORDER BY id DESC');
  const updateStmt = db.prepare('UPDATE weights SET peso = ? WHERE id = ?');
  const insertStmt = db.prepare('INSERT INTO weights (data, peso, tipo, fonte) VALUES (?, ?, ?, ?)');
  let imported = 0;

  const trx = db.transaction((items) => {
    for (const w of items) {
      if (!w.data || w.pesoKg == null) continue;
      const existing = findStmt.all(w.data);
      if (existing.some(r => (r.fonte || 'manual') === 'manual')) continue;
      const existingGarmin = existing.find(r => r.fonte === 'garmin');
      if (existingGarmin) {
        updateStmt.run(w.pesoKg, existingGarmin.id);
      } else {
        insertStmt.run(w.data, w.pesoKg, 'atual', 'garmin');
        imported++;
      }
    }
  });
  trx(weighins);

  // Atualiza pesoAtual no perfil
  const latest = db.prepare("SELECT peso FROM weights WHERE fonte='garmin' ORDER BY data DESC LIMIT 1").get();
  if (latest) {
    const row = db.prepare('SELECT payload FROM user_profile WHERE id=1').get();
    if (row) {
      try {
        const p = JSON.parse(row.payload || '{}');
        p.pesoAtual = latest.peso;
        db.prepare('UPDATE user_profile SET payload=?, updated_at=CURRENT_TIMESTAMP WHERE id=1').run(JSON.stringify(p));
      } catch (_) {}
    }
  }
  log.info({ imported, total: weighins.length }, '[scheduler] garmin pesos');
}

// ── Strava: atividades ─────────────────────────────────────────────────
async function syncStravaActivities(db, log) {
  if (!strava.isConfigured()) { log.info('[scheduler] strava não configurado — pulando'); return; }

  const days = 30;
  const after = Math.floor((Date.now() - days * 86400_000) / 1000);
  const activities = await strava.listActivities({ after });
  const bikeActs = activities.filter(strava.isBikeActivity);

  const upsert = db.prepare(`
    INSERT INTO strava_activities (
      id_strava, nome, tipo, data_inicio, inicio_iso,
      distancia_m, tempo_mov_s, tempo_total_s, elevacao_m,
      fc_media, fc_max, watts_avg, cadencia_avg,
      velocidade_avg, velocidade_max, kudos, payload
    ) VALUES (
      @id_strava, @nome, @tipo, @data_inicio, @inicio_iso,
      @distancia_m, @tempo_mov_s, @tempo_total_s, @elevacao_m,
      @fc_media, @fc_max, @watts_avg, @cadencia_avg,
      @velocidade_avg, @velocidade_max, @kudos, @payload
    )
    ON CONFLICT(id_strava) DO UPDATE SET
      nome=excluded.nome, tipo=excluded.tipo, distancia_m=excluded.distancia_m,
      tempo_mov_s=excluded.tempo_mov_s, tempo_total_s=excluded.tempo_total_s,
      elevacao_m=excluded.elevacao_m, fc_media=excluded.fc_media, fc_max=excluded.fc_max,
      watts_avg=excluded.watts_avg, cadencia_avg=excluded.cadencia_avg,
      velocidade_avg=excluded.velocidade_avg, velocidade_max=excluded.velocidade_max,
      kudos=excluded.kudos, payload=excluded.payload
  `);

  let imported = 0, updated = 0;
  const trx = db.transaction((items) => {
    for (const a of items) {
      const dataIso = (a.start_date_local || a.start_date || '').slice(0, 10);
      if (!dataIso) continue;
      const before = db.prepare('SELECT 1 FROM strava_activities WHERE id_strava = ?').get(a.id);
      upsert.run({
        id_strava:      a.id,
        nome:           a.name || null,
        tipo:           a.sport_type || a.type || null,
        data_inicio:    dataIso,
        inicio_iso:     a.start_date_local || a.start_date,
        distancia_m:    a.distance ?? null,
        tempo_mov_s:    a.moving_time ?? null,
        tempo_total_s:  a.elapsed_time ?? null,
        elevacao_m:     a.total_elevation_gain ?? null,
        fc_media:       a.average_heartrate ?? null,
        fc_max:         a.max_heartrate ?? null,
        watts_avg:      a.average_watts ?? null,
        cadencia_avg:   a.average_cadence ?? null,
        velocidade_avg: a.average_speed ?? null,
        velocidade_max: a.max_speed ?? null,
        kudos:          a.kudos_count ?? null,
        payload:        JSON.stringify(a),
      });
      if (before) updated++; else imported++;
      autoFillBike(db, dataIso, {
        km:        a.distance != null ? +(a.distance / 1000).toFixed(2) : null,
        tempoMovS: a.moving_time ?? null,
        elevM:     a.total_elevation_gain ?? null,
        fcMedia:   a.average_heartrate ?? null,
        fcMax:     a.max_heartrate ?? null,
      }, 'strava', a.id);
    }
  });
  trx(bikeActs);

  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO strava_sync_meta (id, last_sync, last_count) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_sync=excluded.last_sync, last_count=excluded.last_count
  `).run(nowIso, bikeActs.length);

  runMatching(db);
  log.info({ imported, updated, total: bikeActs.length }, '[scheduler] strava atividades');
}

// ── Sync completo ──────────────────────────────────────────────────────
async function runFullSync(db, log) {
  log.info('[scheduler] iniciando sync automático');
  const garminOk = garmin.isConfigured();
  const results = { garmin: {}, strava: {}, errors: [] };

  if (garminOk) {
    try { results.garmin.acts     = await syncGarminActivities(db, log); } catch (e) { results.errors.push('garmin-acts: ' + e.message); }
    try { await syncGarminHealth(db, log);     } catch (e) { results.errors.push('garmin-health: ' + e.message); }
    try { await syncGarminReadiness(db, log);  } catch (e) { results.errors.push('garmin-readiness: ' + e.message); }
    try { await syncGarminWeights(db, log);    } catch (e) { results.errors.push('garmin-weights: ' + e.message); }
  } else {
    log.info('[scheduler] garmin sem sessão — pulando');
  }

  try { await syncStravaActivities(db, log); } catch (e) { results.errors.push('strava: ' + e.message); }

  if (results.errors.length) log.warn({ errors: results.errors }, '[scheduler] sync com erros');
  else log.info('[scheduler] sync automático concluído');
}

// ── Setup ──────────────────────────────────────────────────────────────
function setup(db, log) {
  setInterval(() => {
    const now = new Date();
    // Dispara apenas nas viradas de :00 e :30 (alinhado ao relógio).
    if (now.getMinutes() % SYNC_INTERVAL_MIN !== 0) return;
    const key = slotKey();
    if (_synced.has(key)) return;
    _synced.add(key);
    // Mantém o Set pequeno — basta lembrar dos slots recentes.
    if (_synced.size > 10) {
      const oldest = [..._synced][0];
      _synced.delete(oldest);
    }
    runFullSync(db, log).catch(e => log.error({ err: e }, '[scheduler] erro no sync automático'));
  }, CHECK_INTERVAL_MS);

  log.info(`[scheduler] ativo — sync automático a cada ${SYNC_INTERVAL_MIN} min`);
}

module.exports = { setup };
