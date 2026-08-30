/* ═══════════════════════════════════════════════════════════════════════
   GARMIN — wrapper sobre garmin_cli.py (Python + garminconnect).
   Spawn do script com env vars do .env, parse JSON do stdout.
   Codigos de saida do CLI:
     0 → sucesso (stdout = JSON)
     1 → erro generico (stderr = mensagem)
     2 → MFA_REQUIRED (relogin precisa de --mfa)
     3 → NO_SESSION / SESSION_EXPIRED
═══════════════════════════════════════════════════════════════════════ */
const path  = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const GARMIN_DIR  = path.resolve(__dirname, '..', 'garmin');
const PYTHON_BIN  = path.join(GARMIN_DIR, 'venv', 'bin', 'python');
const CLI_SCRIPT  = path.join(GARMIN_DIR, 'garmin_cli.py');
const DEFAULT_TIMEOUT_MS = 60_000;
// Teto de saída acumulada do subprocess (stdout+stderr). Uma resposta Garmin
// normal fica muito abaixo disso; passar do teto indica loop/output descontrolado
// e o processo é abortado antes de exaurir memória.
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function isConfigured() {
  return !!(process.env.GARMIN_EMAIL && process.env.GARMIN_PASSWORD);
}

// Serializa chamadas PESADAS ao garmin_cli.py: sync automático (scheduler) e
// manual não competem pelo rate-limit da Garmin (dois subprocess ao mesmo
// tempo era só desperdício — upserts são idempotentes). Fila simples em
// memória; status/login/logout NÃO usam exclusive e ficam sempre responsivos.
let _cliChain = Promise.resolve();
function _runExclusive(task) {
  const run = _cliChain.then(task, task); // roda mesmo se a anterior falhou
  _cliChain = run.then(() => {}, () => {});
  return run;
}

function runCli(args, opts = {}) {
  return opts.exclusive ? _runExclusive(() => _spawnCli(args, opts)) : _spawnCli(args, opts);
}

function _spawnCli(args, { timeoutMs = DEFAULT_TIMEOUT_MS, noCache = false } = {}) {
  return new Promise((resolve, reject) => {
    // Ambiente MINIMO e explicito. Antes espalhava `...process.env`, o que
    // entregava JWT_SECRET, ADMIN_PASS_HASH e os segredos do Strava ao script
    // Python e a toda a arvore de dependencias (BUG-061). O garmin_cli.py so
    // le GARMIN_EMAIL/GARMIN_PASSWORD; a sessao SSO vem do caminho do script
    // (SESSION_DIR), nao de HOME.
    const env = {
      PATH:            process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME:            process.env.HOME || '/tmp',
      LANG:            process.env.LANG || 'C.UTF-8',
      LC_ALL:          process.env.LC_ALL || 'C.UTF-8',
      PYTHONIOENCODING: 'utf-8',
      GARMIN_EMAIL:    process.env.GARMIN_EMAIL    || '',
      GARMIN_PASSWORD: process.env.GARMIN_PASSWORD || '',
    };
    // --no-cache eh flag global (antes do subcomando): fura o DiskCache do
    // garminconnect e busca dados frescos da Garmin. Usado no sync manual.
    const cliArgs = noCache ? ['--no-cache', ...args] : args;
    const child = spawn(PYTHON_BIN, [CLI_SCRIPT, ...cliArgs], { env });
    let stdout = '', stderr = '', outBytes = 0, aborted = false;
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('garmin_cli timeout'), { code: 'TIMEOUT' }));
    }, timeoutMs);

    // Aborta se a saída acumulada estourar o teto (protege memória do backend).
    const guardSize = (len) => {
      outBytes += len;
      if (outBytes > MAX_OUTPUT_BYTES && !aborted) {
        aborted = true;
        clearTimeout(killer);
        child.kill('SIGKILL');
        reject(Object.assign(new Error('garmin_cli output excedeu o limite'), { code: 'OUTPUT_LIMIT' }));
      }
    };

    child.stdout.on('data', (d) => { if (aborted) return; guardSize(d.length); if (!aborted) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (aborted) return; guardSize(d.length); if (!aborted) stderr += d.toString(); });
    child.on('error',  (err) => { clearTimeout(killer); reject(err); });
    child.on('close', (exitCode) => {
      if (aborted) return;
      clearTimeout(killer);
      if (exitCode === 0) {
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(Object.assign(new Error('JSON invalido: ' + stdout.slice(0, 200)), { code: 'PARSE' })); }
        return;
      }
      const tag = (stderr.split('\n').find(Boolean) || '').trim();
      const err = new Error(stderr.trim() || `exit ${exitCode}`);
      err.exitCode = exitCode;
      err.tag = tag;
      if (exitCode === 2) err.code = 'MFA_REQUIRED';
      else if (exitCode === 3) err.code = 'NO_SESSION';
      else err.code = 'CLI_ERROR';
      reject(err);
    });
  });
}

async function status() {
  if (!isConfigured()) return { configured: false, connected: false };
  try {
    return await runCli(['status']);
  } catch (err) {
    return {
      configured: true,
      connected: false,
      reason: err.code === 'NO_SESSION' ? 'no_session' : err.message,
    };
  }
}

async function login(mfaCode) {
  const args = ['login'];
  if (mfaCode) args.push('--mfa', String(mfaCode));
  return runCli(args, { timeoutMs: 120_000 });
}

async function logout() { return runCli(['logout']); }

async function listActivities(days = 90, { noCache = false } = {}) {
  const res = await runCli(['activities', '--days', String(days)], { timeoutMs: 120_000, noCache, exclusive: true });
  return res.items || [];
}

async function listWeighIns(days = 365, { noCache = false } = {}) {
  const res = await runCli(['weighins', '--days', String(days)], { timeoutMs: 60_000, noCache, exclusive: true });
  return res.items || [];
}

const BIKE_TYPES = new Set([
  'cycling', 'road_biking', 'mountain_biking', 'gravel_cycling',
  'virtual_ride', 'indoor_cycling', 'cyclocross', 'bmx', 'e_bike',
]);
function isBikeActivity(a) {
  return BIKE_TYPES.has(String(a.activityType || '').toLowerCase());
}

async function listDailyHealth(days = 30, { noCache = false } = {}) {
  const res = await runCli(['daily-health', '--days', String(days)], { timeoutMs: 120_000, noCache, exclusive: true });
  return res.items || [];
}

async function listTrainingReadiness(days = 7, { noCache = false } = {}) {
  const res = await runCli(['training-readiness', '--days', String(days)], { timeoutMs: 60_000, noCache, exclusive: true });
  return res.items || [];
}

async function listTrainingStatus(days = 1, { noCache = false } = {}) {
  const res = await runCli(['training-status', '--days', String(days)], { timeoutMs: 60_000, noCache, exclusive: true });
  return res.items || [];
}

async function listPersonalRecords({ noCache = false } = {}) {
  const res = await runCli(['personal-records'], { timeoutMs: 60_000, noCache, exclusive: true });
  return res.items || [];
}

async function listFitnessScores(days = 7, { noCache = false } = {}) {
  const res = await runCli(['hill-score', '--days', String(days)], { timeoutMs: 60_000, noCache, exclusive: true });
  return res.items || [];
}

async function getActivityPolyline(activityId) {
  const res = await runCli(['activity-polyline', String(activityId)], { timeoutMs: 60_000, exclusive: true });
  return res.polyline || null;
}

async function getActivityHrZones(activityId) {
  const res = await runCli(['hr-zones', String(activityId)], { timeoutMs: 60_000, exclusive: true });
  return Array.isArray(res.zones) ? res.zones : [];
}

// SQL de upsert de garmin_activities — fonte única para o sync automático
// (scheduler.js) e o manual (routes/garmin.js), que preparam o statement no seu
// próprio db. Bind por parâmetros nomeados (@campo).
const ACTIVITY_UPSERT_SQL = `
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
`;

module.exports = {
  isConfigured, status, login, logout,
  listActivities, isBikeActivity, listWeighIns, listDailyHealth,
  listTrainingReadiness, listTrainingStatus, listPersonalRecords, listFitnessScores,
  getActivityPolyline, getActivityHrZones,
  ACTIVITY_UPSERT_SQL,
};
