/* ═══════════════════════════════════════════════════════════════════════
   STORAGE — camada de persistência local
   Todas as chaves usam prefixo "tb." (treino_bike).
   Esquema:
     tb.user      → objeto único (perfil)
     tb.modes     → array de modos de treino
     tb.workouts  → dict { modeId: [workouts] }
     tb.weights   → array de pesagens
     tb.rides     → array de passeios planejados (schema pt-BR)
     tb.version   → versão do schema (controle de migração)
═══════════════════════════════════════════════════════════════════════ */

const KEYS = {
  USER:     'tb.user',
  MODES:    'tb.modes',
  WORKOUTS: 'tb.workouts',
  WEIGHTS:  'tb.weights',
  RIDES:    'tb.rides',
  VERSION:  'tb.version',
};

const SCHEMA_VERSION = 2; // v2: rides em pt-BR

/* ── Defaults ───────────────────────────────────────────────────────── */
const DEFAULTS = {
  user: {
    nome: '',
    dataNascimento: '',     // ISO: YYYY-MM-DD
    altura: 170,
    pesoAtual: 80,
    pesoMeta: 70,
    bikePeso: 11,
    bikeModelo: 'Gravel',
    dataInicioPlano: '',    // ISO: YYYY-MM-DD
  },
  modes: [
    { id: 'base',  nome: 'Fortalecimento · Core',  ordem: 0 },
    { id: 'build', nome: 'Condicionamento · Bike', ordem: 1 },
  ],
};

/* ── Operações genéricas ────────────────────────────────────────────── */
function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Storage.get(${key}) failed:`, e);
    return fallback;
  }
}

function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`Storage.set(${key}) failed:`, e);
    return false;
  }
}

function remove(key) { localStorage.removeItem(key); }

function clearAllData() {
  Object.values(KEYS).forEach(remove);
}

/* ── Helpers de Ride ────────────────────────────────────────────────── */
function genRideId() {
  return 'ride_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
}

/**
 * Normaliza um Ride: converte schema antigo (en) para novo (pt) se necessário,
 * preenche defaults e força tipos corretos. Retorna sempre um objeto válido.
 */
function normalizeRide(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = { ...raw };

  // Migração de campos legados (schema antigo do rides.js v1)
  if (r.date && !r.data) { r.data = r.date; delete r.date; }
  if (r.destination && !r.destino) { r.destino = r.destination; delete r.destination; }
  if (r.distance !== undefined && r.distancia === undefined) {
    r.distancia = r.distance; delete r.distance;
  }
  if (r.duration && !r.duracao) { r.duracao = r.duration; delete r.duration; }
  if (r.difficulty && !r.dificuldade) {
    const map = { baixo: 'baixa', medio: 'media', alto: 'alta' };
    r.dificuldade = map[r.difficulty] || r.difficulty;
    delete r.difficulty;
  }
  if (r.rating !== undefined && r.nota === undefined) {
    r.nota = r.rating; delete r.rating;
  }

  // Defaults / coerção de tipos
  if (!r.id) r.id = genRideId();
  r.data        = String(r.data || '');
  r.destino     = String(r.destino || '');
  r.distancia   = isFinite(parseFloat(r.distancia)) ? parseFloat(r.distancia) : 0;
  r.altitude    = isFinite(parseInt(r.altitude, 10)) ? parseInt(r.altitude, 10) : 0;
  r.duracao     = String(r.duracao || '');
  r.dificuldade = ['baixa', 'media', 'alta'].includes(r.dificuldade) ? r.dificuldade : 'media';
  r.nota        = Math.max(0, Math.min(5, parseInt(r.nota, 10) || 0));
  r.notas       = String(r.notas || '');
  r.createdAt   = r.createdAt || new Date().toISOString();

  return r;
}

/* ── API tipada por entidade ────────────────────────────────────────── */
const Storage = {
  // ── User ───────────────────────────────────────────────────────────
  getUser:  ()      => get(KEYS.USER, { ...DEFAULTS.user }),
  setUser:  (u)     => set(KEYS.USER, u),

  // ── Modes ──────────────────────────────────────────────────────────
  getModes: ()      => get(KEYS.MODES, [...DEFAULTS.modes]),
  setModes: (m)     => set(KEYS.MODES, m),

  addMode: (nome) => {
    const modes = Storage.getModes();
    const id = 'mode_' + Date.now().toString(36);
    const ordem = modes.length;
    modes.push({ id, nome, ordem });
    Storage.setModes(modes);
    const w = Storage.getWorkouts();
    w[id] = [];
    Storage.setWorkouts(w);
    return id;
  },

  renameMode: (id, novoNome) => {
    const modes = Storage.getModes();
    const m = modes.find(x => x.id === id);
    if (m) { m.nome = novoNome; Storage.setModes(modes); }
  },

  deleteMode: (id) => {
    const modes = Storage.getModes();
    if (modes.length <= 1) return false;
    Storage.setModes(modes.filter(m => m.id !== id));
    const w = Storage.getWorkouts();
    delete w[id];
    Storage.setWorkouts(w);
    return true;
  },

  // ── Workouts ───────────────────────────────────────────────────────
  getWorkouts: ()   => get(KEYS.WORKOUTS, {}),
  setWorkouts: (w)  => set(KEYS.WORKOUTS, w),

  getWorkoutsForMode: (modeId) => {
    const w = Storage.getWorkouts();
    return w[modeId] || [];
  },

  setWorkoutsForMode: (modeId, list) => {
    const w = Storage.getWorkouts();
    w[modeId] = list;
    Storage.setWorkouts(w);
  },

  addWorkout: (modeId, workout) => {
    const list = Storage.getWorkoutsForMode(modeId);
    if (!workout.id) {
      // tbGenId vem de defaults.js; fallback inline se faltar
      workout.id = (typeof tbGenId === 'function')
        ? tbGenId()
        : 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }
    list.push(workout);
    Storage.setWorkoutsForMode(modeId, list);
    return workout.id;
  },

  updateWorkout: (modeId, workoutId, patch) => {
    const list = Storage.getWorkoutsForMode(modeId);
    const idx = list.findIndex(w => w.id === workoutId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch, id: workoutId };
      Storage.setWorkoutsForMode(modeId, list);
      return true;
    }
    return false;
  },

  deleteWorkout: (modeId, workoutId) => {
    const list = Storage.getWorkoutsForMode(modeId);
    Storage.setWorkoutsForMode(modeId, list.filter(w => w.id !== workoutId));
  },

  // ── Weights ────────────────────────────────────────────────────────
  getWeights: ()    => get(KEYS.WEIGHTS, []),
  setWeights: (w)   => set(KEYS.WEIGHTS, w),
  addWeight: (entry) => {
    const arr = Storage.getWeights();
    arr.push(entry);
    arr.sort((a, b) => a.data.localeCompare(b.data));
    Storage.setWeights(arr);
    return arr;
  },

  // ── Rides ──────────────────────────────────────────────────────────
  getRides: () => {
    const raw = get(KEYS.RIDES, []);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeRide).filter(Boolean);
  },
  setRides: (r) => set(KEYS.RIDES, r),

  addRide: (ride) => {
    const arr = Storage.getRides();
    const novo = normalizeRide({ ...ride, id: ride.id || genRideId() });
    arr.push(novo);
    arr.sort((a, b) => a.data.localeCompare(b.data));
    Storage.setRides(arr);
    return novo.id;
  },

  updateRide: (id, patch) => {
    const arr = Storage.getRides();
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) {
      arr[idx] = normalizeRide({ ...arr[idx], ...patch, id });
      arr.sort((a, b) => a.data.localeCompare(b.data));
      Storage.setRides(arr);
      return true;
    }
    return false;
  },

  deleteRide: (id) => {
    const arr = Storage.getRides();
    Storage.setRides(arr.filter(r => r.id !== id));
  },

  // ── Util ───────────────────────────────────────────────────────────
  clearAll: clearAllData,

  exportJSON: () => JSON.stringify({
    version:    SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    user:       Storage.getUser(),
    modes:      Storage.getModes(),
    workouts:   Storage.getWorkouts(),
    weights:    Storage.getWeights(),
    rides:      Storage.getRides(),
  }, null, 2),

  importJSON: (jsonStr) => {
    const data = JSON.parse(jsonStr);
    if (data.user)     Storage.setUser(data.user);
    if (data.modes)    Storage.setModes(data.modes);
    if (data.workouts) Storage.setWorkouts(data.workouts);
    if (data.weights)  Storage.setWeights(data.weights);
    if (data.rides && Array.isArray(data.rides)) {
      Storage.setRides(data.rides.map(normalizeRide).filter(Boolean));
    }
    // Garante que versão fica em dia após import
    set(KEYS.VERSION, SCHEMA_VERSION);
  },
};

/* ── Migrações entre versões de schema ──────────────────────────────── */
function migrateSchema() {
  const current = get(KEYS.VERSION, 0);
  if (current === SCHEMA_VERSION) return;

  // v0/v1 → v2: normalizar rides com schema antigo
  if (current < 2) {
    const rides = get(KEYS.RIDES, []);
    if (Array.isArray(rides) && rides.length > 0) {
      const normalized = rides.map(normalizeRide).filter(Boolean);
      Storage.setRides(normalized);
      console.info(`[Storage] Migrados ${normalized.length} passeios para schema v2.`);
    }
  }

  set(KEYS.VERSION, SCHEMA_VERSION);
}

/* ── Migração inicial: lê dados_usuario.txt (legado) na primeira execução ── */
async function migrateFromLegacyTxtIfNeeded() {
  // Já tem versão registrada? Só roda migração de schema entre versões.
  if (localStorage.getItem(KEYS.VERSION)) {
    migrateSchema();
    return;
  }

  // Primeira execução: tenta ler dados_usuario.txt
  const user = { ...DEFAULTS.user };

  try {
    const resp = await fetch('docs/dados_usuario.txt?t=' + Date.now());
    if (resp.ok) {
      const text = await resp.text();
      const parsed = parseLegacyTxt(text);
      if (parsed['NOME'])             user.nome = parsed['NOME'];
      if (parsed['DATA NASCIMENTO'])  user.dataNascimento = brToISO(parsed['DATA NASCIMENTO']);
      if (parsed['ALTURA'])           user.altura = parseFloat(parsed['ALTURA']);
      if (parsed['PESO ATUAL'])       user.pesoAtual = parseFloat(parsed['PESO ATUAL']);
      if (parsed['PESO META'])        user.pesoMeta = parseFloat(parsed['PESO META']);
      if (parsed['PESO'])             user.bikePeso = parseFloat(parsed['PESO']);
      if (parsed['MODELO'])           user.bikeModelo = parsed['MODELO'];
    }
  } catch (e) {
    console.info('No legacy dados_usuario.txt; using defaults.');
  }

  if (!user.dataInicioPlano) user.dataInicioPlano = todayISO();

  Storage.setUser(user);
  Storage.setModes(DEFAULTS.modes);
  Storage.setWorkouts(window.DEFAULT_WORKOUTS || { base: [], build: [] });
  Storage.setWeights([]);
  Storage.setRides([]);
  set(KEYS.VERSION, SCHEMA_VERSION);
}

/* ── helpers ────────────────────────────────────────────────────────── */
function parseLegacyTxt(text) {
  const data = {};
  text.split('\n').forEach(line => {
    const m = line.match(/^([^:#][^:]*?):\s*(.+)$/);
    if (m) data[m[1].trim().toUpperCase()] = m[2].trim();
  });
  return data;
}

function brToISO(br) {
  const parts = br.split('/');
  if (parts.length !== 3) return '';
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* expor */
window.Storage = Storage;
window.tbMigrate = migrateFromLegacyTxtIfNeeded;
window.tbToday = todayISO;
window.tbBrToISO = brToISO;
window.tbNormalizeRide = normalizeRide;
