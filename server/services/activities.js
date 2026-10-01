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

  const items = [...garmin, ...strava].sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
  return { items, garminCount: garmin.length, stravaCount: strava.length };
}

module.exports = { getUnifiedActivities };
