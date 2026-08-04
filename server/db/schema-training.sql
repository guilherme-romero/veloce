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

-- ── Estado de auth (singleton) ────────────────────────────────────────
-- last_logout_at: timestamp UNIX (segundos). Tokens JWT com iat <= este
-- valor são rejeitados pelo requireAuth (invalida sessões após logout).
CREATE TABLE IF NOT EXISTS auth_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_logout_at  INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO auth_state (id, last_logout_at) VALUES (1, 0);

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
  duracao     TEXT,                -- legado (substituído por hora_inicio + tempo_estimado)
  hora_inicio TEXT,                -- HH:MM planejado de largada
  tempo_estimado TEXT,             -- estimativa auto (ex.: "2h 39min")
  dificuldade TEXT CHECK (dificuldade IN ('baixa','media','alta')),
  nota        REAL CHECK (nota >= 0 AND nota <= 5),  -- legado (não mais no form)
  notas       TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rides_data ON rides(data);

-- Tipos de componente custom do usuário (opção "Outro (novo)"), reutilizáveis
-- entre bikes; editar o nome corrige em todos os componentes que referenciam.
CREATE TABLE IF NOT EXISTS custom_component_types (
  id           TEXT PRIMARY KEY,
  nome         TEXT NOT NULL,
  vida_util_km REAL,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

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
  recovery_time_min INTEGER,   -- Garmin recoveryTime vem em MINUTOS (não horas)
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
-- Matching por data + distancia(+/-100m) + tempo(+/-300s). Ver activity-matcher.js.
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

-- ═══════════════════════════════════════════════════════════════════════
-- FASE 11.4 — Bicicletas, componentes e log de manutenção
-- Modelo: "bike ativa" — km de atividades Garmin/Strava com data_inicio
-- >= active_since da bike ativa são contabilizados para ela.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bikes (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  marca         TEXT,
  modelo        TEXT,
  tipo          TEXT,                 -- 'Fixa'|'Gravel'|'MTB'|'Speed'
  peso_kg       REAL,
  ano           INTEGER,
  km_inicial    REAL DEFAULT 0,       -- km já rodados antes de usar o app
  active_since  TEXT,                 -- YYYY-MM-DD; NULL = nunca ativa
  active        INTEGER DEFAULT 0,    -- 1 = bike ativa atualmente
  deactivated_at TEXT,                -- YYYY-MM-DD da última inativação; NULL = ativa
  tempo_base     INTEGER DEFAULT 0,   -- tempo em movimento (s) congelado na inativação
  elev_base      INTEGER DEFAULT 0,   -- elevação (m) congelada na inativação
  atividades_base INTEGER DEFAULT 0,  -- nº de atividades congelado na inativação
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bikes_active ON bikes(active);

CREATE TABLE IF NOT EXISTS bike_components (
  id                   TEXT PRIMARY KEY,
  bike_id              TEXT NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  tipo                 TEXT NOT NULL,        -- ex: 'pneu_dianteiro', 'corrente', etc.
  vida_util_km         REAL NOT NULL,
  km_at_install        REAL DEFAULT 0,       -- km total da bike quando instalado
  tem_limpeza          INTEGER DEFAULT 0,
  intervalo_limpeza_km REAL,
  km_at_last_clean     REAL DEFAULT 0,       -- km total da bike na última limpeza
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bike_components_bike ON bike_components(bike_id);

CREATE TABLE IF NOT EXISTS bike_maintenance_log (
  id           TEXT PRIMARY KEY,
  bike_id      TEXT NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  component_id TEXT,                       -- NULL para revisão completa
  tipo_evento  TEXT NOT NULL,              -- 'substituicao'|'limpeza'|'revisao_completa'
  data         TEXT NOT NULL,              -- YYYY-MM-DD
  km_bike      REAL,                       -- km total da bike no momento do evento
  notas        TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bike_log_bike ON bike_maintenance_log(bike_id);
CREATE INDEX IF NOT EXISTS idx_bike_log_data ON bike_maintenance_log(data DESC);

-- Intervalos de serviço recorrentes por componente (Fase 11.5).
-- Cada intervalo é por km OU por dias, com contagem regressiva até o
-- próximo serviço. Ex.: "Calibragem a cada 7 dias", "Trocar pneu a cada 3000 km".
CREATE TABLE IF NOT EXISTS bike_service_intervals (
  id            TEXT PRIMARY KEY,
  component_id  TEXT NOT NULL REFERENCES bike_components(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,          -- ex.: 'Calibragem', 'Trocar pneu'
  base          TEXT NOT NULL DEFAULT 'km', -- 'km' | 'dias'
  intervalo     REAL NOT NULL,          -- km ou dias entre serviços
  km_at_last    REAL DEFAULT 0,         -- km total da bike no último serviço
  data_last     TEXT,                   -- YYYY-MM-DD do último serviço
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bike_interval_comp ON bike_service_intervals(component_id);

-- Snapshot de componentes retirados na substituição (Fase 16.2).
-- Cada linha é uma "geração" anterior daquele slot de componente: preserva
-- km rodado real, dias de uso, vida planejada e a avaliação qualitativa
-- (estrelas + review) para apoiar decisões de recompra.
CREATE TABLE IF NOT EXISTS bike_retired_components (
  id                TEXT PRIMARY KEY,
  bike_id           TEXT NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  component_id      TEXT,                   -- slot de origem (pode ser deletado depois)
  tipo              TEXT NOT NULL,
  marca             TEXT,
  modelo            TEXT,
  observacao        TEXT,
  vida_util_km      REAL,                   -- vida planejada na época
  km_rodado         REAL,                   -- real = km_bike − km_at_install
  dias_uso          INTEGER,                -- data_substituicao − data_install
  data_install      TEXT,
  data_substituicao TEXT,
  rating            INTEGER,                -- 1..5
  review            TEXT,                   -- avaliação qualitativa
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_retired_bike ON bike_retired_components(bike_id);
CREATE INDEX IF NOT EXISTS idx_retired_tipo_marca ON bike_retired_components(tipo, marca);
