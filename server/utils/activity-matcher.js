/* ═══════════════════════════════════════════════════════════════════════
   ACTIVITY MATCHER — vinculo Strava ⇄ Garmin (Fase 4.6b)

   Heuristica:
     - Mesma data (YYYY-MM-DD)
     - Distancia em metros ±100m  (~ 0,1 km tolerancia)
     - Inicio dentro de ±300s (5 min — Garmin auto-publica com pequeno delay)

   Estrategia: para cada atividade Strava sem link, busca candidatas Garmin
   no mesmo dia, pega a melhor (menor score = soma normalizada das diffs).
   Se score abaixo de THRESHOLD, registra link.

   Roda sempre apos sync de Strava OU Garmin (so faz upserts incrementais).
═══════════════════════════════════════════════════════════════════════ */

const DIST_TOL_M = 100;
const TIME_TOL_S = 300;
const SCORE_THRESHOLD = 1.0; // < soma normalizada (1.0 = limite tolerancia)

function parseIso(s) {
  if (!s) return 0;
  // Strava: "2026-03-14T13:48:30Z" | Garmin local: "2026-03-14 10:48:30"
  const norm = String(s).includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const t = Date.parse(norm);
  return isFinite(t) ? t : 0;
}

function timeDiffSeconds(stravaIso, garminLocal, garminGmt) {
  const ts = parseIso(stravaIso);
  const tg = parseIso(garminGmt || garminLocal);
  if (!ts || !tg) return Infinity;
  return Math.abs(ts - tg) / 1000;
}

/**
 * Roda matching para todas as atividades nao-vinculadas.
 * @param {Database} db
 * @returns {{created:number, examined:number}}
 */
function runMatching(db) {
  // Strava sem link ainda
  const unlinked = db.prepare(`
    SELECT s.id_strava, s.data_inicio, s.inicio_iso, s.distancia_m
      FROM strava_activities s
      LEFT JOIN activity_links l ON l.strava_id = s.id_strava
     WHERE l.strava_id IS NULL
  `).all();

  let created = 0;
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO activity_links (strava_id, garmin_id, score) VALUES (?, ?, ?)
  `);
  const candStmt = db.prepare(`
    SELECT id_garmin, inicio_local, inicio_gmt, distancia_m
      FROM garmin_activities
     WHERE data_inicio = ?
       AND id_garmin NOT IN (SELECT garmin_id FROM activity_links)
  `);

  for (const s of unlinked) {
    if (!s.data_inicio) continue;
    const candidates = candStmt.all(s.data_inicio);
    let best = null, bestScore = Infinity;
    for (const g of candidates) {
      const distDiff = Math.abs((g.distancia_m || 0) - (s.distancia_m || 0));
      const timeDiff = timeDiffSeconds(s.inicio_iso, g.inicio_local, g.inicio_gmt);
      if (distDiff > DIST_TOL_M || timeDiff > TIME_TOL_S) continue;
      const score = (distDiff / DIST_TOL_M) + (timeDiff / TIME_TOL_S);
      if (score < bestScore) { bestScore = score; best = g; }
    }
    if (best && bestScore < SCORE_THRESHOLD) {
      insertStmt.run(s.id_strava, best.id_garmin, bestScore);
      created++;
    }
  }
  return { created, examined: unlinked.length };
}

module.exports = { runMatching };
