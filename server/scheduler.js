/* ═══════════════════════════════════════════════════════════════════════
   SCHEDULER — sincronização automática a cada 30 minutos (horário local).
   Chamado uma vez em index.js após o servidor subir.
═══════════════════════════════════════════════════════════════════════ */
const garmin = require('./services/garmin');
const strava = require('./services/strava');
const { autoFillBike } = require('./utils/training-log-helper');
const { runMatching }  = require('./utils/activity-matcher');
const { getUnifiedActivities } = require('./services/activities');
const { analisar, lerCache, gerarEArmazenarAnalise } = require('./services/performance-analysis');
const pushDigest = require('./services/push-digest');
const treinoIa = require('./services/weekly-training-plan');
const { diaLocalKey } = require('./utils/datas');
const { Utils } = require('./utils/core-modules');

const SYNC_INTERVAL_MIN = 30;     // intervalo do sync automático (minutos)
const CHECK_INTERVAL_MS = 60_000; // verifica a cada minuto
const ANALISE_HORA      = 6;      // horário fixo (local da LXC, America/Sao_Paulo) do job de IA
const RELATORIO_HORA    = 8;      // dia 1º: envio do relatório mensal pelo Telegram (#95)
const PUSH_HORA         = 18;     // digest de push da véspera dos passeios (#3 F2)
// Não há mais TREINO_IA_DIA: desde a #160 o job é avaliado TODO DIA nesta
// hora, e quem decide se há trabalho é planoCobreSemanaAtual() no service.
const TREINO_IA_HORA    = 6;      // geração automática do plano semanal de Treino IA (#136)

// Evita disparo duplo no mesmo slot (chave = "YYYY-MM-DD:HH:bloco")
const _synced = new Set();
// Evita disparo duplo da Análise de Performance no mesmo dia (chave = "YYYY-MM-DD")
const _analisadoHoje = new Set();
// Evita disparo duplo do relatório mensal no mesmo mês (chave = "YYYY-MM")
const _relatorioEnviado = new Set();

// diaLocalKey vem de ./utils/datas — extraído daqui quando o job do Treino
// IA (#136) passou a precisar da mesma chave de dia local no service.

function slotKey() {
  const now = new Date();
  const block = Math.floor(now.getMinutes() / SYNC_INTERVAL_MIN);
  return `${now.toISOString().slice(0, 10)}:${now.getHours()}:${block}`;
}

// ── Garmin: atividades de bike ─────────────────────────────────────────
async function syncGarminActivities(db, log) {
  const upsert = db.prepare(garmin.ACTIVITY_UPSERT_SQL);
  // Preparado uma vez (fora da transação) — só distingue import de update.
  const exists = db.prepare('SELECT 1 FROM garmin_activities WHERE id_garmin = ?');

  const acts      = await garmin.listActivities(90);
  const bikeActs  = acts.filter(garmin.isBikeActivity);
  let imported = 0, updated = 0;

  const trx = db.transaction((items) => {
    for (const a of items) {
      const startLocal = a.startTimeLocal || a.startTimeGMT;
      if (!startLocal) continue;
      // Sem startTimeLocal, inicio_local fica null e o matcher com a Strava
      // devolve Infinity — a atividade NUNCA casa (BUG-065). Nao inventamos o
      // horario local a partir do GMT: rotular GMT como local seria errado e o
      // desvio de 3h continuaria fora da tolerancia de 300s. Fica registrado.
      if (!a.startTimeLocal) {
        log.warn({ activityId: a.activityId, startTimeGMT: a.startTimeGMT },
          'garmin: atividade sem startTimeLocal — nao vai casar com a Strava');
      }
      const dataIso = String(startLocal).slice(0, 10);
      const before = exists.get(a.activityId);
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
// DESLIGADO no sync automatico desde 2026-08-30: o Strava mudou a politica de
// uso das APIs e a integracao passou a responder 403 (Application Inactive).
// A tentativa a cada 30 min so acumulava ruido no log (330 erros em uma semana)
// sem tocar em dado nenhum. A Garmin atende o projeto; migrar o Strava para o
// modelo novo esta no treino_bike_docs/ROADMAP.md como evolutiva futura, sem previsao.
// Para religar sem mexer no codigo: STRAVA_AUTO_SYNC=on no server/.env.
// A rota MANUAL (POST /api/strava/sync) continua ativa de proposito — serve
// para testar quando a migracao acontecer.
// A flag mora em services/strava.js (`autoSyncHabilitado`) para que a rota
// /api/strava/status possa devolvê-la à UI — assim o toggle da #135 não promete
// um sync periódico que o servidor não executa. Aqui era um `const` de módulo,
// avaliado no require; a função também torna a flag alterável em teste.
async function syncStravaActivities(db, log) {
  if (!strava.autoSyncHabilitado()) { log.info('[scheduler] strava: sync automatico desligado por ambiente — pulando'); return; }
  if (!syncAutoLigado(db, 'stravaSyncAuto')) { log.info('[scheduler] strava: toggle de Conexões desligado — pulando'); return; }
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
  // Preparado uma vez (fora da transação) — só distingue import de update.
  const exists = db.prepare('SELECT 1 FROM strava_activities WHERE id_strava = ?');

  let imported = 0, updated = 0;
  const trx = db.transaction((items) => {
    for (const a of items) {
      const dataIso = (a.start_date_local || a.start_date || '').slice(0, 10);
      if (!dataIso) continue;
      const before = exists.get(a.id);
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

// ── Toggle de ativação por conexão (#135) ──────────────────────────────
// Lê um booleano do JSON de `user_profile` e gateia SÓ o sync automático: o
// sync manual, o "Sincronizar tudo" da Home e o login do Garmin seguem
// funcionando com o toggle desligado (decisão de produto da #135).
//
// `undefined` = LIGADO, e essa inversão é deliberada. O outro toggle do
// perfil (`relatorioMensalTelegram`) é opt-in e usa `!!valor`, então nasce
// desligado; aqui o valor ausente significa "perfil nunca salvou esta chave",
// e tratar isso como desligado pararia o sync de quem nunca abriu o Perfil —
// uma feature nova silenciando uma integração que já funcionava.
//
// Qualquer falha de leitura/parse também devolve `true`: o modo de falha certo
// é continuar sincronizando, não parar sem o usuário ter pedido.
function syncAutoLigado(db, chave) {
  try {
    const row = db.prepare('SELECT payload FROM user_profile WHERE id=1').get();
    if (!row) return true;
    const v = JSON.parse(row.payload || '{}')[chave];
    return v === undefined ? true : !!v;
  } catch (_) {
    return true;
  }
}

// ── Sync completo ──────────────────────────────────────────────────────
async function runFullSync(db, log) {
  log.info('[scheduler] iniciando sync automático');
  const garminOk = garmin.isConfigured() && syncAutoLigado(db, 'garminSyncAuto');
  const results = { garmin: {}, strava: {}, errors: [] };

  if (garminOk) {
    try { results.garmin.acts     = await syncGarminActivities(db, log); } catch (e) { results.errors.push('garmin-acts: ' + e.message); }
    try { await syncGarminHealth(db, log);     } catch (e) { results.errors.push('garmin-health: ' + e.message); }
    try { await syncGarminReadiness(db, log);  } catch (e) { results.errors.push('garmin-readiness: ' + e.message); }
    try { await syncGarminWeights(db, log);    } catch (e) { results.errors.push('garmin-weights: ' + e.message); }
  } else if (!garmin.isConfigured()) {
    log.info('[scheduler] garmin sem sessão — pulando');
  } else {
    log.info('[scheduler] garmin: toggle de Conexões desligado — pulando');
  }

  try { await syncStravaActivities(db, log); } catch (e) { results.errors.push('strava: ' + e.message); }

  if (results.errors.length) log.warn({ errors: results.errors }, '[scheduler] sync com erros');
  else log.info('[scheduler] sync automático concluído');
}

// ── Análise de Performance automática (6h) ──────────────────────────────
// Roda depois do sync (a Atividade de referência precisa já estar no banco).
// Só chama a IA se a referência mudou desde a última análise cacheada —
// evita gastar cota Gemini/Groq em dias sem treino novo (decisão do grilling
// desta feature). Sem retry no mesmo dia se falhar: a UI mostra o cache
// antigo até a tentativa de amanhã às 6h — mesmo comportamento já existente
// quando a IA falha sob demanda.
async function runAnalisePerformance(db, log) {
  const { items } = getUnifiedActivities(db, 365);
  const resultado = analisar({ activities: items });
  if (!resultado.ok) {
    log.info('[scheduler] análise de performance: grupo de comparação insuficiente — pulando');
    return;
  }

  const cache = lerCache(db);
  if (cache && cache.atividade_referencia_id === String(resultado.referenciaId)) {
    log.info('[scheduler] análise de performance: referência sem mudança — pulando (sem gastar IA)');
    return;
  }

  const ultima = resultado.grupo[resultado.grupo.length - 1];
  const grupoResumo = {
    tamanho:     resultado.grupo.length,
    distanciaKm: Math.round(ultima.distanciaKm),
    elevacaoM:   Math.round(ultima.elevacaoM || 0),
  };

  try {
    const row = await gerarEArmazenarAnalise(db, { referenciaId: resultado.referenciaId, deltas: resultado.deltas, grupoResumo });
    const payload = JSON.parse(row.payload);
    log.info({ provider: payload.provider, model: payload.model }, '[scheduler] análise de performance gerada');
  } catch (e) {
    log.warn({ err: e.message, cascata: e.cascata }, '[scheduler] análise de performance: todos os provedores de IA falharam — tenta de novo amanhã');
  }
}

// ── Relatório mensal pelo Telegram (#95, dia 1º) ─────────────────────────
// Gera o PNG resumido (últimos 30 dias) e envia pelo bot. Pula sem ruído se o
// Telegram não está configurado (.env) ou se o toggle do Perfil está desligado
// — mesmo padrão opt-in das outras integrações. Sem retry no mesmo mês: se
// falhar, tenta de novo no dia 1º seguinte.
async function runRelatorioMensal(db, log) {
  const telegram = require('./services/telegram');
  if (!telegram.isConfigured()) {
    log.info('[scheduler] relatório mensal: telegram não configurado — pulando');
    return;
  }
  let ligado = false;
  try {
    const row = db.prepare('SELECT payload FROM user_profile WHERE id=1').get();
    if (row) ligado = !!JSON.parse(row.payload || '{}').relatorioMensalTelegram;
  } catch (_) {}
  if (!ligado) {
    log.info('[scheduler] relatório mensal: toggle do Perfil desligado — pulando');
    return;
  }

  const reportRender = require('./services/report-render');
  const { png, falhou, ruido } = await reportRender.renderPng();
  // Diferente do PDF: aqui um resumo parcial ainda é melhor que nenhum envio
  // mensal (o job só roda no dia 1º), então falha de montagem vira log e o
  // envio segue. `ruido` é console/pageerror — diagnóstico, não veredito.
  if (falhou) log.error({ erro: falhou }, '[scheduler] resumo falhou ao montar — enviando como saiu');
  else if (ruido.length) log.warn({ ruido: ruido.slice(0, 5) }, '[scheduler] erros no console do render do resumo');
  // Relatório de FECHAMENTO do mês anterior (#106/#107): a legenda cita o mês
  // que fechou, não o atual. Dia 0 do mês atual = último dia do mês anterior.
  const mesAnt = new Date(); mesAnt.setDate(0);
  const mes = mesAnt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  await telegram.sendPhoto(png, `Veloce Labs · fechamento de ${mes}`);
  log.info('[scheduler] relatório mensal enviado pelo Telegram');
}

// ── Treino IA automático (#136, segunda às TREINO_IA_HORA) ───────────────
// Gera o plano semanal sem depender de o usuário abrir o app e clicar em
// Gerar. Decisão de produto: sempre gera — o plano anterior vira ativo=0 e
// fica no histórico, igual ao que o botão faz.
//
// A dedup é PERSISTENTE (planoGeradoHoje, no service) em vez do Set em
// memória dos outros jobs: a hora do job tem dois slots de tick (:00 e :30)
// e um restart entre eles zeraria o Set, gerando um segundo plano e uma
// segunda chamada de IA. Efeito colateral aceito: se o usuário gerou um
// plano manualmente mais cedo na mesma segunda, o job pula em vez de
// queimar outra chamada.
//
// atribuirDatas() ancora na segunda da semana corrente, então rodando na
// própria segunda o plano cobre hoje→domingo — nada a ajustar aqui.
async function runTreinoIa(db, log) {
  // #160 — guard de SEMANA, não de dia. O job passou a rodar todo dia às 6h
  // (antes, só segunda), e é este guard que o faz parar assim que a semana
  // está coberta. Olha as datas dentro do plano ativo, não o gerado_em.
  if (treinoIa.planoCobreSemanaAtual(db)) {
    log.info('[scheduler] treino IA: já existe plano cobrindo a semana corrente — pulando');
    return;
  }
  if (treinoIa.planoGeradoHoje(db)) {
    log.info('[scheduler] treino IA: já existe plano gerado hoje — pulando');
    return;
  }
  const perfil = treinoIa.lerPerfilTreinoIa(db);
  if (!perfil) {
    log.info('[scheduler] treino IA: perfil de Treino IA incompleto — pulando');
    return;
  }
  try {
    const insumos = treinoIa.montarInsumos(db);
    const row = await treinoIa.gerarEArmazenarPlano(db, { perfil, insumos });
    const payload = JSON.parse(row.payload);
    log.info({ provider: payload.provider, model: payload.model },
      '[scheduler] plano semanal de Treino IA gerado');
  } catch (e) {
    // Mesmo tratamento da análise de performance: a cascata de provedores de
    // IA falhar é esperado de vez em quando e não pode derrubar o sync. O
    // plano ativo anterior fica intacto — gerarEArmazenarPlano só desativa
    // dentro da transação que insere o novo, e a IA roda antes dela.
    //
    // Retry: como nada foi gravado, planoGeradoHoje segue false e o slot :30
    // da mesma hora tenta mais uma vez (custa uma segunda cascata). Se
    // falhar de novo, só na segunda seguinte.
    log.warn({ err: e.message, cascata: e.cascata, bruto: e.bruto && String(e.bruto).slice(0, 500) },
      '[scheduler] treino IA: geração falhou — o plano anterior segue ativo');
    // #160 — a mesma falha, agora também no banco. Antes isto vivia só aqui no
    // journal, cuja leitura exige senha: em 2026-11-09 o diagnóstico dependeu
    // de o usuário rodar o journalctl. Nenhuma tela lê essa tabela.
    treinoIa.registrarTentativaFalha(db, {
      erro: e.message,
      detalhe: JSON.stringify({ cascata: e.cascata, bruto: e.bruto && String(e.bruto).slice(0, 500) }),
    });
  }
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
    let chain = runFullSync(db, log).catch(e => log.error({ err: e }, '[scheduler] erro no sync automático'));

    // Análise de Performance: só às ANALISE_HORA:00, uma vez por dia — sempre
    // cai num slot de sync (minuto 0 é múltiplo de 30), por isso fica
    // encadeada aqui em vez de um segundo setInterval: espera o sync
    // terminar (sucesso ou erro — runFullSync já trata cada fonte com seu
    // próprio try/catch, então uma falha aqui seria algo bem incomum) antes
    // de rodar, pra dar a melhor chance de já ter a Atividade de referência
    // mais recente no banco. Se o sync falhar mesmo assim, a análise roda
    // com o que já estava no banco — nunca pior do que não encadear.
    if (now.getHours() === ANALISE_HORA) {
      const diaKey = diaLocalKey(now);
      if (!_analisadoHoje.has(diaKey)) {
        _analisadoHoje.add(diaKey);
        if (_analisadoHoje.size > 5) {
          const oldest = [..._analisadoHoje][0];
          _analisadoHoje.delete(oldest);
        }
        chain = chain
          .then(() => runAnalisePerformance(db, log))
          .catch(e => log.error({ err: e }, '[scheduler] erro na análise de performance automática'));
      }
    }

    // Treino IA: TODO DIA às TREINO_IA_HORA (#160 — antes era só segunda).
    // Quem decide se há trabalho é runTreinoIa, por planoCobreSemanaAtual():
    // na prática gera na segunda e, nos outros dias, só se a semana ainda
    // estiver descoberta. A mudança existe porque em 2026-11-09 o job falhou
    // nos dois ticks da segunda e a próxima tentativa seria 16/11 — uma semana
    // inteira sem plano. Encadeado depois da análise pra rodar com o banco já
    // sincronizado (os insumos CTL/ATL/TSB e tendência de peso saem das
    // atividades e das pesagens). Sem Set de dedup: os guards consultam o
    // banco e por isso sobrevivem a restart (ver o comentário de runTreinoIa).
    if (now.getHours() === TREINO_IA_HORA) {
      chain = chain
        .then(() => runTreinoIa(db, log))
        .catch(e => log.error({ err: e }, '[scheduler] erro no treino IA automático'));
    }

    // Relatório mensal pelo Telegram: dia 1º, às RELATORIO_HORA:00 (slot de
    // sync), uma vez por mês. Encadeado no fim pra rodar depois do sync (dados
    // já atualizados). Dedup por "YYYY-MM".
    if (now.getDate() === 1 && now.getHours() === RELATORIO_HORA) {
      const mesKey = Utils.mesLocalISO(now);   // #151 — fonte única
      if (!_relatorioEnviado.has(mesKey)) {
        _relatorioEnviado.add(mesKey);
        if (_relatorioEnviado.size > 3) {
          const oldest = [..._relatorioEnviado][0];
          _relatorioEnviado.delete(oldest);
        }
        chain = chain
          .then(() => runRelatorioMensal(db, log))
          .catch(e => log.error({ err: e }, '[scheduler] erro no relatório mensal'));
      }
    }

    // Digest de push da véspera (#3 F2): às PUSH_HORA, encadeado no fim. Sem
    // Set de dedup aqui — a tabela push_sent (passeio+dia) garante um push só
    // por dia, então os dois slots de PUSH_HORA (:00 e :30) convergem: o
    // primeiro que tem assinante envia e marca, o segundo vê tudo notificado e
    // pula. Não depende do sync (passeios são dado local), mas rodar depois
    // não custa nada.
    if (now.getHours() === PUSH_HORA) {
      chain = chain
        .then(() => pushDigest.runDigest(db, log))
        .catch(e => log.error({ err: e }, '[scheduler] erro no digest de push'));
    }
  }, CHECK_INTERVAL_MS);

  log.info(`[scheduler] ativo — sync a cada ${SYNC_INTERVAL_MIN} min, análise de performance às ${ANALISE_HORA}h, treino IA diário às ${TREINO_IA_HORA}h (gera só se a semana estiver descoberta), relatório mensal (Telegram) dia 1º às ${RELATORIO_HORA}h, digest de push às ${PUSH_HORA}h`);
}

module.exports = { setup, syncAutoLigado };
