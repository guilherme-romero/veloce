#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   SEED DEMO — popula um banco `demo.db` com dados ficticios para a
   instancia de demonstracao (login user/user). NUNCA toca no banco real.

   Uso:
     DB_PATH=/caminho/abs/para/data/demo.db node scripts/seed-demo.js

   Seguranca:
     - Aborta se DB_PATH nao for definido.
     - Aborta se DB_PATH apontar para um arquivo chamado training.db.
   Idempotente: zera as tabelas de dados e re-insere a cada execucao.
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

// ── guarda de seguranca ──────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) {
  console.error('[seed-demo] Defina DB_PATH (ex.: .../data/demo.db). Abortado.');
  process.exit(1);
}
if (path.basename(DB_PATH) === 'training.db') {
  console.error('[seed-demo] Recusado: DB_PATH aponta para training.db (banco real).');
  process.exit(1);
}

// ── reutiliza as definicoes reais de DEFAULT_WORKOUTS / HOME_EXERCISES ─
// Carrega js/defaults.js num sandbox com shim de `window` (o arquivo e do
// frontend e define suas globais em window; genId e interno ao arquivo).
const defaultsSrc = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'js', 'defaults.js'), 'utf8');
const sandbox = { window: {}, Date, Math };
vm.createContext(sandbox);
vm.runInContext(defaultsSrc, sandbox);
const DEFAULT_WORKOUTS       = sandbox.window.DEFAULT_WORKOUTS || { base: [], build: [] };
const DEFAULT_HOME_EXERCISES = sandbox.window.DEFAULT_HOME_EXERCISES || [];

// ── PRNG deterministico (LCG) para dados estaveis entre execucoes ─────
let _seed = 20260701;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function rint(min, max) { return Math.floor(min + rnd() * (max - min + 1)); }
function rfloat(min, max, dec = 1) { return +(min + rnd() * (max - min)).toFixed(dec); }

// ── datas ────────────────────────────────────────────────────────────
const MS_DAY = 86400_000;
const TODAY = new Date();
function iso(offsetDays) {
  const d = new Date(TODAY.getTime() - offsetDays * MS_DAY);
  return d.toISOString().slice(0, 10);
}

// ── abre/cria o banco reutilizando db/init.js ────────────────────────
// db/init.js respeita process.env.DB_PATH e aplica schema + migracoes
// idempotentes + integrity_check — garante paridade total com producao
// (colunas adicionadas via ALTER TABLE, ex.: bike_components.pressao).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = require('../db/init');

// ── limpa tabelas de dados (ordem FK-safe) ───────────────────────────
const WIPE = [
  'bike_maintenance_log', 'bike_components', 'bikes',
  'training_log', 'weights', 'rides', 'workouts', 'modes', 'home_exercises',
  'user_profile',
];
for (const t of WIPE) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {} }

const seedAll = db.transaction(() => {
  const counts = {};

  // 1. Perfil (shape de DEFAULTS.user em js/storage.js) ────────────────
  const profile = {
    nome: 'Ciclista Demo',
    dataNascimento: '1990-05-14',
    altura: 178,
    pesoAtual: 76,
    pesoMeta: 72,
    bikePeso: 9.2,
    bikeModelo: 'Gravel',
    dataInicioPlano: iso(90),
  };
  db.prepare(`INSERT INTO user_profile (id, payload, updated_at)
              VALUES (1, ?, CURRENT_TIMESTAMP)`).run(JSON.stringify(profile));
  counts.user_profile = 1;

  // 2. Modos (DEFAULTS.modes) ──────────────────────────────────────────
  const modes = [
    { id: 'base',  nome: 'Fortalecimento · Core',  ordem: 0 },
    { id: 'build', nome: 'Condicionamento · Bike', ordem: 1 },
  ];
  const insMode = db.prepare('INSERT INTO modes (id, nome, ordem) VALUES (?, ?, ?)');
  modes.forEach(m => insMode.run(m.id, m.nome, m.ordem));
  counts.modes = modes.length;

  // 3. Workouts (reproduz DEFAULT_WORKOUTS: base e build) ───────────────
  const insWk = db.prepare('INSERT INTO workouts (id, mode_id, payload, ordem) VALUES (?, ?, ?, ?)');
  let wkTotal = 0;
  for (const modeId of ['base', 'build']) {
    (DEFAULT_WORKOUTS[modeId] || []).forEach((w, i) => {
      const { id, ...rest } = w;
      const wid = id || `wk_${modeId}_${i}`;
      insWk.run(wid, modeId, JSON.stringify({ ...rest, id: wid }), i);
      wkTotal++;
    });
  }
  counts.workouts = wkTotal;

  // 4. Home exercises (reproduz DEFAULT_HOME_EXERCISES) ─────────────────
  // home-workout.js le ex.icon/ex.name/ex.sets/ex.desc; rowToExercise
  // devolve {...payload, id, nome, ordem}. Guardamos payload = objeto todo.
  const insHx = db.prepare('INSERT INTO home_exercises (id, nome, payload, ordem) VALUES (?, ?, ?, ?)');
  DEFAULT_HOME_EXERCISES.forEach((e, i) => {
    const nome = e.name || e.nome || `Exercicio ${i + 1}`;
    const payload = { ...e, id: e.id, nome };
    insHx.run(e.id, nome, JSON.stringify(payload), i);
  });
  counts.home_exercises = DEFAULT_HOME_EXERCISES.length;

  // 5. Pesagens (~90 dias, tendencia 82 -> 76kg com ruido) ─────────────
  const insW = db.prepare('INSERT INTO weights (data, peso, tipo, fonte) VALUES (?, ?, ?, ?)');
  let wCount = 0;
  for (let off = 90; off >= 0; off -= rint(2, 3)) {
    const t = 1 - off / 90;                 // 0 (inicio) -> 1 (hoje)
    const base = 82 - 6 * t;                 // 82 -> 76
    const peso = +(base + rfloat(-0.4, 0.4, 2)).toFixed(1);
    insW.run(iso(off), peso, 'atual', 'manual');
    wCount++;
  }
  counts.weights = wCount;

  // 6. Registro diario (training_log) — alimenta Home/Insights/Heatmap ──
  const insTL = db.prepare('INSERT INTO training_log (id, data, tipos, notas, payload) VALUES (?, ?, ?, ?, ?)');
  const DOW_LONG = 6; // sabado costuma ser longao
  let tlCount = 0;
  for (let off = 60; off >= 0; off--) {
    const dateStr = iso(off);
    const dow = new Date(TODAY.getTime() - off * MS_DAY).getDay();
    const roll = rnd();
    // ~60% dos dias tem alguma atividade; domingo tende a folga
    if (dow === 0 && roll < 0.7) continue;
    if (roll < 0.40) continue;

    const tipos = [];
    let payload = {};
    const isLong = dow === DOW_LONG && rnd() < 0.8;
    const isBikeDay = dow !== 1 && dow !== 4 ? rnd() < 0.8 : rnd() < 0.35; // seg/qui = casa

    if (isBikeDay || isLong) {
      tipos.push('bike');
      const km  = isLong ? rfloat(55, 90) : rfloat(18, 45);
      const spd = rfloat(24, 30);           // km/h medio
      const tempoMovS = Math.round((km / spd) * 3600);
      payload.bike = {
        km,
        tempoMovS,
        elevM: Math.round(km * rfloat(6, 14)),
        fcMedia: rint(132, 155),
        fcMax: rint(165, 182),
        fonte: 'manual',
      };
    }
    if (dow === 1 || dow === 4) {           // seg/qui: fortalecimento em casa
      tipos.push('fisico');
      payload.fisico = { tempoMinutos: rint(25, 45), fc: rint(105, 125), fonte: 'manual' };
    }
    if (rnd() < 0.5) tipos.push('alongamento');
    if (tipos.length === 0) continue;

    insTL.run(`seed_${dateStr.replace(/-/g, '')}`, dateStr,
      JSON.stringify(tipos), '', JSON.stringify(payload));
    tlCount++;
  }
  counts.training_log = tlCount;

  // 7. Bikes + componentes + manutencao ────────────────────────────────
  const insBike = db.prepare(`INSERT INTO bikes
    (id, nome, marca, modelo, tipo, peso_kg, ano, km_inicial, active_since, active,
     deactivated_at, tempo_base, elev_base, atividades_base)
    VALUES (@id,@nome,@marca,@modelo,@tipo,@peso_kg,@ano,@km_inicial,@active_since,@active,
            NULL,0,0,0)`);
  const bikes = [
    { id: 'bike_speed', nome: 'Speed de Treino', marca: 'Caloi', modelo: 'Strada Racing',
      tipo: 'Speed', peso_kg: 8.6, ano: 2022, km_inicial: 1200, active_since: iso(90), active: 1 },
    { id: 'bike_gravel', nome: 'Gravel de Fim de Semana', marca: 'Sense', modelo: 'Versa',
      tipo: 'Gravel', peso_kg: 9.2, ano: 2023, km_inicial: 300, active_since: iso(60), active: 1 },
  ];
  bikes.forEach(b => insBike.run(b));
  counts.bikes = bikes.length;

  const insComp = db.prepare(`INSERT INTO bike_components
    (id, bike_id, tipo, vida_util_km, km_at_install, tem_limpeza, intervalo_limpeza_km,
     km_at_last_clean, pressao, marca, modelo, observacao, data_install)
    VALUES (@id,@bike_id,@tipo,@vida_util_km,@km_at_install,@tem_limpeza,@intervalo_limpeza_km,
            @km_at_last_clean,@pressao,@marca,@modelo,@observacao,@data_install)`);
  const comps = [
    { id: 'c1', bike_id: 'bike_speed',  tipo: 'corrente',        vida_util_km: 4000, km_at_install: 1200,
      tem_limpeza: 1, intervalo_limpeza_km: 300, km_at_last_clean: 1900, pressao: null,
      marca: 'Shimano', modelo: '105', observacao: '', data_install: iso(85) },
    { id: 'c2', bike_id: 'bike_speed',  tipo: 'pneu_dianteiro',  vida_util_km: 5000, km_at_install: 1200,
      tem_limpeza: 0, intervalo_limpeza_km: null, km_at_last_clean: 0, pressao: '95 psi',
      marca: 'Continental', modelo: 'GP5000', observacao: '', data_install: iso(85) },
    { id: 'c3', bike_id: 'bike_gravel', tipo: 'pastilhas_freio', vida_util_km: 3000, km_at_install: 300,
      tem_limpeza: 0, intervalo_limpeza_km: null, km_at_last_clean: 0, pressao: null,
      marca: 'SRAM', modelo: 'Rival', observacao: 'Freio a disco', data_install: iso(55) },
  ];
  comps.forEach(c => insComp.run(c));
  counts.bike_components = comps.length;

  const insMaint = db.prepare(`INSERT INTO bike_maintenance_log
    (id, bike_id, component_id, tipo_evento, data, km_bike, notas)
    VALUES (@id,@bike_id,@component_id,@tipo_evento,@data,@km_bike,@notas)`);
  const maint = [
    { id: 'm1', bike_id: 'bike_speed',  component_id: 'c1', tipo_evento: 'limpeza',
      data: iso(20), km_bike: 1900, notas: 'Lubrificacao da corrente' },
    { id: 'm2', bike_id: 'bike_speed',  component_id: null, tipo_evento: 'revisao_completa',
      data: iso(45), km_bike: 1650, notas: 'Revisao geral pos-inverno' },
    { id: 'm3', bike_id: 'bike_gravel', component_id: 'c3', tipo_evento: 'substituicao',
      data: iso(10), km_bike: 700, notas: 'Troca de pastilhas' },
  ];
  maint.forEach(m => insMaint.run(m));
  counts.bike_maintenance_log = maint.length;

  // 8. Passeios planejados (futuros) ───────────────────────────────────
  const insRide = db.prepare(`INSERT INTO rides
    (id, data, destino, distancia, altitude, duracao, dificuldade, nota, notas)
    VALUES (@id,@data,@destino,@distancia,@altitude,@duracao,@dificuldade,@nota,@notas)`);
  const rides = [
    { id: 'r1', data: iso(-4),  destino: 'Represa do Jaguari',  distancia: 62, altitude: 780,
      duracao: '2h40', dificuldade: 'media', nota: 4, notas: 'Levar 2 caramanholas' },
    { id: 'r2', data: iso(-11), destino: 'Serra do Japi',        distancia: 48, altitude: 1150,
      duracao: '3h00', dificuldade: 'alta',  nota: 5, notas: 'Subida forte no km 20' },
    { id: 'r3', data: iso(-18), destino: 'Ciclovia do Rio',      distancia: 30, altitude: 120,
      duracao: '1h15', dificuldade: 'baixa', nota: 3, notas: 'Pedal leve de recuperacao' },
  ];
  rides.forEach(r => insRide.run(r));
  counts.rides = rides.length;

  return counts;
});

const counts = seedAll();
try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
db.close();

console.log('[seed-demo] Banco populado em', DB_PATH);
for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(22)} ${n}`);
