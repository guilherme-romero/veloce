-- Migracao para Sub-fase 3c: realinha schema das tabelas que mudaram
-- Mantem weights e rides intactos (sem mudanca de schema)
-- Todas as outras tabelas estao vazias antes da 3c, entao DROP e seguro.

DROP TABLE IF EXISTS user_profile;
DROP TABLE IF EXISTS modes;
DROP TABLE IF EXISTS workouts;
DROP TABLE IF EXISTS training_log;
DROP TABLE IF EXISTS home_exercises;
DROP TABLE IF EXISTS routes;

-- Recria com o novo schema (mesmo CREATE do schema-training.sql)
CREATE TABLE user_profile (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  payload    TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE modes (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  ordem      INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workouts (
  id         TEXT PRIMARY KEY,
  mode_id    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  ordem      INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mode_id) REFERENCES modes(id) ON DELETE CASCADE
);
CREATE INDEX idx_workouts_mode ON workouts(mode_id);

CREATE TABLE training_log (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL UNIQUE,
  tipos      TEXT NOT NULL,
  notas      TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_training_log_data ON training_log(data);

CREATE TABLE home_exercises (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  ordem      INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE routes (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
