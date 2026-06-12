-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA DA APLICACAO — single-user, sem user_id
-- Estrategia: colunas top-level para campos usados em indices/busca;
--             coluna `payload` (JSON TEXT) para o resto, evitando ALTERs
--             toda vez que o schema do frontend mudar.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Perfil do usuario (1 row apenas) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profile (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  payload    TEXT NOT NULL,    -- objeto completo do perfil
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Pesagens ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,   -- YYYY-MM-DD
  peso       REAL NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('atual', 'historico')),
  fonte      TEXT DEFAULT 'manual',  -- 'manual' | 'garmin' | etc.
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_weights_data ON weights(data);

-- ── Modos de treino ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modes (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  ordem      INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Workouts da semana padrao ─────────────────────────────────────────
-- payload contem: day, type, title, bpm, rpm, time, tag, steps[], tip, etc
CREATE TABLE IF NOT EXISTS workouts (
  id         TEXT PRIMARY KEY,
  mode_id    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  ordem      INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mode_id) REFERENCES modes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workouts_mode ON workouts(mode_id);

-- ── Passeios planejados ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rides (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,   -- YYYY-MM-DD
  destino     TEXT,
  distancia   REAL,
  altitude    REAL,
  duracao     TEXT,
  dificuldade TEXT CHECK (dificuldade IN ('baixa','media','alta')),
  nota        REAL CHECK (nota >= 0 AND nota <= 5),
  notas       TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rides_data ON rides(data);

-- ── Training log (registro diario) ────────────────────────────────────
-- payload (opcional, JSON): {
--   manual: bool,                                  -- usuario editou? sync nao sobrescreve
--   sources: ["strava","garmin",...],
--   bike:    { km, tempoMovS, elevM, fcMedia, fcMax, fonte, fonteId },
--   fisico:  { tempoMinutos, fc, fonte, fonteId }
-- }
CREATE TABLE IF NOT EXISTS training_log (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
  tipos      TEXT NOT NULL,          -- JSON array: ["bike","fisico",...]
  notas      TEXT,
  payload    TEXT,                   -- JSON opcional (Fase 4.6a)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_training_log_data ON training_log(data);

-- ── Exercicios de fortalecimento em casa ──────────────────────────────
-- payload contem: sets, descricao, icon, etc
CREATE TABLE IF NOT EXISTS home_exercises (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  ordem      INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Rotas GPX salvas ──────────────────────────────────────────────────
-- payload contem: stats {distancia, desnivelPos, desnivelNeg, altMax}, waypoints[]
CREATE TABLE IF NOT EXISTS routes (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Atividades importadas do Strava (Fase 4b) ─────────────────────────
-- id_strava: id numerico do Strava (UNIQUE para dedupe)
-- payload: objeto bruto util para detalhe (map polyline, segments, etc)
CREATE TABLE IF NOT EXISTS strava_activities (
  id_strava       INTEGER PRIMARY KEY,
  nome            TEXT,
  tipo            TEXT,            -- "Ride", "VirtualRide", etc.
  data_inicio     TEXT NOT NULL,   -- YYYY-MM-DD (start_date_local truncado)
  inicio_iso      TEXT NOT NULL,   -- ISO completo
  distancia_m     REAL,            -- metros
  tempo_mov_s     INTEGER,         -- segundos (moving_time)
  tempo_total_s   INTEGER,         -- segundos (elapsed_time)
  elevacao_m      REAL,            -- metros
  fc_media        REAL,
  fc_max          REAL,
  watts_avg       REAL,
  cadencia_avg    REAL,
  velocidade_avg  REAL,            -- m/s
  velocidade_max  REAL,            -- m/s
  kudos           INTEGER,
  payload         TEXT,            -- JSON bruto da resposta Strava
  imported_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_strava_data ON strava_activities(data_inicio);

-- ── Metadados de sync Strava (1 linha) ────────────────────────────────
CREATE TABLE IF NOT EXISTS strava_sync_meta (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync   TEXT,
  last_count  INTEGER DEFAULT 0
);

-- ── Atividades importadas do Garmin Connect (Fase 4.5) ────────────────
CREATE TABLE IF NOT EXISTS garmin_activities (
  id_garmin       INTEGER PRIMARY KEY,
  nome            TEXT,
  tipo            TEXT,            -- typeKey: cycling, road_biking, etc.
  data_inicio     TEXT NOT NULL,   -- YYYY-MM-DD
  inicio_local    TEXT NOT NULL,
  inicio_gmt      TEXT,
  distancia_m     REAL,
  tempo_mov_s     INTEGER,
  tempo_total_s   INTEGER,
  elevacao_m      REAL,
  fc_media        REAL,
  fc_max          REAL,
  watts_avg       REAL,
  watts_max       REAL,
  cadencia_avg    REAL,
  velocidade_avg  REAL,            -- m/s
  velocidade_max  REAL,            -- m/s
  calorias        REAL,
  device_id       INTEGER,
  polyline        TEXT,
  payload         TEXT,
  imported_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_garmin_data ON garmin_activities(data_inicio);

-- ── Metadados de sync Garmin (1 linha) ────────────────────────────────
CREATE TABLE IF NOT EXISTS garmin_sync_meta (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync   TEXT,
  last_count  INTEGER DEFAULT 0
);

-- ── Training Readiness diário (Fase 9) ────────────────────────────────
CREATE TABLE IF NOT EXISTS garmin_training_readiness (
  data            TEXT PRIMARY KEY,
  score           INTEGER,
  level           TEXT,
  feedback_short  TEXT,
  feedback_long   TEXT,
  sleep_score     INTEGER,
  sleep_factor_pct INTEGER,
  recovery_time_h INTEGER,
  recovery_factor_pct INTEGER,
  acwr_factor_pct INTEGER,
  hrv_factor_pct  INTEGER,
  hrv_weekly_avg  INTEGER,
  stress_factor_pct INTEGER,
  imported_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Training Status diário (Fase 9) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS garmin_training_status (
  data           TEXT PRIMARY KEY,
  status_code    INTEGER,
  status_label   TEXT,
  status_feedback TEXT,
  load_ratio     REAL,
  load_balance   TEXT,
  fitness_trend  INTEGER,
  fitness_trend_sport TEXT,
  vo2max_cycling REAL,
  vo2max_generic REAL,
  weekly_load    REAL,
  imported_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Personal Records (Fase 9) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS garmin_personal_records (
  id            INTEGER PRIMARY KEY,
  type_id       INTEGER,
  status        TEXT,
  valor         REAL,
  activity_id   INTEGER,
  activity_name TEXT,
  activity_type TEXT,
  pr_date       TEXT,
  activity_date TEXT,
  imported_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Hill Score + Endurance Score (Fase 9) ────────────────────────────
CREATE TABLE IF NOT EXISTS garmin_fitness_scores (
  data                 TEXT PRIMARY KEY,
  hill_score           INTEGER,
  hill_classification  INTEGER,
  endurance_score      INTEGER,
  endurance_classification INTEGER,
  endurance_gauge_lower INTEGER,
  endurance_gauge_upper INTEGER,
  vo2_max              REAL,
  imported_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Saude diaria Garmin (passos, sono, stress, HRV, body battery) ────
CREATE TABLE IF NOT EXISTS garmin_daily_health (
  data              TEXT PRIMARY KEY,  -- YYYY-MM-DD
  passos            INTEGER,
  kcal_total        REAL,
  kcal_ativa        REAL,
  distancia_m       INTEGER,
  fc_repouso        INTEGER,
  fc_min            INTEGER,
  fc_max            INTEGER,
  sono_total_s      INTEGER,
  sono_deep_s       INTEGER,
  sono_light_s      INTEGER,
  sono_rem_s        INTEGER,
  stress_avg        INTEGER,
  stress_max        INTEGER,
  body_battery_max  INTEGER,
  body_battery_drain INTEGER,
  hrv_semanal_avg   INTEGER,
  hrv_noite_avg     INTEGER,
  hrv_status        TEXT,
  imported_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Vinculo Strava ⇄ Garmin (Fase 4.6b) ──────────────────────────────
-- Mesma ride pode aparecer em ambos (Garmin auto-publica no Strava).
-- Matching por data + distancia(+/-100m) + tempo(+/-60s).
CREATE TABLE IF NOT EXISTS activity_links (
  strava_id   INTEGER NOT NULL,
  garmin_id   INTEGER NOT NULL,
  matched_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  score       REAL,             -- diferenca relativa (menor = melhor match)
  PRIMARY KEY (strava_id, garmin_id),
  FOREIGN KEY (strava_id) REFERENCES strava_activities(id_strava) ON DELETE CASCADE,
  FOREIGN KEY (garmin_id) REFERENCES garmin_activities(id_garmin) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_activity_links_strava ON activity_links(strava_id);
CREATE INDEX IF NOT EXISTS idx_activity_links_garmin ON activity_links(garmin_id);
