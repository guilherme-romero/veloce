(function () {

// ─── DADOS DE TERRENO ─────────────────────────────────────────────────────────
const TERRAIN_MAP = {
  madeira:           { label:'Pista de Madeira',                  img:'data/pistas/pista_madeira.png',                           mult:1.08, minPsi:90,  maxPsi:140, safeMin:50, safeMax:145, psiRange:'90–140',   badge:'Velódromo', badgeColor:'#22c55e' },
  concreto:          { label:'Pista de Concreto',                  img:'data/pistas/pista_concreto.png',                          mult:1.03, minPsi:75,  maxPsi:120, safeMin:45, safeMax:125, psiRange:'75–120',   badge:'Liso',      badgeColor:'#4e9ef5' },
  asfalto_novo:      { label:'Asfalto novo',                       img:'data/pistas/asfalto_novo.png',                            mult:1.00, minPsi:65,  maxPsi:110, safeMin:40, safeMax:120, psiRange:'65–110',   badge:'Baseline',  badgeColor:'#c6f135' },
  asfalto_desgastado:{ label:'Asfalto desgastado / Rachaduras',    img:'data/pistas/asfalto_desgastado__algumas_rachaduras.png',  mult:0.93, minPsi:55,  maxPsi:100, safeMin:35, safeMax:105, psiRange:'55–100',   badge:'Moderado',  badgeColor:'#f5d523' },
  asfalto_mau:       { label:'Asfalto em mau estado',              img:'data/pistas/asfalto_em_mau_estado__revestimento_asfaltico.png', mult:0.85, minPsi:45, maxPsi:85, safeMin:30, safeMax:90, psiRange:'45–85', badge:'Ruim',      badgeColor:'#f0523a' },
  paralelepipedos:   { label:'Paralelepípedos',                    img:'data/pistas/paralelepipedos.png',                         mult:0.72, minPsi:35,  maxPsi:70,  safeMin:25, safeMax:75,  psiRange:'35–70',    badge:'Cobblestone',badgeColor:'#ec3a8b'},
  gravel1:           { label:'Cascalho Cat 1 — Compacto',          img:'data/pistas/gravel_categoria_1.png',                      mult:0.80, minPsi:30,  maxPsi:65,  safeMin:20, safeMax:70,  psiRange:'30–65',    badge:'Gravel 1',  badgeColor:'#c6f135' },
  gravel2:           { label:'Cascalho Cat 2 — Médio',             img:'data/pistas/gravel_categoria_2.png',                      mult:0.70, minPsi:25,  maxPsi:55,  safeMin:18, safeMax:60,  psiRange:'25–55',    badge:'Gravel 2',  badgeColor:'#f5d523' },
  gravel3:           { label:'Cascalho Cat 3 — Solto',             img:'data/pistas/gravel_categoria_3.png',                      mult:0.60, minPsi:20,  maxPsi:45,  safeMin:15, safeMax:50,  psiRange:'20–45',    badge:'Gravel 3',  badgeColor:'#f0523a' },
  gravel4:           { label:'Cascalho Cat 4 — Muito solto / Areia',img:'data/pistas/gravel_categoria_4.png',                    mult:0.50, minPsi:15,  maxPsi:35,  safeMin:12, safeMax:40,  psiRange:'15–35',    badge:'Gravel 4',  badgeColor:'#ec3a8b' },
};

// ─── DADOS EMBUTIDOS — CASSETES / COROAS ─────────────────────────────────────
const CASSETES_DATA = [
  {id:1, marca:'Shimano',categoria:'MTB',velocidades:12,freehub:'MicroSpline',relacao:'10-45',modelos:'XTR CS-M9100, XT CS-M8100, SLX CS-M7100',cogs:[10,12,14,16,18,21,24,28,32,36,40,45]},
  {id:2, marca:'Shimano',categoria:'MTB',velocidades:12,freehub:'MicroSpline',relacao:'10-51',modelos:'Deore CS-M6100, SLX CS-M7100, XT CS-M8100, XTR CS-M9100',cogs:[10,12,14,16,18,21,24,28,33,39,45,51]},
  {id:3, marca:'Shimano',categoria:'MTB',velocidades:11,freehub:'HG',relacao:'11-42',modelos:'Deore M5100, SLX M7000, XT M8000',cogs:[11,13,15,17,19,21,24,28,32,37,42]},
  {id:4, marca:'Shimano',categoria:'MTB',velocidades:11,freehub:'HG',relacao:'11-46',modelos:'Deore M5100, SLX M7000, XT M8000',cogs:[11,13,15,17,19,21,24,28,32,37,46]},
  {id:5, marca:'Shimano',categoria:'MTB',velocidades:10,freehub:'HG',relacao:'11-36',modelos:'Deore HG500, HG50',cogs:[11,13,15,17,19,21,24,28,32,36]},
  {id:6, marca:'Shimano',categoria:'MTB',velocidades:10,freehub:'HG',relacao:'11-42',modelos:'Deore M4100',cogs:[11,13,15,18,21,24,28,32,37,42]},
  {id:7, marca:'Shimano',categoria:'Road',velocidades:12,freehub:'HG',relacao:'11-30',modelos:'105 R7101, Ultegra R8101, Dura-Ace R9200',cogs:[11,12,13,14,15,17,19,21,24,27,30,34]},
  {id:8, marca:'Shimano',categoria:'Road',velocidades:12,freehub:'HG',relacao:'11-34',modelos:'105, Ultegra, Dura-Ace',cogs:[11,12,13,14,15,17,19,21,24,27,30,34]},
  {id:9, marca:'Shimano',categoria:'Road',velocidades:11,freehub:'HG',relacao:'11-28',modelos:'105 R7000, Ultegra R8000',cogs:[11,12,13,14,15,17,19,21,23,25,28]},
  {id:10,marca:'Shimano',categoria:'Road',velocidades:11,freehub:'HG',relacao:'11-30',modelos:'105, Ultegra',cogs:[11,12,13,14,15,17,19,21,24,27,30]},
  {id:11,marca:'Shimano',categoria:'Road',velocidades:11,freehub:'HG',relacao:'11-32',modelos:'105, Ultegra',cogs:[11,12,13,14,16,18,20,22,25,28,32]},
  {id:12,marca:'Shimano',categoria:'Road',velocidades:11,freehub:'HG',relacao:'11-34',modelos:'105 GS',cogs:[11,13,15,17,19,21,23,25,27,30,34]},
  {id:13,marca:'Shimano',categoria:'Gravel',velocidades:11,freehub:'HG',relacao:'11-34',modelos:'GRX RX810',cogs:[11,13,15,17,19,21,23,25,27,30,34]},
  {id:14,marca:'Shimano',categoria:'Gravel',velocidades:12,freehub:'HG',relacao:'11-36',modelos:'GRX RX820',cogs:[11,12,13,15,17,19,21,24,28,32,36]},
  {id:15,marca:'SRAM',categoria:'MTB',velocidades:12,freehub:'XD',relacao:'10-50',modelos:'GX Eagle, X01 Eagle, XX1 Eagle',cogs:[10,12,14,16,18,21,24,28,32,36,42,50]},
  {id:16,marca:'SRAM',categoria:'MTB',velocidades:12,freehub:'XD',relacao:'10-52',modelos:'GX Eagle, X0 Eagle, XX Eagle, XX SL Eagle',cogs:[10,12,14,16,18,21,24,28,32,38,44,52]},
  {id:17,marca:'SRAM',categoria:'MTB',velocidades:12,freehub:'HG',relacao:'11-50',modelos:'NX Eagle PG-1230',cogs:[11,13,15,17,19,22,25,28,32,36,42,50]},
  {id:18,marca:'SRAM',categoria:'Road',velocidades:12,freehub:'XDR',relacao:'10-26',modelos:'Red AXS',cogs:[10,11,12,13,14,15,16,17,19,21,23,26]},
  {id:19,marca:'SRAM',categoria:'Road',velocidades:12,freehub:'XDR',relacao:'10-28',modelos:'Rival AXS, Force AXS, Red AXS',cogs:[10,11,12,13,14,15,16,17,19,21,24,28]},
  {id:20,marca:'SRAM',categoria:'Road',velocidades:12,freehub:'XDR',relacao:'10-30',modelos:'Rival AXS, Force AXS, Red AXS',cogs:[10,11,12,13,14,15,17,19,21,24,27,30]},
  {id:21,marca:'SRAM',categoria:'Road',velocidades:12,freehub:'XDR',relacao:'10-33',modelos:'Rival AXS, Force AXS, Red AXS',cogs:[10,11,12,13,14,15,17,19,21,24,28,33]},
  {id:22,marca:'SRAM',categoria:'Road',velocidades:12,freehub:'XDR',relacao:'10-36',modelos:'Force XPLR, Rival XPLR',cogs:[10,11,12,13,15,17,19,21,24,28,32,36]},
  {id:23,marca:'SRAM',categoria:'Gravel',velocidades:12,freehub:'XDR',relacao:'10-44',modelos:'XPLR XG-1271',cogs:[10,11,13,15,17,19,21,24,28,32,38,44]},
  {id:24,marca:'SRAM',categoria:'Gravel',velocidades:12,freehub:'XDR',relacao:'10-46',modelos:'XPLR XG-1251',cogs:[10,11,13,15,17,19,21,24,28,32,38,46]},
];

const COROAS_DATA = [
  {marca:'Shimano',categoria:'MTB',config:'1x',dentes:'32',modelos:'Deore FC-M4100'},
  {marca:'Shimano',categoria:'MTB',config:'1x',dentes:'34',modelos:'SLX FC-M7100'},
  {marca:'Shimano',categoria:'MTB',config:'1x',dentes:'36',modelos:'XT FC-M8100'},
  {marca:'Shimano',categoria:'MTB',config:'2x',dentes:'26,36',modelos:'Deore FC-M5100-2'},
  {marca:'Shimano',categoria:'MTB',config:'2x',dentes:'28,38',modelos:'SLX FC-M7100-2'},
  {marca:'Shimano',categoria:'Road',config:'2x',dentes:'34,50',modelos:'105 FC-R7000, Ultegra FC-R8000'},
  {marca:'Shimano',categoria:'Road',config:'2x',dentes:'36,52',modelos:'Dura-Ace R9200, Ultegra FC-R8200'},
  {marca:'Shimano',categoria:'Road',config:'2x',dentes:'33,46',modelos:'105 FC-R7100 compact'},
  {marca:'Shimano',categoria:'Gravel',config:'1x',dentes:'40',modelos:'GRX FC-RX820'},
  {marca:'Shimano',categoria:'Gravel',config:'2x',dentes:'31,48',modelos:'GRX FC-RX820-2'},
  {marca:'SRAM',categoria:'MTB',config:'1x',dentes:'30',modelos:'NX Eagle FC-NX1'},
  {marca:'SRAM',categoria:'MTB',config:'1x',dentes:'32',modelos:'GX Eagle FC-GX1'},
  {marca:'SRAM',categoria:'MTB',config:'1x',dentes:'34',modelos:'X01 Eagle FC-X01-1'},
  {marca:'SRAM',categoria:'MTB',config:'1x',dentes:'36',modelos:'XX1 Eagle FC-XX1-1'},
  {marca:'SRAM',categoria:'Road',config:'2x',dentes:'33,46',modelos:'Rival AXS WIDE'},
  {marca:'SRAM',categoria:'Road',config:'2x',dentes:'35,48',modelos:'Force AXS, Red AXS'},
  {marca:'SRAM',categoria:'Road',config:'2x',dentes:'36,48',modelos:'Force AXS compact'},
  {marca:'SRAM',categoria:'Gravel',config:'1x',dentes:'38',modelos:'Force XPLR'},
  {marca:'SRAM',categoria:'Gravel',config:'1x',dentes:'40',modelos:'Rival XPLR'},
  {marca:'SRAM',categoria:'Gravel',config:'2x',dentes:'35,46',modelos:'Force AXS XPLR Wide'},
];

// ─── ESTADO LOCAL ─────────────────────────────────────────────────────────────
let gearBrand = 'Shimano';
let gearCat   = 'MTB';
let gearSelectedCog = null;
let gearState = null;
let gearDbConnected = false;
let _loaded = false;

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(id, btn) {
  document.querySelectorAll('#ferramentas .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#ferramentas .tool-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + id).classList.add('active');
}

// ─── PSI CALCULATOR ───────────────────────────────────────────────────────────
function calcPSI() {
  const rider   = parseFloat(document.getElementById('psi-rider').value) || 75;
  const bike    = parseFloat(document.getElementById('psi-bike').value) || 9;
  const equip   = parseFloat(document.getElementById('psi-equip').value) || 0;
  const width   = parseInt(document.getElementById('psi-width').value) || 28;
  const type    = document.getElementById('psi-type').value;
  const distribRaw = document.getElementById('psi-distrib').value;
  const terrain = document.getElementById('psi-terrain').value;

  const parts    = distribRaw.split('/').map(Number);
  const frontPct = parts[0] / 100;
  const rearPct  = parts[1] / 100;

  const totalKg  = rider + bike + equip;
  const totalLbs = totalKg * 2.20462;
  const frontLbs = totalLbs * frontPct;
  const rearLbs  = totalLbs * rearPct;

  // Base PSI — Silca inspired: (weight_lbs × 0.65) / (width_in)
  let frontPSI = (frontLbs * 0.65) / (width / 25.4);
  let rearPSI  = (rearLbs  * 0.65) / (width / 25.4);

  // Terrain multiplier (SILCA breakpoint pressure theory)
  const tData = TERRAIN_MAP[terrain];
  frontPSI *= tData.mult;
  rearPSI  *= tData.mult;

  // Mounting type correction
  if (type === 'tubeless') { frontPSI *= 0.85; rearPSI *= 0.85; }
  if (type === 'tubular')  { frontPSI *= 1.05; rearPSI *= 1.05; }

  // Clamp pelos limites físicos de segurança
  frontPSI = Math.round(Math.max(tData.safeMin, Math.min(tData.safeMax, frontPSI)));
  rearPSI  = Math.round(Math.max(tData.safeMin, Math.min(tData.safeMax, rearPSI)));

  const avgPSI = (frontPSI + rearPSI) / 2;
  const barPct = Math.max(3, Math.min(97, Math.round(((avgPSI - tData.minPsi) / (tData.maxPsi - tData.minPsi)) * 100)));

  document.getElementById('psi-front-val').textContent = frontPSI;
  document.getElementById('psi-rear-val').textContent  = rearPSI;
  document.getElementById('psi-diff').textContent      = '+' + (rearPSI - frontPSI);
  document.getElementById('psi-bar-fill').style.width  = barPct + '%';
  document.getElementById('psi-range-min').textContent = tData.minPsi + ' psi';
  document.getElementById('psi-range-max').textContent = tData.maxPsi + ' psi';

  const typeLabel = { clincher:'Clincher (câmara)', tubeless:'Tubeless', tubular:'Tubular' }[type];
  let notes = `<strong style="color:var(--text)">${typeLabel}</strong> · ${width}mm · ${tData.label} · Dist. peso ${distribRaw}<br>`;
  notes += `Peso total: ${totalKg.toFixed(1)} kg (ciclista ${rider}kg + bike ${bike}kg + equip ${equip}kg). `;
  if (type === 'tubeless') notes += 'Tubeless: −15% de pressão vs clincher. ';
  if (tData.mult < 0.85) notes += 'Superfície muito rugosa — pressão mais baixa reduz as perdas por impedância (teoria SILCA). ';
  if (tData.mult >= 1.03) notes += 'Superfície lisa — pressão mais alta é ótima para minimizar Crr. ';
  document.getElementById('psi-notes').innerHTML = notes;

  if (document.getElementById('psi-co2').checked) calcCO2(avgPSI, width);

  document.getElementById('psi-result').classList.add('show');
}

function calcCO2(psi, width_mm) {
  const circ_m  = width_mm <= 32 ? 2.105 : width_mm <= 45 ? 2.190 : 2.290;
  const r_tire  = (width_mm / 2) / 1000;
  const vol_L   = Math.PI * r_tire * r_tire * circ_m * 1000;
  const p_bar   = psi * 0.0689476 + 0.101325;
  const m_co2_g = vol_L * p_bar * 44 / (0.08314 * 293);
  document.getElementById('co2-volume').textContent = vol_L.toFixed(2);
  document.getElementById('co2-grams').textContent  = Math.round(m_co2_g);
  document.getElementById('co2-16g').textContent    = Math.ceil(m_co2_g / 16);
  document.getElementById('co2-25g').textContent    = Math.ceil(m_co2_g / 25);
}

function toggleCO2() {
  const box = document.getElementById('psi-co2-box');
  if (document.getElementById('psi-co2').checked) {
    const front = parseInt(document.getElementById('psi-front-val').textContent) || 0;
    const rear  = parseInt(document.getElementById('psi-rear-val').textContent) || 0;
    const avg   = (front + rear) / 2;
    const width = parseInt(document.getElementById('psi-width').value) || 28;
    if (avg > 0) calcCO2(avg, width);
    box.classList.add('show');
  } else {
    box.classList.remove('show');
  }
}

// ─── GEAR CALCULATOR ──────────────────────────────────────────────────────────
function selectBrand(brand, btn) {
  gearBrand = brand;
  document.querySelectorAll('#gear-brand-btns .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  populateCassetes();
  populateCoroas();
}

function selectCat(cat, btn) {
  gearCat = cat;
  document.querySelectorAll('#gear-cat-btns .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  populateCassetes();
  populateCoroas();
}

function populateCassetes() {
  const sel = document.getElementById('gear-cassete');
  sel.innerHTML = '<option value="">Selecione...</option>';
  CASSETES_DATA.filter(c => c.marca === gearBrand && c.categoria === gearCat).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.relacao} · ${c.modelos.split(',')[0].trim()} (${c.velocidades}v ${c.freehub})`;
    sel.appendChild(opt);
  });
  document.getElementById('gear-freehub-badge').textContent = '';
}

function populateCoroas() {
  const sel = document.getElementById('gear-coroa-preset');
  sel.innerHTML = '<option value="">Presets da categoria...</option>';
  COROAS_DATA.filter(r => r.marca === gearBrand && r.categoria === gearCat).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.dentes;
    opt.textContent = `${r.config} · ${r.dentes}t · ${r.modelos.split(',')[0]}`;
    sel.appendChild(opt);
  });
  document.getElementById('gear-ring-chooser').innerHTML = '';
}

function onCasseteChange() {
  const id = parseInt(document.getElementById('gear-cassete').value);
  if (!id) { document.getElementById('gear-freehub-badge').textContent = ''; return; }
  const c = CASSETES_DATA.find(x => x.id === id);
  if (c) {
    document.getElementById('gear-freehub-badge').innerHTML =
      `<i class="fa-solid fa-link" style="font-size:10px;color:var(--teal)"></i> Freehub: <strong style="color:var(--text)">${c.freehub}</strong> · ${c.velocidades} velocidades · <span style="color:var(--muted)">${c.modelos}</span>`;
  }
}

function applyCoroaPreset() {
  const val = document.getElementById('gear-coroa-preset').value;
  if (!val) return;
  const rings = val.split(',').map(Number);
  document.getElementById('gear-chainring').value = rings[0];
  renderRingChooser(rings);
}

function renderRingChooser(rings) {
  const box = document.getElementById('gear-ring-chooser');
  box.innerHTML = '';
  if (rings.length < 2) return;
  rings.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn' + (i === 0 ? ' active' : '');
    b.textContent = r + 't' + (i === 0 ? ' (pequena)' : ' (grande)');
    b.onclick = () => {
      box.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById('gear-chainring').value = r;
      if (gearState) calcGear();
    };
    box.appendChild(b);
  });
}

function updateDbBadge() {
  const badge = document.getElementById('gear-db-badge');
  if (!badge) return;
  badge.innerHTML = gearDbConnected
    ? `<i class="fa-solid fa-database" style="color:#22c55e;font-size:10px"></i> <span style="color:var(--muted)">Conectado: cassetes.db (SQLite via sql.js)</span>`
    : `<i class="fa-solid fa-database" style="color:var(--teal);font-size:10px"></i> <span style="color:var(--muted)">Dados embutidos (cassetes.db indisponível via file://)</span>`;
}

function calcGear() {
  const casseteId = parseInt(document.getElementById('gear-cassete').value);
  if (!casseteId) { alert('Selecione um cassete antes de calcular.'); return; }
  const cassete  = CASSETES_DATA.find(x => x.id === casseteId);
  if (!cassete) return;

  const cr      = parseFloat(document.getElementById('gear-chainring').value) || 34;
  const cadence = parseFloat(document.getElementById('gear-cadence').value) || 90;
  const circ_mm = parseFloat(document.getElementById('gear-wheel').value) || 2105;
  const circ_m  = circ_mm / 1000;
  const cogs    = cassete.cogs;

  let selCog = (gearSelectedCog && cogs.includes(gearSelectedCog))
    ? gearSelectedCog
    : cogs[Math.floor(cogs.length / 2)];

  gearState = { cr, cogs, cadence, circ_m, cassete };

  renderGearMatrix();
  renderGearHeadline(selCog);
  updateDbBadge();
  document.getElementById('gear-result').classList.add('show');
}

function renderGearHeadline(cog) {
  if (!gearState) return;
  const { cr, cadence, circ_m } = gearState;
  gearSelectedCog = cog;
  const ratio    = cr / cog;
  const speed    = ratio * cadence * circ_m * 60 / 1000;
  const distPerR = ratio * circ_m;
  document.getElementById('gr-cr').textContent      = cr;
  document.getElementById('gr-cog-sel').textContent = cog;
  document.getElementById('gr-cad').textContent     = cadence;
  document.getElementById('gear-speed-big').textContent = speed.toFixed(1);
  document.getElementById('gr-ratio').textContent   = ratio.toFixed(2);
  document.getElementById('gr-distrev').textContent = distPerR.toFixed(2);
  document.querySelectorAll('#gear-matrix-body tr').forEach(tr => {
    const active = parseInt(tr.dataset.cog) === cog;
    tr.querySelector('.td-cog').classList.toggle('row-active', active);
    tr.querySelectorAll('td').forEach((td, idx) => {
      if (idx === 0) return;
      td.classList.toggle('cell-active', active && td.classList.contains('col-active'));
    });
  });
}

function renderGearMatrix() {
  if (!gearState) return;
  const { cr, cogs, cadence, circ_m } = gearState;
  const cadences = [60, 75, 90, 100, 110];
  const tbody = document.getElementById('gear-matrix-body');
  tbody.innerHTML = '';

  cogs.forEach(cog => {
    const tr = document.createElement('tr');
    tr.dataset.cog = cog;
    tr.style.cursor = 'pointer';
    const isSelCog = cog === gearSelectedCog;
    const tdLabel = document.createElement('td');
    tdLabel.className = 'td-cog' + (isSelCog ? ' row-active' : '');
    tdLabel.textContent = cog + 't';
    tr.appendChild(tdLabel);

    cadences.forEach(c => {
      const s = (cr / cog * c * circ_m * 60 / 1000);
      const td = document.createElement('td');
      td.textContent = s.toFixed(1);
      const isNearCadence = Math.abs(c - cadence) <= 8;
      if (isNearCadence) td.classList.add('col-active');
      if (isSelCog && isNearCadence) td.classList.add('cell-active');
      tr.appendChild(td);
    });
    tr.onclick = () => renderGearHeadline(cog);
    tbody.appendChild(tr);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function tryLoadDB() {
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.min.js');
    if (!window.initSqlJs) return;
    const SQL = await window.initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}` });
    const resp = await fetch('data/cassetes.db');
    if (!resp.ok) return;
    const buf = await resp.arrayBuffer();
    const db  = new SQL.Database(new Uint8Array(buf));
    const res = db.exec('SELECT COUNT(*) FROM cassetes');
    if (res && res.length) { gearDbConnected = true; updateDbBadge(); }
  } catch(e) { /* mantém dados embutidos (fallback JS) */ }
}

// ─── ROUTE CALCULATOR ─────────────────────────────────────────────────────────
function calcRoute() {
  const dist    = parseFloat(document.getElementById('route-dist').value) || 60;
  const speed   = parseFloat(document.getElementById('route-speed').value) || 28;
  const elev    = parseFloat(document.getElementById('route-elev').value) || 800;
  const profile = parseFloat(document.getElementById('route-profile').value) || 1.0;
  const stops   = parseFloat(document.getElementById('route-stops').value) || 0;
  const wind    = parseFloat(document.getElementById('route-wind').value) || 0;

  const adjSpeed    = Math.max(speed + wind, 10);
  const elevEquivKm = elev / 100;
  const virtDist    = dist + elevEquivKm;
  const basePenMin  = elevEquivKm / adjSpeed * 60;
  const climbPenMin = Math.round(basePenMin / profile);
  const flatTimeMin = (dist / adjSpeed) * 60;
  const movTimeMin  = flatTimeMin + climbPenMin;
  const totalTimeMin= movTimeMin + stops;
  const avgSpeedAdj = dist / (movTimeMin / 60);
  const calories    = Math.round(dist * 50 + elev * 0.1);
  const pace        = movTimeMin / dist;

  const fmt = (min) => {
    const h = Math.floor(min/60), m = Math.round(min%60);
    return h > 0 ? `${h}:${m.toString().padStart(2,'0')}` : `${m}min`;
  };

  document.getElementById('route-total-time').innerHTML   = `${fmt(totalTimeMin)}<span>h</span>`;
  document.getElementById('route-moving-time').innerHTML  = `${fmt(movTimeMin)}<span>h</span>`;
  document.getElementById('route-avg-speed-adj').innerHTML= `${avgSpeedAdj.toFixed(1)}<span>km/h</span>`;
  document.getElementById('route-virt-dist').textContent  = virtDist.toFixed(1);
  document.getElementById('route-climb-penalty').textContent = climbPenMin;
  document.getElementById('route-calories').textContent   = calories.toLocaleString('pt-BR');
  document.getElementById('route-pace').textContent       = `${Math.floor(pace)}:${Math.round((pace%1)*60).toString().padStart(2,'0')}`;

  const flatPct  = Math.round(flatTimeMin / totalTimeMin * 100);
  const climbPct = Math.round(climbPenMin / totalTimeMin * 100);
  const stopsPct = 100 - flatPct - climbPct;
  document.getElementById('route-breakdown').innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700">
      <span style="width:12px;height:12px;background:var(--teal);border-radius:3px;display:block"></span>
      <span style="color:var(--muted)">Pedalada plana</span>
      <span style="color:var(--text)">${flatPct}% · ${fmt(flatTimeMin)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700">
      <span style="width:12px;height:12px;background:#ec3a8b;border-radius:3px;display:block"></span>
      <span style="color:var(--muted)">Penalidade subida</span>
      <span style="color:var(--text)">${climbPct}% · ${fmt(climbPenMin)}</span>
    </div>
    ${stops > 0 ? `<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700">
      <span style="width:12px;height:12px;background:var(--border);border-radius:3px;display:block"></span>
      <span style="color:var(--muted)">Paradas</span>
      <span style="color:var(--text)">${stopsPct}% · ${fmt(stops)}</span>
    </div>` : ''}`;

  document.getElementById('route-result').classList.add('show');
}

// ─── NUTRITION CALCULATOR ─────────────────────────────────────────────────────
function calcNutri() {
  const weight  = parseFloat(document.getElementById('n-weight').value) || 72;
  const sex     = document.getElementById('n-sex').value;
  const level   = document.getElementById('n-level').value;
  const heavy   = document.getElementById('n-heavy-sweater').checked;
  const dist    = parseFloat(document.getElementById('n-dist').value) || 80;
  const speed   = parseFloat(document.getElementById('n-speed').value) || 25;
  const elev    = parseFloat(document.getElementById('n-elev').value) || 600;
  const intens  = document.getElementById('n-intensity').value;
  const temp    = parseInt(document.getElementById('n-temp').value) || 28;
  const humid   = parseInt(document.getElementById('n-humid').value) || 60;
  const sun     = document.getElementById('n-sun').checked;
  const gelCarb = parseFloat(document.getElementById('n-gel-carb').value) || 25;
  const gelSod  = parseFloat(document.getElementById('n-gel-sodium').value) || 100;

  const elevEquivKm = elev / 100;
  const virtDist    = dist + elevEquivKm;
  const duration_h  = virtDist / speed;

  let sweat = temp < 20 ? 500 : temp < 28 ? 650 : temp < 35 ? 875 : 1100;
  const iMult = { easy:0.7, mod:1.0, hard:1.3, max:1.6 }[intens];
  sweat *= iMult;
  const weightFactor = 0.8 + (weight / 70) * 0.2;
  sweat *= weightFactor;
  const levelSweat = { beginner:0.9, inter:1.0, advanced:1.1 }[level];
  sweat *= levelSweat;
  if (sex === 'f') sweat *= 0.9;
  if (humid > 70) sweat *= 1.1;
  if (sun) sweat += 150;

  const water_mlh   = Math.min(Math.round(sweat * 0.9), 1000);
  const water_total = Math.round(water_mlh * duration_h);

  let carb_gh = duration_h <= 1 ? 25 : duration_h <= 2 ? 45 : duration_h <= 3 ? 67 : duration_h <= 5 ? 75 : 90;
  if (intens === 'hard' || intens === 'max') carb_gh += 10;
  const carbCap = { beginner:60, inter:90, advanced:120 }[level];
  carb_gh = Math.min(carb_gh, carbCap);
  const carb_total  = Math.round(carb_gh * duration_h);
  const carb_per_kg = carb_gh / weight;

  let sodium_mgh = temp < 20 ? 400 : temp < 28 ? 600 : temp < 35 ? 850 : 1200;
  if (heavy) sodium_mgh = Math.round(sodium_mgh * 1.3);
  const sodium_total = Math.round(sodium_mgh * duration_h);

  const gel_per_h = Math.ceil(carb_gh / gelCarb);
  const gel_total = Math.ceil(carb_total / gelCarb);

  const kpiEl = document.getElementById('nutri-kpi-grid');
  kpiEl.innerHTML = `
    <div class="nutri-card" style="border-color:rgba(78,158,245,.3)">
      <div class="nutri-card-val" style="color:#4e9ef5">${(water_total/1000).toFixed(1)}<span class="nutri-card-unit" style="color:#4e9ef5">L</span></div>
      <div class="nutri-card-sub">Água total</div>
      <div class="nutri-card-rate">${water_mlh} ml/h</div>
    </div>
    <div class="nutri-card">
      <div class="nutri-card-val">${carb_total}<span class="nutri-card-unit">g</span></div>
      <div class="nutri-card-sub">Carboidratos</div>
      <div class="nutri-card-rate">${Math.round(carb_gh)} g/h · ${carb_per_kg.toFixed(2)} g/kg/h</div>
    </div>
    <div class="nutri-card" style="border-color:rgba(245,213,35,.3)">
      <div class="nutri-card-val" style="color:#f5d523">${(sodium_total/1000).toFixed(1)}<span class="nutri-card-unit" style="color:#f5d523">g</span></div>
      <div class="nutri-card-sub">Sódio total</div>
      <div class="nutri-card-rate">${Math.round(sodium_mgh)} mg/h</div>
    </div>
    <div class="nutri-card" style="border-color:rgba(236,58,139,.3)">
      <div class="nutri-card-val" style="color:#ec3a8b">${gel_total}<span class="nutri-card-unit" style="color:#ec3a8b">géis</span></div>
      <div class="nutri-card-sub">Géis (${gelCarb}g cada)</div>
      <div class="nutri-card-rate">${gel_per_h} géis/h</div>
    </div>`;

  let tip = '';
  if (temp > 35 && (intens === 'hard' || intens === 'max')) {
    tip = `<div class="tip" style="border-color:rgba(236,58,139,.35);background:rgba(236,58,139,.08);margin-bottom:0"><i class="fa-solid fa-triangle-exclamation" style="color:#ec3a8b"></i><div><strong style="color:var(--text)">Alerta calor extremo + alta intensidade:</strong> Hidrate ANTES de sentir sede. Risco de hiponatremia se beber apenas água sem sódio. Priorize isotônicos. Considere reduzir a intensidade.</div></div>`;
  } else if (temp > 30) {
    tip = `<div class="tip"><i class="fa-solid fa-sun" style="color:#f5d523"></i><div><strong style="color:var(--text)">Calor moderado-alto:</strong> Prefira bebidas com eletrólitos no lugar de água pura. Gel a cada 30 min é ideal para manter glicemia estável.</div></div>`;
  } else if (temp < 15) {
    tip = `<div class="tip"><i class="fa-solid fa-snowflake" style="color:#4e9ef5"></i><div><strong style="color:var(--text)">Tempo frio:</strong> A sensação de sede diminui no frio mas a perda de suor persiste. Beba mesmo sem sentir sede. Carboidratos são ainda mais importantes para manter o calor.</div></div>`;
  } else if (duration_h > 4) {
    tip = `<div class="tip"><i class="fa-solid fa-clock" style="color:var(--teal)"></i><div><strong style="color:var(--text)">Pedal longo (${duration_h.toFixed(1)}h):</strong> Para >3h considere mix de glicose + frutose (2:1) — permite absorção de até 90g carbo/h. Não dependa apenas de géis; inclua comida real (bananas, barras).</div></div>`;
  }
  document.getElementById('nutri-tip').innerHTML = tip;

  const gelInterval = intens === 'max' ? 25 : intens === 'hard' ? 30 : intens === 'mod' ? 40 : 45;
  const totalMin    = Math.round(duration_h * 60);

  let schedHtml = `<thead><tr>
    <th>Horário</th><th>Ação</th><th>Carbo</th><th>Sódio</th><th>Água</th>
  </tr></thead><tbody>`;

  const eventTimes = [];
  for (let t = gelInterval; t <= totalMin; t += gelInterval) eventTimes.push(t);
  if (eventTimes.length === 0) eventTimes.push(totalMin);
  const nEvents = eventTimes.length;

  const waterEach  = Math.round(water_total  / nEvents);
  const sodiumEach = Math.round(sodium_total / nEvents);

  schedHtml += `<tr><td class="td-time">Pré-saída</td>
    <td><span style="color:var(--muted)">Preparação:</span> 350 ml de líquido + 1 gel ou banana (~30 min antes)</td>
    <td class="td-total">${gelCarb}g</td>
    <td class="td-total">${gelSod}mg</td>
    <td class="td-total">350ml</td></tr>`;

  let cumSod = 0, cumWater = 0, gelsUsed = 0;

  eventTimes.forEach((t, i) => {
    const isLast = (i === nEvents - 1);
    const h = Math.floor(t/60), m = t%60;
    const timeStr = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;

    const gelsThisEvent = Math.round((i+1) * gel_total / nEvents) - gelsUsed;
    gelsUsed += gelsThisEvent;
    const evCarb = gelsThisEvent * gelCarb;

    const evWater  = isLast ? (water_total  - cumWater) : waterEach;
    const evSodium = isLast ? (sodium_total - cumSod)   : sodiumEach;

    cumSod   += evSodium;
    cumWater += evWater;

    let action;
    if (gelsThisEvent >= 1) {
      const gelTxt = gelsThisEvent === 1 ? '1 gel' : `${gelsThisEvent} géis`;
      action = `${gelTxt} (${evCarb}g carbo) + ${evWater}ml isotônico`;
    } else {
      action = `Hidratação: ${evWater}ml isotônico (sem gel)`;
    }

    schedHtml += `<tr><td class="td-time">${timeStr}</td>
      <td>${action}</td>
      <td class="td-total">${evCarb}g</td>
      <td class="td-total">${evSodium}mg</td>
      <td class="td-total">${evWater}ml</td></tr>`;
  });

  const schedCarbTotal = gelsUsed * gelCarb;
  schedHtml += `<tr style="background:var(--bg)">
    <td class="td-time">TOTAL</td>
    <td><strong>Soma no percurso (${totalMin}min · ${gelsUsed} géis)</strong></td>
    <td class="td-total">${schedCarbTotal}g</td>
    <td class="td-total">${cumSod}mg</td>
    <td class="td-total">${cumWater}ml</td>
  </tr>`;

  schedHtml += '</tbody>';
  document.getElementById('nutri-schedule').innerHTML = schedHtml;
  document.getElementById('nutri-result').classList.add('show');
}

// ─── TERRAIN GRID (modal) ─────────────────────────────────────────────────────
function populateTerrainGrid() {
  const grid = document.getElementById('terrain-grid-modal');
  const sel  = document.getElementById('psi-terrain');
  if (!grid || !sel) return;
  grid.innerHTML = '';
  Object.entries(TERRAIN_MAP).forEach(([key, t]) => {
    const div = document.createElement('div');
    div.className = 'terrain-card' + (key === sel.value ? ' selected' : '');
    div.id = 'tc-' + key;
    div.innerHTML = `<img src="${t.img}" alt="${t.label}" loading="lazy" onerror="this.style.background='var(--surface2)';this.style.height='100px'">
      <div class="terrain-card-info">
        <div class="terrain-card-name">${t.label}</div>
        <div class="terrain-card-psi">PSI típico: ${t.psiRange}</div>
        <span class="terrain-card-badge" style="background:${t.badgeColor}">${t.badge}</span>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">Fator: ×${t.mult}</div>
      </div>`;
    div.onclick = () => {
      sel.value = key;
      document.querySelectorAll('.terrain-card').forEach(c => c.classList.remove('selected'));
      div.classList.add('selected');
      document.getElementById('terrain-guide').close();
    };
    grid.appendChild(div);
  });
  document.getElementById('terrain-guide').addEventListener('click', function(e){
    if (e.target === this) this.close();
  });
}

// ─── LOAD (chamado pelo router na 1ª visita) ──────────────────────────────────
async function load() {
  populateTerrainGrid();
  populateCassetes();
  populateCoroas();
  if (!_loaded) { _loaded = true; tryLoadDB(); }
}

// ─── EXPOSIÇÃO PÚBLICA ────────────────────────────────────────────────────────
// Funções chamadas via onclick no HTML
window.ferrSwitchTab   = switchTab;
window.ferrCalcPSI     = calcPSI;
window.ferrCalcCO2     = calcCO2;
window.ferrToggleCO2   = toggleCO2;
window.ferrSelectBrand = selectBrand;
window.ferrSelectCat   = selectCat;
window.ferrCasseteChg  = onCasseteChange;
window.ferrCoroaPreset = applyCoroaPreset;
window.ferrGearLine    = renderGearHeadline;
window.ferrCalcGear    = calcGear;
window.ferrCalcRoute   = calcRoute;
window.ferrCalcNutri   = calcNutri;

window.Ferramentas = { load };

})();
