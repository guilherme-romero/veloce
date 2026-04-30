/* ═══════════════════════════════════════════════════════════════════════
   STORAGE — camada de persistência local
   Todas as chaves usam prefixo "tb." (treino_bike).
   Esquema:
     tb.user      → objeto único (perfil)
     tb.modes     → array de modos de treino
     tb.workouts  → dict { modeId: [workouts] }
     tb.weights   → array de pesagens
     tb.rides     → array de passeios planejados
═══════════════════════════════════════════════════════════════════════ */

const KEYS = {
  USER:     'tb.user',
  MODES:    'tb.modes',
  WORKOUTS: 'tb.workouts',
  WEIGHTS:  'tb.weights',
  RIDES:    'tb.rides',
  VERSION:  'tb.version',
};

const SCHEMA_VERSION = 1;

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
    if (!workout.id) workout.id = tbGenId();
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
  getRides: ()      => get(KEYS.RIDES, []),
  setRides: (r)     => set(KEYS.RIDES, r),

  addRide: (ride) => {
    const arr = Storage.getRides();
    if (!ride.id) ride.id = 'ride_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
    arr.push(ride);
    arr.sort((a, b) => a.data.localeCompare(b.data));
    Storage.setRides(arr);
    return ride.id;
  },

  updateRide: (id, patch) => {
    const arr = Storage.getRides();
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...patch, id };
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
    if (data.rides)    Storage.setRides(data.rides);
  },
};

/* ── Migração: lê dados_usuario.txt (legado) na primeira execução ───── */
async function migrateFromLegacyTxtIfNeeded() {
  if (localStorage.getItem(KEYS.VERSION)) return;

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
