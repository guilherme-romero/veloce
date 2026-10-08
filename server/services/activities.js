/* ═══════════════════════════════════════════════════════════════════════
   ACTIVITIES — visão unificada Strava + Garmin (Garmin > Strava quando há
   link em activity_links). Extraído de server/routes/activities.js pra ser
   reaproveitado também pelo job automático da Análise de Performance
   (server/scheduler.js) sem passar por HTTP — mesmo processo, mesmo db.
═══════════════════════════════════════════════════════════════════════ */

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
// Normaliza "inicio" (Garmin: inicio_local "YYYY-MM-DD HH:MM:SS"; Strava:
// inicio_iso "YYYY-MM-DDTHH:MM:SSZ", rotulado com "Z" mas JÁ em horário local —
// ver nota em server/utils/activity-matcher.js:parseLocal, mesma fonte de
// dados) pra timestamp comparável. Sem isso, comparar as strings cruas via
// localeCompare falha quando a DATA é igual: "YYYY-MM-DD " (espaço) ordena
// antes de "YYYY-MM-DDT" (T), então Strava sempre "ganharia" empate de data
// mesmo com Garmin mais tarde no mesmo dia.
function toComparableTime(inicio) {
  if (!inicio) return 0;
  const t = Date.parse(String(inicio).replace('Z', '').replace(' ', 'T'));
  return isFinite(t) ? t : 0;
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

/**
 * @param  {import('better-sqlite3').Database} db
 * @param  {number} days — janela em dias pra trás (não validada aqui; quem
 *   chama via HTTP já clampa em server/routes/activities.js)
 * @return {{ items: Array, garminCount: number, stravaCount: number }}
 *   items: mais recente primeiro (mesma ordenação de antes).
 */
function getUnifiedActivities(db, days) {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  // Colunas explícitas: garminRow()/stravaRow() descartam polyline/payload/
  // hr_zones — SELECT * lia ~731 KB por request só pra jogar fora (medido).
  const garmin = db
    .prepare(`
      SELECT id_garmin, nome, tipo, data_inicio, inicio_local, distancia_m,
             tempo_mov_s, tempo_total_s, elevacao_m, fc_media, fc_max,
             velocidade_avg, velocidade_max, watts_avg, watts_max, cadencia_avg,
             calorias
        FROM garmin_activities
       WHERE data_inicio >= ?
       ORDER BY inicio_local DESC
    `)
    .all(cutoff)
    .map(garminRow);

  // Strava EXCLUINDO os que tem link com Garmin (Garmin vence)
  const strava = db
    .prepare(`
      SELECT s.id_strava, s.nome, s.tipo, s.data_inicio, s.inicio_iso, s.distancia_m,
             s.tempo_mov_s, s.tempo_total_s, s.elevacao_m, s.fc_media, s.fc_max,
             s.velocidade_avg, s.velocidade_max, s.watts_avg, s.cadencia_avg
        FROM strava_activities s
        LEFT JOIN activity_links l ON l.strava_id = s.id_strava
       WHERE s.data_inicio >= ? AND l.strava_id IS NULL
       ORDER BY s.inicio_iso DESC
    `)
    .all(cutoff)
    .map(stravaRow);

  const items = [...garmin, ...strava].sort((a, b) => toComparableTime(b.inicio) - toComparableTime(a.inicio));
  return { items, garminCount: garmin.length, stravaCount: strava.length };
}

/**
 * Issue #42: o sino de notificações só precisa da ÚLTIMA atividade, mas
 * chamava /unified?days=1825&limit=1 — a paginação acontecia DEPOIS do
 * SELECT * completo dos últimos 5 anos. Aqui, 2 queries com ORDER BY+LIMIT 1
 * (cada uma usa o índice de inicio_local/inicio_iso — ver PR #45) resolvem
 * sem puxar nenhum histórico.
 * @param  {import('better-sqlite3').Database} db
 * @return {Object|null} mesmo shape de um item de getUnifiedActivities().items
 */
function getLatestActivity(db) {
  const g = db.prepare(`
    SELECT id_garmin, nome, tipo, data_inicio, inicio_local, distancia_m,
           tempo_mov_s, tempo_total_s, elevacao_m, fc_media, fc_max,
           velocidade_avg, velocidade_max, watts_avg, watts_max, cadencia_avg,
           calorias
      FROM garmin_activities
     ORDER BY inicio_local DESC
     LIMIT 1
  `).get();

  const s = db.prepare(`
    SELECT s.id_strava, s.nome, s.tipo, s.data_inicio, s.inicio_iso, s.distancia_m,
           s.tempo_mov_s, s.tempo_total_s, s.elevacao_m, s.fc_media, s.fc_max,
           s.velocidade_avg, s.velocidade_max, s.watts_avg, s.cadencia_avg
      FROM strava_activities s
      LEFT JOIN activity_links l ON l.strava_id = s.id_strava
     WHERE l.strava_id IS NULL
     ORDER BY s.inicio_iso DESC
     LIMIT 1
  `).get();

  const gRow = g ? garminRow(g) : null;
  const sRow = s ? stravaRow(s) : null;
  if (!gRow) return sRow;
  if (!sRow) return gRow;
  return toComparableTime(gRow.inicio) >= toComparableTime(sRow.inicio) ? gRow : sRow;
}

module.exports = { getUnifiedActivities, getLatestActivity };
