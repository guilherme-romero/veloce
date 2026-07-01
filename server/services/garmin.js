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

function isConfigured() {
  return !!(process.env.GARMIN_EMAIL && process.env.GARMIN_PASSWORD);
}

function runCli(args, { timeoutMs = DEFAULT_TIMEOUT_MS, noCache = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      GARMIN_EMAIL:    process.env.GARMIN_EMAIL    || '',
      GARMIN_PASSWORD: process.env.GARMIN_PASSWORD || '',
    };
    // --no-cache eh flag global (antes do subcomando): fura o DiskCache do
    // garminconnect e busca dados frescos da Garmin. Usado no sync manual.
    const cliArgs = noCache ? ['--no-cache', ...args] : args;
    const child = spawn(PYTHON_BIN, [CLI_SCRIPT, ...cliArgs], { env });
    let stdout = '', stderr = '';
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('garmin_cli timeout'), { code: 'TIMEOUT' }));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error',  (err) => { clearTimeout(killer); reject(err); });
    child.on('close', (exitCode) => {
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
  const res = await runCli(['activities', '--days', String(days)], { timeoutMs: 120_000, noCache });
  return res.items || [];
}

async function listWeighIns(days = 365, { noCache = false } = {}) {
  const res = await runCli(['weighins', '--days', String(days)], { timeoutMs: 60_000, noCache });
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
  const res = await runCli(['daily-health', '--days', String(days)], { timeoutMs: 120_000, noCache });
  return res.items || [];
}

async function listTrainingReadiness(days = 7, { noCache = false } = {}) {
  const res = await runCli(['training-readiness', '--days', String(days)], { timeoutMs: 60_000, noCache });
  return res.items || [];
}

async function listTrainingStatus(days = 1, { noCache = false } = {}) {
  const res = await runCli(['training-status', '--days', String(days)], { timeoutMs: 60_000, noCache });
  return res.items || [];
}

async function listPersonalRecords({ noCache = false } = {}) {
  const res = await runCli(['personal-records'], { timeoutMs: 60_000, noCache });
  return res.items || [];
}

async function listFitnessScores(days = 7, { noCache = false } = {}) {
  const res = await runCli(['hill-score', '--days', String(days)], { timeoutMs: 60_000, noCache });
  return res.items || [];
}

async function getActivityPolyline(activityId) {
  const res = await runCli(['activity-polyline', String(activityId)], { timeoutMs: 60_000 });
  return res.polyline || null;
}

async function getActivityHrZones(activityId) {
  const res = await runCli(['hr-zones', String(activityId)], { timeoutMs: 60_000 });
  return Array.isArray(res.zones) ? res.zones : [];
}

module.exports = {
  isConfigured, status, login, logout,
  listActivities, isBikeActivity, listWeighIns, listDailyHealth,
  listTrainingReadiness, listTrainingStatus, listPersonalRecords, listFitnessScores,
  getActivityPolyline, getActivityHrZones,
};
