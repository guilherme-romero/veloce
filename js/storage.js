/* ═══════════════════════════════════════════════════════════════════════
   STORAGE — facade unificada de persistencia
   - Source of truth: backend (/api/*)
   - Cache em memoria para manter os getters sincronos (callers nao mudam)
   - Mutators (add/update/delete/set*) sao async e disparam POST/PUT/DELETE
   - localStorage so e usado para migracao legada (dados_usuario.txt 1a execucao)

   Convencao de cache: cada entidade tem _xxxCache; loadXxx() popula via API.
═══════════════════════════════════════════════════════════════════════ */

const KEYS = {
  // Mantidos apenas para a migracao inicial legada (dados_usuario.txt) e
  // para o controle de SCHEMA_VERSION local.
  USER:           'tb.user',
  VERSION:        'tb.version',
};

const SCHEMA_VERSION = 3; // v3: tudo no backend

/* ── Defaults ───────────────────────────────────────────────────────── */
const DEFAULTS = {
  user: {
    nome: '',
    dataNascimento: '',
    sexo: 'm',
    altura: 170,
    pesoAtual: 80,
    pesoMeta: 70,
    bikePeso: 11,
    bikeModelo: 'Gravel',
    dataInicioPlano: '',
    // Treino IA (IDEIA-7) — intake de perfil, ver server/routes/profile.js
    objetivosPrioridade: [],
    diasDisponiveis: [],
    duracaoSessaoMin: 0,
    diaLongao: '',
    nivelExperiencia: '',
  },
};

/* ── Caches em memoria ──────────────────────────────────────────────── */
let _userCache          = { ...DEFAULTS.user };
let _weightsCache       = [];
let _ridesCache         = [];
let _trainingLogCache   = [];
let _routesCache        = [];

/* ── Erro de API (fire-and-forget): log + toast se disponivel ───────── */
function _apiError(op, err) {
  console.error('[Storage.' + op + ']', err);
  if (typeof window.toast === 'function') {
    window.toast('Falha ao sincronizar (' + op + '): ' + (err.message || 'erro'), { kind: 'error' });
  }
}

/* ── Helpers locais (localStorage so para legado) ───────────────────── */
function _ls(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}
function _setLs(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

/* ── Helpers de Ride ────────────────────────────────────────────────── */
function genRideId() {
  return 'ride_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
}

function normalizeRide(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = { ...raw };
  if (r.date && !r.data) { r.data = r.date; delete r.date; }
  if (r.destination && !r.destino) { r.destino = r.destination; delete r.destination; }
  if (r.distance !== undefined && r.distancia === undefined) { r.distancia = r.distance; delete r.distance; }
  if (r.duration && !r.duracao) { r.duracao = r.duration; delete r.duration; }
  if (r.difficulty && !r.dificuldade) {
    const map = { baixo: 'baixa', medio: 'media', alto: 'alta' };
    r.dificuldade = map[r.difficulty] || r.difficulty;
    delete r.difficulty;
  }
  if (r.rating !== undefined && r.nota === undefined) { r.nota = r.rating; delete r.rating; }

  if (!r.id) r.id = genRideId();
  r.data        = String(r.data || '');
  r.destino     = String(r.destino || '');
  r.distancia   = isFinite(parseFloat(r.distancia)) ? parseFloat(r.distancia) : 0;
  r.altitude    = isFinite(parseInt(r.altitude, 10)) ? parseInt(r.altitude, 10) : 0;
  r.duracao     = String(r.duracao || '');
  r.horaInicio    = String(r.horaInicio || '');
  r.tempoEstimado = String(r.tempoEstimado || '');
  r.dificuldade = ['baixa', 'media', 'alta'].includes(r.dificuldade) ? r.dificuldade : 'media';
  r.nota        = Math.max(0, Math.min(5, parseInt(r.nota, 10) || 0));
  r.notas       = String(r.notas || '');
  r.createdAt   = r.createdAt || new Date().toISOString();
  return r;
}

/* ── Id generators ──────────────────────────────────────────────────── */
function _genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
}

/* ═══════════════════════════════════════════════════════════════════════
   STORAGE — API
═══════════════════════════════════════════════════════════════════════ */
/* ── Carregadores por coleção ────────────────────────────────────────
   Cada entrada busca uma coleção e popula o seu cache. loadAll() roda todas
   (é o que o desktop faz); a UI mobile chama Storage.load([...]) com só as
   coleções que as telas dela leem, para não gastar o caminho crítico do boot
   com dados que ninguém consome. Os corpos vieram de loadAll() sem alteração. */
const LOADERS = {
  'profile': () => window.Api.get('/profile').then(r => {
    _userCache = (r && Object.keys(r).length) ? { ...DEFAULTS.user, ...r } : { ...DEFAULTS.user };
  }),
  'weights':        () => window.Api.get('/weights').then(r => { _weightsCache = Array.isArray(r) ? r : []; }),
  'rides':          () => window.Api.get('/rides').then(r => { _ridesCache = Array.isArray(r) ? r.map(normalizeRide).filter(Boolean) : []; }),
  'training-log':   () => window.Api.get('/training-log').then(r => { _trainingLogCache = Array.isArray(r) ? r : []; }),
  'routes':         () => window.Api.get('/routes').then(r => { _routesCache = Array.isArray(r) ? r : []; }),
};

const Storage = {

  /* ── Load global no boot ───────────────────────────────────────────── */

  /**
   * Carrega as coleções pedidas, em paralelo.
   * @param {string[]} nomes — chaves de LOADERS.
   */
  load: async (nomes) => {
    // Coleta falhas não-401 para que o boot possa avisar o usuário em vez
    // de seguir silenciosamente para um estado vazio (BUG-015). 401 é
    // tratado pelo wrapper Api (redireciona pro login).
    const failures = [];
    const wrap = (label, p) => p.catch(e => {
      console.warn(`[load/${label}]`, e);
      if (e?.status !== 401) failures.push({ label, message: e?.message || String(e) });
    });

    const tasks = [];
    (nomes || []).forEach(nome => {
      const loader = LOADERS[nome];
      // Nome errado é erro de programação: avisa alto em vez de devolver um
      // cache vazio que a tela exibiria como "sem dados".
      if (!loader) { console.warn(`[load] coleção desconhecida: ${nome}`); return; }
      tasks.push(wrap(nome, loader()));
    });

    await Promise.all(tasks);
    window.LOAD_ERRORS = failures;
    return failures;
  },

  loadAll: async () => Storage.load(Object.keys(LOADERS)),

  // Compat: alguns lugares chamavam loadWeights especificamente
  loadWeights: async () => {
    try { _weightsCache = await window.Api.get('/weights') || []; }
    catch (e) { console.error('[loadWeights]', e); _weightsCache = []; }
    return _weightsCache.slice();
  },

  /* ── User ──────────────────────────────────────────────────────────── */
  getUser: () => ({ ...DEFAULTS.user, ..._userCache }),
  setUser: (u) => {
    _userCache = { ...DEFAULTS.user, ...u };
    // fire-and-forget; chamadores existentes nao esperam a resposta
    window.Api.put('/profile', _userCache).catch(e => console.error('[setUser]', e));
    return _userCache;
  },

  /* ── Weights ───────────────────────────────────────────────────────── */
  getWeights: () => _weightsCache.slice(),
  setWeights: (w) => { _weightsCache = Array.isArray(w) ? w.slice() : []; },

  addWeight: async (entry) => {
    const created = await window.Api.post('/weights', {
      data: entry.data, peso: entry.peso, tipo: entry.tipo,
    });
    _weightsCache.push(created);
    _weightsCache.sort((a, b) => a.data.localeCompare(b.data));
    return created;
  },

  deleteWeight: async (id) => {
    await window.Api.del('/weights/' + id);
    _weightsCache = _weightsCache.filter(w => w.id !== id);
  },

  /* ── Rides ─────────────────────────────────────────────────────────── */
  getRides: () => _ridesCache.slice(),
  setRides: (arr) => { _ridesCache = Array.isArray(arr) ? arr.map(normalizeRide).filter(Boolean) : []; },

  addRide: (ride) => {
    const novo = normalizeRide({ ...ride, id: ride.id || genRideId() });
    _ridesCache.push(novo);
    _ridesCache.sort((a, b) => a.data.localeCompare(b.data));
    window.Api.post('/rides', novo).catch(e => _apiError('addRide', e));
    return novo.id;
  },

  updateRide: (id, patch) => {
    const idx = _ridesCache.findIndex(r => r.id === id);
    if (idx < 0) return false;
    _ridesCache[idx] = normalizeRide({ ..._ridesCache[idx], ...patch, id });
    _ridesCache.sort((a, b) => a.data.localeCompare(b.data));
    window.Api.put('/rides/' + encodeURIComponent(id), patch).catch(e => _apiError('updateRide', e));
    return true;
  },

  deleteRide: (id) => {
    _ridesCache = _ridesCache.filter(r => r.id !== id);
    window.Api.del('/rides/' + encodeURIComponent(id)).catch(e => _apiError('deleteRide', e));
  },

  /* ── Training Log ──────────────────────────────────────────────────── */
  getTrainingLog: () => _trainingLogCache.slice(),
  setTrainingLog: (log) => { _trainingLogCache = Array.isArray(log) ? log.slice() : []; },

  addTrainingEntry: (entry) => {
    const id = _genId('tl');
    const tipos = Array.isArray(entry.tipos) ? entry.tipos : (entry.tipo ? [entry.tipo] : ['bike']);
    const payload = entry.payload || null;
    const body = { id, data: entry.data, tipos, notas: entry.notas || '', payload, createdAt: new Date().toISOString() };
    _trainingLogCache.push(body);
    _trainingLogCache.sort((a, b) => a.data.localeCompare(b.data));
    window.Api.post('/training-log', body).catch(e => _apiError('addTrainingEntry', e));
    return id;
  },

  updateTrainingEntry: (id, patch) => {
    const idx = _trainingLogCache.findIndex(e => e.id === id);
    if (idx < 0) return false;
    const updated = { ..._trainingLogCache[idx], ...patch };
    _trainingLogCache[idx] = updated;
    const body = {};
    if (patch.tipos !== undefined)   body.tipos   = patch.tipos;
    if (patch.notas !== undefined)   body.notas   = patch.notas;
    if (patch.payload !== undefined) body.payload = patch.payload;
    window.Api.put('/training-log/' + encodeURIComponent(id), body)
      .catch(e => _apiError('updateTrainingEntry', e));
    return true;
  },

  deleteTrainingEntry: (id) => {
    _trainingLogCache = _trainingLogCache.filter(e => e.id !== id);
    window.Api.del('/training-log/' + encodeURIComponent(id))
      .catch(e => _apiError('deleteTrainingEntry', e));
  },

  /* ── Routes (GPX) ──────────────────────────────────────────────────── */
  getRoutes: () => _routesCache.slice(),
  setRoutes: (r) => { _routesCache = Array.isArray(r) ? r.slice() : []; },

  addRoute: (route) => {
    const id = _genId('route');
    const body = { ...route, id, createdAt: new Date().toISOString() };
    _routesCache.unshift(body);
    window.Api.post('/routes', body).catch(e => _apiError('addRoute', e));
    return id;
  },

  deleteRoute: (id) => {
    _routesCache = _routesCache.filter(r => r.id !== id);
    window.Api.del('/routes/' + encodeURIComponent(id)).catch(e => _apiError('deleteRoute', e));
  },

  /* ── Util ──────────────────────────────────────────────────────────── */
  clearAll: () => {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    _userCache = { ...DEFAULTS.user };
    _weightsCache = [];
    _ridesCache = [];
    _trainingLogCache = [];
    _routesCache = [];
  },

  // Versão async — busca resumo de atividades Strava/Garmin (campos
  // selecionados, não payload bruto). Fase 13.2.2.
  exportJSON: async () => {
    let activitiesSummary = [];
    try {
      const r = await window.Api.get('/activities/unified?days=1825');  // ≈ 5 anos
      const items = (r?.items || []);
      activitiesSummary = items.map(a => ({
        data:        a.data,
        fonte:       a.fonte,
        nome:        a.nome,
        distanciaKm: a.distanciaKm,
        tempoMovS:   a.tempoMovS,
        elevacaoM:   a.elevacaoM,
        fcMedia:     a.fcMedia,
        kcal:        a.kcal,
        cadenciaMedia: a.cadenciaMedia,
        potenciaMedia: a.potenciaMedia,
      }));
    } catch (e) { console.warn('[exportJSON] activities', e); }

    // Garagem de bikes — lista + componentes + manutenções (Fase 15.3).
    let bikesSummary = [];
    try {
      const bikes = await window.Api.get('/bikes');
      if (Array.isArray(bikes)) {
        bikesSummary = await Promise.all(bikes.map(async (b) => {
          let componentes = [], manutencoes = [], retirados = [];
          try {
            const comps = await window.Api.get(`/bikes/${encodeURIComponent(b.id)}/components`);
            componentes = (Array.isArray(comps) ? comps : []).map(c => ({
              tipo: c.tipo, marca: c.marca, modelo: c.modelo, observacao: c.observacao,
              kmDesgastado: c.kmDesgastado, vidaUtilKm: c.vidaUtilKm,
              pressao: c.pressao, temLimpeza: c.temLimpeza, dataInstall: c.dataInstall,
            }));
          } catch (e) { /* sem componentes */ }
          try {
            const logs = await window.Api.get(`/bikes/${encodeURIComponent(b.id)}/maintenance-log`);
            manutencoes = (Array.isArray(logs) ? logs : []).map(m => ({
              data: m.data, tipoEvento: m.tipoEvento, componentTipo: m.componentTipo,
              kmBike: m.kmBike, notas: m.notas,
            }));
          } catch (e) { /* sem manutenções */ }
          try {
            const ret = await window.Api.get(`/bikes/${encodeURIComponent(b.id)}/retired-components`);
            retirados = ((ret && ret.items) || []).map(r => ({
              tipo: r.tipo, marca: r.marca, modelo: r.modelo,
              kmRodado: r.kmRodado, diasUso: r.diasUso, vidaUtilKm: r.vidaUtilKm,
              dataInstall: r.dataInstall, dataSubstituicao: r.dataSubstituicao,
              rating: r.rating, review: r.review,
            }));
          } catch (e) { /* sem retirados */ }
          return {
            id: b.id, nome: b.nome, marca: b.marca, modelo: b.modelo, tipo: b.tipo,
            ano: b.ano, pesoKg: b.pesoKg, kmInicial: b.kmInicial, activeSince: b.activeSince,
            kmTotal: b.kmTotal, atividades: b.atividades,
            componentes, manutencoes, retiredComponents: retirados,
          };
        }));
      }
    } catch (e) { console.warn('[exportJSON] bikes', e); }

    return JSON.stringify({
      version:       SCHEMA_VERSION,
      exportedAt:    new Date().toISOString(),
      user:          Storage.getUser(),
      weights:       Storage.getWeights(),
      rides:         Storage.getRides(),
      trainingLog:   Storage.getTrainingLog(),
      routes:        Storage.getRoutes(),
      activitiesSummary,
      bikesSummary,
    }, null, 2);
  },

  importJSON: async (jsonStr) => {
    let data;
    try { data = JSON.parse(jsonStr); }
    catch (_) { throw new Error('JSON inválido — não foi possível ler o arquivo de backup.'); }
    const Api = window.Api;

    // 1. Perfil (PUT substitui)
    if (data.user) {
      await Api.put('/profile', data.user).catch(e => console.warn('[import/profile]', e));
      _userCache = { ...DEFAULTS.user, ...data.user };
    }

    // Nota: backups antigos podem trazer `modes`/`workouts`/`homeExercises`
    // (feature removida, issue #36) — ignorados de propósito, sem erro.

    // 4. Weights (POST cada um — acumulativo)
    if (Array.isArray(data.weights)) {
      for (const w of data.weights) {
        if (!w || !w.data || w.peso == null || !w.tipo) continue;
        try {
          const created = await Api.post('/weights', { data: w.data, peso: w.peso, tipo: w.tipo });
          _weightsCache.push(created);
        } catch (e) { console.warn('[import/weights]', w, e); }
      }
      _weightsCache.sort((a, b) => a.data.localeCompare(b.data));
    }

    // 5. Rides (POST cada um)
    if (Array.isArray(data.rides)) {
      for (const r of data.rides) {
        const novo = normalizeRide({ ...r, id: r.id || genRideId() });
        if (!novo) continue;
        try {
          const created = await Api.post('/rides', novo);
          _ridesCache.push(created);
        } catch (e) { console.warn('[import/rides]', novo, e); }
      }
      _ridesCache.sort((a, b) => a.data.localeCompare(b.data));
    }

    // 6. Training log (POST cada um; UNIQUE em data → ignora duplicatas)
    if (Array.isArray(data.trainingLog)) {
      for (const e of data.trainingLog) {
        if (!e || !e.data) continue;
        const body = {
          id: e.id || _genId('tl'),
          data: e.data,
          tipos: Array.isArray(e.tipos) ? e.tipos : (e.tipo ? [e.tipo] : ['bike']),
          notas: e.notas || '',
        };
        try {
          const created = await Api.post('/training-log', body);
          _trainingLogCache.push(created);
        } catch (err) { console.warn('[import/training-log]', body, err); }
      }
      _trainingLogCache.sort((a, b) => a.data.localeCompare(b.data));
    }

    // 8. Routes (POST cada uma)
    if (Array.isArray(data.routes)) {
      for (const r of data.routes) {
        const body = { ...r, id: r.id || _genId('route') };
        try {
          const created = await Api.post('/routes', body);
          _routesCache.unshift(created);
        } catch (e) { console.warn('[import/routes]', body, e); }
      }
    }

    _setLs(KEYS.VERSION, SCHEMA_VERSION);
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   MIGRACAO LEGADA — somente na 1a execucao (sem versao em localStorage e
   sem perfil no backend). Le docs/dados_usuario.txt e POSTa o perfil.
═══════════════════════════════════════════════════════════════════════ */
async function migrateFromLegacyTxtIfNeeded() {
  // Se o backend ja tem perfil, nao migra
  const hasProfile = _userCache && _userCache.nome;
  if (hasProfile) return;
  if (localStorage.getItem(KEYS.VERSION)) return; // ja migrou alguma vez

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
  } catch (_) { /* sem arquivo legado, segue com defaults */ }

  if (!user.dataInicioPlano) user.dataInicioPlano = todayISO();

  // Persiste perfil no backend
  try {
    await window.Api.put('/profile', user);
    _userCache = user;
  } catch (e) { console.warn('[migrate/profile]', e); }

  _setLs(KEYS.VERSION, SCHEMA_VERSION);
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
