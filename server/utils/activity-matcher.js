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

function parseLocal(s) {
  // Compara wall-clock local (sem conversao de fuso). Isto e CORRETO aqui: o
  // `inicio_iso` do Strava guarda `start_date_local` (ver routes/strava.js) —
  // rotulado com "Z" mas ja em horario local — e a Garmin manda `inicio_local`.
  // Como ambos os lados sao parseados igual, o offset do servidor se cancela na
  // subtracao; TZ do servidor nao afeta o diff.
  // Strava: "2026-03-14T13:48:30Z" -> trata como local removendo Z
  // Garmin local: "2026-03-14 13:53:26" -> normaliza T
  if (!s) return 0;
  const str = String(s).replace('Z', '').replace(' ', 'T');
  // Date.parse sem Z/offset usa horario local do sistema
  const t = Date.parse(str);
  return isFinite(t) ? t : 0;
}

function timeDiffSeconds(stravaIso, garminLocal) {
  // Comparar como horario local (ambos representam o mesmo instante local do usuario)
  const ts = parseLocal(stravaIso);
  const tg = parseLocal(garminLocal);
  if (!ts || !tg) return Infinity;
  return Math.abs(ts - tg) / 1000;
}

/**
 * Roda matching para atividades nao-vinculadas.
 *
 * Issue #40: reexaminar TODO strava sem link a cada sync e desperdicio —
 * a maioria nunca vai casar (atividade so-Strava, sem par Garmin). So
 * reexamina (a) strava importado desde o ultimo runMatching, OU (b) strava
 * antigo cujo DIA ganhou uma atividade Garmin nova desde entao (cobre sync
 * tardio do Garmin — sem isso, perderiamos matches que só aparecem quando o
 * outro lado sincroniza depois). Primeira execucao (sem last_run) continua
 * examinando tudo, como antes.
 *
 * @param {Database} db
 * @param {Object} [opts]
 * @param {boolean} [opts.full] — ignora o last_run e reexamina tudo (debug/
 *   recuperação manual, ex.: corrigir match perdido por bug já corrigido).
 * @returns {{created:number, examined:number}}
 */
function runMatching(db, { full = false } = {}) {
  const metaRow = db.prepare('SELECT last_run FROM activity_match_meta WHERE id = 1').get();
  const lastRun = full ? null : (metaRow ? metaRow.last_run : null);

  // Margem de 5s: TEXT timestamp do SQLite tem granularidade de segundo, e
  // sync + matching rodam em sequencia rapida — sem a margem, uma linha
  // importada no MESMO segundo do último last_run seria ignorada (`>`
  // estrito falha em empate), só reexaminada no próximo sync.
  const unlinked = lastRun
    ? db.prepare(`
        SELECT s.id_strava, s.data_inicio, s.inicio_iso, s.distancia_m
          FROM strava_activities s
          LEFT JOIN activity_links l ON l.strava_id = s.id_strava
         WHERE l.strava_id IS NULL
           AND (
             s.imported_at > datetime(?, '-5 seconds')
             OR s.data_inicio IN (SELECT data_inicio FROM garmin_activities WHERE imported_at > datetime(?, '-5 seconds'))
           )
      `).all(lastRun, lastRun)
    : db.prepare(`
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
      const timeDiff = timeDiffSeconds(s.inicio_iso, g.inicio_local);
      if (distDiff > DIST_TOL_M || timeDiff > TIME_TOL_S) continue;
      const score = (distDiff / DIST_TOL_M) + (timeDiff / TIME_TOL_S);
      if (score < bestScore) { bestScore = score; best = g; }
    }
    if (best && bestScore < SCORE_THRESHOLD) {
      insertStmt.run(s.id_strava, best.id_garmin, bestScore);
      created++;
    }
  }

  db.prepare(`
    INSERT INTO activity_match_meta (id, last_run) VALUES (1, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET last_run = excluded.last_run
  `).run();

  return { created, examined: unlinked.length };
}

module.exports = { runMatching };
