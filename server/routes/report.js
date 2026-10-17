/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/report (relatório de evolução, #95)

   GET /api/report/print[?days=]  → página HTML de impressão (A4, 2 páginas),
       GATEADA por requireAuth. É o que o Chromium do Playwright abre por
       loopback (ver services/report-render.js) e também dá pra abrir no
       navegador, autenticado, pra iterar o layout.

   GET /api/report/pdf[?days=]    → gera e baixa o PDF (Playwright), gateada.

   A página NÃO reimplementa cálculo: ela roda no navegador e reusa os mesmos
   módulos puros do app (js/core/{records,fatigue,weight-stats}.js, js/utils.js)
   inlinados aqui, buscando os mesmos /api/* que o app usa. Mesma fonte de
   verdade → o relatório não diverge da tela. Fontes auto-hospedadas (Bebas
   Neue + Archivo woff2, já em css/fonts/) inlinadas como data: URI — nenhum
   acesso de rede no render.
═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const reportRender = require('../services/report-render');

const ROOT = path.resolve(__dirname, '..', '..');

// ── Assets inlinados (lidos uma vez, cacheados em módulo) ──────────────
function readCached(p) {
  try { return fs.readFileSync(p); } catch (e) {
    throw new Error(`report: asset ausente ${p}: ${e.message}`);
  }
}
let _assets = null;
function assets() {
  if (_assets) return _assets;
  const fontB64 = (f) => readCached(path.join(ROOT, 'css', 'fonts', f)).toString('base64');
  const coreJs = (rel) => readCached(path.join(ROOT, rel)).toString('utf8');
  _assets = {
    bebas: fontB64('bebas-neue-400.woff2'),
    archivo: fontB64('archivo-variable.woff2'),
    core: [
      'js/utils.js',
      'js/core/weight-stats.js',
      'js/core/fatigue.js',
      'js/core/records.js',
    ].map(coreJs).join('\n;\n'),
  };
  return _assets;
}

// Função executada NO NAVEGADOR (Playwright). Serializada via toString() e
// inlinada — por isso não fecha sobre nada do Node. Monta as duas páginas a
// partir dos /api/* e dos módulos core (window.Records/Fatigue/WeightStats/
// Utils). Sempre marca window.__reportReady no fim (mesmo em falha parcial),
// pra o PDF renderizar o que deu em vez de estourar timeout.
function reportRenderClient() {
  const INK = '#0d0f12', SURF = '#14181d', SURF2 = '#1c2128', BORDER = '#2a313a';
  const LIME = '#c6f135', MAG = '#ec3a8b', AMBER = '#e5c024', GREEN = '#22c55e', RED = '#ef4444', MUTED = '#8b95a1';
  const TOKEN_COLOR = { green: GREEN, amber: AMBER, red: RED, muted2: MUTED };
  const esc = window.esc || (s => String(s == null ? '' : s));
  const vírgula = (n, d = 1) => (n == null || !isFinite(n)) ? '—' : Number(n).toFixed(d).replace('.', ',');
  const milhar = (n) => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('pt-BR');

  const params = new URLSearchParams(location.search);
  const daysRaw = params.get('days');
  const days = daysRaw ? Math.max(1, parseInt(daysRaw, 10) || 0) : null;
  const periodoTxt = days ? `Últimos ${days} dias` : 'Período completo';

  // fetch direto (não window.Api): o Api global redireciona pra /login.html em
  // 401, o que destruiria o render no meio. Aqui um erro/401 vira null e a
  // página mostra o estado vazio em vez de navegar embora.
  const get = async (p) => {
    try {
      const r = await fetch('/api' + p, { credentials: 'same-origin' });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  };

  const COMP_LABELS = {
    pneu_dianteiro: 'Pneu dianteiro', pneu_traseiro: 'Pneu traseiro', corrente: 'Corrente',
    pastilha_diant: 'Pastilha dianteira', pastilha_tras: 'Pastilha traseira',
    disco_diant: 'Disco dianteiro', disco_tras: 'Disco traseiro', cassete: 'Cassete',
    cabo_freio: 'Cabo/Óleo de freio', outro: 'Outro',
  };

  function fmtTempo(s) {
    if (s == null || !isFinite(s)) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `0h${String(m).padStart(2, '0')}`;
  }
  function fmtDiaMes(iso) {
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  }

  function card(inner, extra = '') {
    return `<div style="background:${SURF};border:1px solid ${BORDER};border-radius:16px;padding:18px;${extra}">${inner}</div>`;
  }
  function eyebrow(t) {
    return `<div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin-bottom:8px">${esc(t)}</div>`;
  }
  const jersey = `<div style="height:6px;margin:0 -44px;background:repeating-linear-gradient(90deg,${LIME} 0 18px,${MAG} 18px 36px)"></div>`;
  function footer(n) {
    const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    return `<div style="display:flex;justify-content:space-between;gap:16px;white-space:nowrap;font-size:10px;color:${MUTED};margin-top:16px;letter-spacing:.06em"><span>VELOCE LABS · ${esc(hoje)}</span><span>Página ${n} de 2</span></div>`;
  }

  async function build() {
    // A página 2 (heatmap 90d, volume dos últimos 4 meses, streak) precisa de
    // ~120 dias de histórico INDEPENDENTE do filtro da página 1. Buscamos a
    // janela maior entre o filtro pedido e 120 dias; o filtro `days` é aplicado
    // só à contagem de "Passeios" da página 1 (abaixo). Sem isso, escolher "30
    // dias" fazia o heatmap/volume mentirem (dados nunca buscados).
    const fetchDays = Math.max(days || 1825, 120);
    const [profile, weights, unified, health, readinessItems, prs, vo2max, weeklyRec, fitness, bikes] = await Promise.all([
      get('/profile'), get('/weights'), get(`/activities/unified?days=${fetchDays}`),
      get('/garmin/health?days=40'), get('/garmin/training-readiness?days=14'),
      get('/garmin/personal-records'), get('/garmin/vo2max'), get('/activities/weekly-records'),
      get('/garmin/fitness-scores?days=90'), get('/bikes'),
    ]);

    const u = profile || {};
    const ws = Array.isArray(weights) ? weights : [];
    const allItems = (unified && Array.isArray(unified.items)) ? unified.items : [];
    // Página 1 respeita o filtro `days`; página 2 usa o histórico completo.
    const cutoffP1 = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : null;
    const items = cutoffP1 ? allItems.filter(a => a.data && a.data >= cutoffP1) : allItems;
    const totalItems = allItems.length;

    // Manutenções (12 meses) da bike ativa — precisa do id, então busca aqui.
    const bikeList = Array.isArray(bikes) ? bikes : [];
    const activeBike = bikeList.find(b => b.active) || bikeList[0] || null;
    let maint = [];
    if (activeBike) {
      const log = await get(`/bikes/${encodeURIComponent(activeBike.id)}/maintenance-log`);
      if (Array.isArray(log)) {
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 12);
        const cutoffIso = cutoff.toISOString().slice(0, 10);
        maint = log.filter(l => l.data && l.data >= cutoffIso).slice(0, 6);
      }
    }

    buildPage1(u, ws, items, health, readinessItems, prs, vo2max, weeklyRec, fitness);
    buildPage2(u, allItems, totalItems, bikes, maint);
  }

  // ── Página 1: resumo ──────────────────────────────────────────────────
  function buildPage1(u, ws, items, health, readinessItems, prs, vo2max, weeklyRec, fitness) {
    const daily = (window.WeightStats ? window.WeightStats.dailyWeights(ws) : []) || [];
    const pesoAtual = daily.length ? daily[daily.length - 1].peso : (u.pesoAtual != null ? u.pesoAtual : null);
    const altura = u.altura || null;
    const imc = (pesoAtual && altura) ? pesoAtual / Math.pow(altura / 100, 2) : null;
    const meta = u.pesoMeta != null ? u.pesoMeta : null;
    const faltam = (pesoAtual != null && meta != null) ? Math.abs(pesoAtual - meta) : null;

    // KPIs (ocultar tiles sem valor)
    const kpis = [];
    kpis.push(kpiTile('Passeios', `${items.length}`));
    if (pesoAtual != null) kpis.push(kpiTile('Peso atual', `${vírgula(pesoAtual)}<span style="font-size:16px;color:${LIME};margin-left:3px">KG</span>`));
    if (imc != null) kpis.push(kpiTile('IMC', vírgula(imc), imc >= 25 ? MAG : null));
    if (meta != null) kpis.push(kpiTile('Meta', `${milhar(meta)}<span style="font-size:16px;color:${LIME};margin-left:3px">KG</span>`,
      null, faltam != null ? `<div style="font-size:11px;color:${MUTED};margin-top:5px">faltam <span style="color:${MAG};font-weight:700">${vírgula(faltam)} kg</span></div>` : ''));

    // Evolução de peso (SVG)
    const weightCard = daily.length >= 2 ? weightSvg(daily) : '';

    // Insights
    const ins = [];
    const fad = window.Fatigue ? window.Fatigue.fatigueIndex(health || []) : { ok: false };
    if (fad && fad.ok) {
      const c = TOKEN_COLOR[fad.token] || AMBER;
      ins.push(insTile('Fadiga', `${fad.score}<span style="font-size:14px;color:${MUTED};margin-left:3px">/100</span>`, c,
        `<div style="height:5px;background:${SURF2};border-radius:3px;margin-top:10px"><div style="width:${fad.score}%;height:100%;background:${c};border-radius:3px"></div></div>`));
    }
    const rd = window.Fatigue ? window.Fatigue.readiness(readinessItems || []) : { ok: false };
    if (rd && rd.ok && rd.score != null) {
      const c = TOKEN_COLOR[rd.token] || MAG;
      ins.push(insTile('Training readiness', `${rd.score}<span style="font-size:14px;color:${MUTED};margin-left:3px">/100</span>`, c,
        `<div style="font-size:11px;color:${c};font-weight:700;margin-top:8px">${esc(rd.label || '')}</div>`));
    }
    const endur = latestVal(fitness, 'endurance_score');
    if (endur != null) ins.push(insTile('Endurance score', milhar(endur), null, `<div style="font-size:11px;color:${MUTED};margin-top:8px">Garmin</div>`));

    const insGrid = ins.length
      ? `<div style="display:grid;grid-template-columns:repeat(${ins.length},1fr);gap:10px;margin-bottom:14px">${ins.join('')}</div>` : '';

    // Recordes
    const rec = window.Records ? window.Records.personalRecords(prs || [], vo2max, weeklyRec) : { ok: false, linhas: [] };
    const recCard = (rec && rec.ok && rec.linhas.length) ? recordsCard(rec) : '';

    const nome = u.nome ? String(u.nome).split(/\s+/)[0] : 'Ciclista';
    const sub = [esc(nome), altura ? `${esc(String(altura))} cm` : ''].filter(Boolean).join(' · ');
    const periodoData = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');

    document.getElementById('p1').innerHTML = `
      ${jersey}
      <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 0 26px">
        <div style="display:flex;align-items:center;gap:9px"><div style="width:28px;height:28px;border-radius:7px;background:${LIME};color:${INK};display:flex;align-items:center;justify-content:center;font-size:13px"><i class="fa-solid fa-bicycle"></i></div><span style="font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:.04em">VELOCE <span style="color:${LIME}">LABS</span></span></div>
        <span style="white-space:nowrap;font-size:11px;color:${MUTED};letter-spacing:.06em">v${esc(window.__REPORT_VERSION || '')} · gerado automaticamente</span>
      </div>
      <div style="display:inline-flex;align-items:center;gap:9px;white-space:nowrap;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${LIME};margin-bottom:10px"><span style="width:22px;height:2px;background:${LIME};display:block"></span>${esc(periodoTxt)} · ${esc(periodoData)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:76px;line-height:.84">RELATÓRIO DE<br>EVOLUÇÃO</div>
      <div style="font-size:15px;color:#c4ccd4;margin:10px 0 26px">${sub}</div>
      <div style="display:grid;grid-template-columns:repeat(${kpis.length},1fr);gap:10px;margin-bottom:14px">${kpis.join('')}</div>
      ${weightCard}
      ${insGrid}
      ${recCard}
      ${footer(1)}`;
  }

  function kpiTile(label, valueHtml, color, extraHtml = '') {
    return `<div style="background:${SURF};border:1px solid ${BORDER};border-radius:14px;padding:14px">${eyebrow(label)}<div style="font-family:'Bebas Neue',sans-serif;font-size:42px;line-height:.82${color ? `;color:${color}` : ''}">${valueHtml}</div>${extraHtml}</div>`;
  }
  function insTile(label, valueHtml, color, extraHtml = '') {
    return `<div style="background:${SURF};border:1px solid ${BORDER};border-radius:14px;padding:14px">${eyebrow(label)}<div style="font-family:'Bebas Neue',sans-serif;font-size:36px;line-height:.82${color ? `;color:${color}` : ''}">${valueHtml}</div>${extraHtml}</div>`;
  }

  function weightSvg(daily) {
    const pesos = daily.map(d => d.peso);
    const min = Math.min(...pesos), max = Math.max(...pesos);
    const lo = min - 0.5, hi = max + 0.3;
    const span = (hi - lo) || 1;
    const n = daily.length;
    const y = (w) => (8 + (hi - w) / span * 84).toFixed(1);
    const pts = daily.map((d, i) => `${(i / Math.max(1, n - 1) * 300).toFixed(1)},${y(d.peso)}`).join(' ');
    const area = `0,100 ${pts} 300,100`;
    const first = fmtDiaMes(daily[0].data), last = fmtDiaMes(daily[n - 1].data);
    return card(`
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px"><span style="white-space:nowrap;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Evolução de peso · ${n} pesagens</span><span style="font-size:11px;color:${MUTED}">mín <strong style="color:#eef2f4">${vírgula(min)}</strong> · máx <strong style="color:#eef2f4">${vírgula(max)}</strong></span></div>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" style="width:100%;height:150px;display:block">
        <line x1="0" y1="20" x2="300" y2="20" stroke="${BORDER}" stroke-width="1" vector-effect="non-scaling-stroke"></line>
        <line x1="0" y1="44" x2="300" y2="44" stroke="${BORDER}" stroke-width="1" vector-effect="non-scaling-stroke"></line>
        <line x1="0" y1="68" x2="300" y2="68" stroke="${BORDER}" stroke-width="1" vector-effect="non-scaling-stroke"></line>
        <polygon points="${area}" style="fill:rgba(198,241,53,.10)"></polygon>
        <polyline points="${pts}" fill="none" style="stroke:${LIME}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:${MUTED};margin-top:6px"><span>${esc(first)}</span><span>${esc(last)}</span></div>`,
      'margin-bottom:14px');
  }

  function recordsCard(rec) {
    const tiles = rec.linhas.filter(l => !l.sintetica).slice(0, 3);
    const lista = rec.linhas.filter(l => l.sintetica).concat(rec.linhas.filter(l => !l.sintetica).slice(3));
    const tilesHtml = tiles.map(r => `<div style="background:${SURF2};border-radius:12px;padding:12px;border-top:3px solid ${LIME}">${eyebrowSmall(r.label)}<div style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:.85">${esc(r.valor)}</div><div style="font-size:10.5px;color:${MUTED};margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.meta || '')}</div></div>`).join('');
    const listaHtml = lista.map(r => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:#c4ccd4">${esc(r.label)}</span><strong>${esc(r.valor)}</strong></div>`).join('');
    return card(`
      ${eyebrow('Recordes pessoais · Garmin')}
      ${tiles.length ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:4px 0 14px">${tilesHtml}</div>` : ''}
      ${lista.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px">${listaHtml}</div>` : ''}`,
      'flex:1');
  }
  function eyebrowSmall(t) {
    return `<div style="font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:6px">${esc(t)}</div>`;
  }
  function latestVal(rows, key) {
    if (!Array.isArray(rows)) return null;
    for (const r of rows) { if (r && r[key] != null) return r[key]; }
    return null;
  }

  // ── Página 2: atividade e equipamento ──────────────────────────────────
  function buildPage2(u, items, totalItems, bikes, maint) {
    const nome = u.nome ? String(u.nome).split(/\s+/)[0] : 'Ciclista';

    // Mapa 90 dias — km por dia das atividades
    const kmByDay = {};
    items.forEach(a => { if (a.data && a.distanciaKm != null) kmByDay[a.data] = (kmByDay[a.data] || 0) + a.distanciaKm; });
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const heatCells = [];
    let ativos = 0;
    const activeDates = [];
    for (let i = 90; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const km = kmByDay[iso] || 0;
      if (km > 0) { ativos++; activeDates.push(iso); }
      const lv = km === 0 ? 0 : km < 15 ? 1 : km < 35 ? 2 : 3;
      const op = [1, .35, .65, 1][lv];
      heatCells.push(`<span style="background:${lv ? LIME : SURF2};opacity:${op};border-radius:2px"></span>`);
    }
    const pctAtivos = Math.round((ativos / 91) * 100);
    const streak = window.Utils ? window.Utils.calcTrainingStreak(activeDates) : { current: 0, record: 0 };

    // Volume mensal (últimos 4 meses)
    const monthKm = {};
    items.forEach(a => { if (a.data && a.distanciaKm != null) { const k = a.data.slice(0, 7); monthKm[k] = (monthKm[k] || 0) + a.distanciaKm; } });
    const months = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(), km: Math.round(monthKm[key] || 0) });
    }
    const maxMonth = Math.max(1, ...months.map(m => m.km));
    const monthsHtml = months.map(m => {
      const h = Math.max(4, m.km / maxMonth * 100).toFixed(0);
      const col = (m.km === maxMonth && m.km > 0) ? LIME : '#3a4350';
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end"><span style="font-family:'Bebas Neue',sans-serif;font-size:16px">${m.km}</span><div style="width:100%;height:${h}%;background:${col};border-radius:4px 4px 0 0"></div><span style="font-size:10px;color:${MUTED};letter-spacing:.08em">${m.label}</span></div>`;
    }).join('');

    // Histórico (14 mais recentes)
    const ordered = [...items].sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const recent = ordered.slice(0, 14);
    const maxKm = Math.max(1, ...recent.map(a => a.distanciaKm || 0));
    const COLS = '52px minmax(0,1fr) 110px 48px 56px 36px';
    const actsHtml = recent.map(a => {
      const fc = a.fcMedia;
      const fcStyle = (fc != null && fc >= 150) ? `text-align:right;color:${MAG};font-weight:800` : 'text-align:right';
      const w = ((a.distanciaKm || 0) / maxKm * 100).toFixed(0);
      return `<div style="display:grid;grid-template-columns:${COLS};gap:10px;align-items:center;font-size:12px;padding:6px 0;border-bottom:1px solid ${SURF2}">
        <span style="color:${MUTED}">${esc(fmtDiaMes(a.data))}</span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.nome || '—')}</span>
        <span style="display:flex;align-items:center;gap:8px;color:${LIME}"><span style="flex:1;height:5px;background:${SURF2};border-radius:3px;overflow:hidden"><span style="display:block;width:${w}%;height:100%;background:currentColor;border-radius:3px"></span></span><strong style="color:#eef2f4;width:32px;text-align:right">${vírgula(a.distanciaKm)}</strong></span>
        <span>${esc(fmtTempo(a.tempoMovS))}</span>
        <span style="text-align:right;color:${GREEN}">${a.elevacaoM != null ? milhar(a.elevacaoM) + ' m' : '—'}</span>
        <span style="${fcStyle}">${fc != null ? Math.round(fc) : '—'}</span>
      </div>`;
    }).join('');

    document.getElementById('p2').innerHTML = `
      ${jersey}
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 0 20px"><span style="white-space:nowrap;font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:.03em">ATIVIDADE & EQUIPAMENTO</span><span style="font-size:11px;color:${MUTED}">${esc(nome)} · ${esc(periodoTxt.toLowerCase())}</span></div>
      <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:10px;margin-bottom:14px">
        ${card(`${eyebrow('Últimos 90 dias')}<div style="display:grid;grid-template-rows:repeat(7,13px);grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;margin-bottom:10px">${heatCells.join('')}</div><div style="display:flex;gap:16px;font-size:11.5px;color:#c4ccd4"><span><strong style="color:${LIME};font-family:'Bebas Neue',sans-serif;font-size:20px">${pctAtivos}%</strong> dias ativos</span><span><strong style="font-family:'Bebas Neue',sans-serif;font-size:20px">${streak.current}</strong> sem. seguidas</span><span><strong style="font-family:'Bebas Neue',sans-serif;font-size:20px">${streak.record}</strong> recorde</span></div>`)}
        ${card(`${eyebrow('Volume mensal · km')}<div style="flex:1;display:flex;align-items:flex-end;gap:12px;min-height:110px">${monthsHtml}</div>`, 'display:flex;flex-direction:column')}
      </div>
      ${card(`<div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Histórico de atividades</span><span style="font-size:10.5px;color:${MUTED}">${recent.length} mais recentes de ${totalItems}</span></div><div style="display:grid;grid-template-columns:${COLS};gap:10px;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};padding:0 0 7px;border-bottom:1px solid ${BORDER}"><span>Data</span><span>Atividade</span><span>Km</span><span>Tempo</span><span style="text-align:right">Elev.</span><span style="text-align:right">FC</span></div>${actsHtml || `<div style="padding:12px 0;color:${MUTED};font-size:12px">Sem atividades no período.</div>`}`, 'margin-bottom:14px')}
      ${bikeCard(bikes, maint)}
      ${footer(2)}`;
  }

  function bikeCard(bikes, maint) {
    const list = Array.isArray(bikes) ? bikes : [];
    if (!list.length) return card(`<div style="color:${MUTED};font-size:12px">Nenhuma bicicleta cadastrada.</div>`, 'flex:1');
    const bike = list.find(b => b.active) || list[0];
    const comps = Array.isArray(bike.components) ? bike.components : [];

    const compRows = comps.map(c => {
      const nome = COMP_LABELS[c.tipo] || (c.marca || c.modelo ? `${COMP_LABELS[c.tipo] || c.tipo} ${[c.marca, c.modelo].filter(Boolean).join(' ')}`.trim() : c.tipo);
      const pct = (c.vidaUtilKm && c.vidaUtilKm > 0 && c.kmDesgastado != null) ? Math.round(c.kmDesgastado / c.vidaUtilKm * 100) : null;
      const col = pct == null ? SURF2 : pct >= 100 ? RED : pct >= 80 ? AMBER : GREEN;
      const pstyle = `text-align:right;font-size:10.5px;font-weight:800${pct != null && pct >= 100 ? `;color:${RED}` : ''}`;
      const ptxt = pct == null ? '—' : pct >= 100 ? 'VENC.' : pct + '%';
      return `<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 44px;gap:10px;align-items:center;font-size:11.5px"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nome)}</span><span style="height:6px;background:${SURF2};border-radius:3px;overflow:hidden"><span style="display:block;width:${pct == null ? 0 : Math.min(100, pct)}%;height:100%;background:${col};border-radius:3px"></span></span><span style="${pstyle}">${ptxt}</span></div>`;
    }).join('');

    const vencidos = comps.filter(c => c.vidaUtilKm > 0 && c.kmDesgastado != null && c.kmDesgastado / c.vidaUtilKm >= 1);
    const alerta = vencidos.length
      ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:12px;padding:12px;font-size:12px;color:#eef2f4;display:flex;gap:10px;align-items:flex-start"><i class="fa-solid fa-triangle-exclamation" style="color:${RED};margin-top:2px"></i><span><strong>${vencidos.length} componente${vencidos.length > 1 ? 's' : ''} vencido${vencidos.length > 1 ? 's' : ''}:</strong> ${esc(vencidos.map(c => COMP_LABELS[c.tipo] || c.tipo).join(', '))}.</span></div>`
      : '';

    const mlist = Array.isArray(maint) ? maint : [];
    const maintHtml = mlist.length
      ? `<div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Manutenções · 12 meses</div>` +
        mlist.map(m => {
          const quando = fmtDiaMes(String(m.data).slice(0, 10));
          const oque = COMP_LABELS[m.componentTipo] || m.componentTipo || m.tipoEvento || 'Serviço';
          return `<div style="display:flex;justify-content:space-between;gap:10px;font-size:11.5px;padding-bottom:5px;border-bottom:1px solid ${SURF2}"><span style="color:${MUTED}">${esc(quando)}</span><span>${esc(oque)}</span></div>`;
        }).join('')
      : '';

    const others = list.filter(b => b !== bike);
    const othersHtml = others.map(b => `<div style="font-size:11px;color:${MUTED};display:flex;align-items:center;gap:8px;white-space:nowrap"><i class="fa-solid fa-bicycle"></i>${esc(b.nome)}${b.tipo ? ' · ' + esc(b.tipo) : ''}${(b.components && b.components.length) ? '' : ' · sem componentes'}</div>`).join('');

    return card(`
      <div style="height:5px;background:repeating-linear-gradient(90deg,${LIME} 0 14px,${MAG} 14px 28px);margin:-18px -18px 16px"></div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:18px">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><i class="fa-solid fa-bicycle" style="color:${LIME}"></i><span style="font-family:'Bebas Neue',sans-serif;font-size:24px">${esc((bike.nome || '').toUpperCase())}</span><span style="font-size:10.5px;color:${MUTED}">${bike.tipo ? esc(bike.tipo) + ' · ' : ''}${bike.kmTotal != null ? milhar(bike.kmTotal) + ' km' : ''}</span></div>
          <div style="display:flex;flex-direction:column;gap:8px">${compRows || `<span style="font-size:11.5px;color:${MUTED}">Sem componentes cadastrados.</span>`}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${alerta}
          ${maintHtml}
          ${othersHtml ? `<div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin-top:auto">Outras bikes</div>${othersHtml}` : ''}
        </div>
      </div>`, 'flex:1;overflow:hidden');
  }

  build()
    .catch(err => { try { console.error('[report] falha ao montar', err); } catch (_) {} })
    .finally(() => { window.__reportReady = true; });
}

// Função NO NAVEGADOR — monta o card resumido (#resumo) que vira o PNG do
// Telegram. Reusa o mesmo layout do email-relatorio.html (tokens/fontes do
// PDF, sem os artefatos de e-mail) e os mesmos módulos core. #95 Fase 2.
function reportResumoClient() {
  const INK = '#0d0f12', SURF = '#14181d', SURF2 = '#1c2128', BORDER = '#2a313a';
  const LIME = '#c6f135', MAG = '#ec3a8b', AMBER = '#e5c024', GREEN = '#22c55e', RED = '#ef4444', MUTED = '#8b95a1';
  const TOKEN_COLOR = { green: GREEN, amber: AMBER, red: RED, muted2: MUTED };
  const esc = window.esc || (s => String(s == null ? '' : s));
  const vírgula = (n, d = 1) => (n == null || !isFinite(n)) ? '—' : Number(n).toFixed(d).replace('.', ',');
  // fetch direto (não window.Api): o Api global redireciona pra /login.html em
  // 401, o que destruiria o render no meio. Aqui um erro/401 vira null e a
  // página mostra o estado vazio em vez de navegar embora.
  const get = async (p) => {
    try {
      const r = await fetch('/api' + p, { credentials: 'same-origin' });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  };
  const COMP_LABELS = { pastilha_diant: 'Pastilha dianteira', pastilha_tras: 'Pastilha traseira', corrente: 'Corrente', cassete: 'Cassete', pneu_dianteiro: 'Pneu dianteiro', pneu_traseiro: 'Pneu traseiro', disco_diant: 'Disco dianteiro', disco_tras: 'Disco traseiro', cabo_freio: 'Cabo/Óleo de freio', outro: 'Outro' };

  const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const paraISO = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  // #106/#107: relatório de FECHAMENTO do mês anterior (o scheduler dispara dia
  // 1º). Janela = [1º dia, último dia] do mês passado, em horário LOCAL. Dia 0
  // deste mês = último dia do mês anterior.
  const _ultimoMesAnt = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
  const _primeiroMesAnt = new Date(_ultimoMesAnt.getFullYear(), _ultimoMesAnt.getMonth(), 1);
  const janelaIni = paraISO(_primeiroMesAnt), janelaFim = paraISO(_ultimoMesAnt);
  const mesNome = NOMES_MESES[_ultimoMesAnt.getMonth()];
  // Busca com folga (cobre o mês anterior mesmo gerando no fim do mês atual) e
  // filtra a janela no cliente — o endpoint só aceita "últimos N dias".
  const fetchDays = 70;

  async function build() {
    const [profile, unified, health, readinessItems, bikes, planResp, vo2maxResp, zoneResp] = await Promise.all([
      get('/profile'), get(`/activities/unified?days=${fetchDays}`),
      get('/garmin/health?days=70'), get('/garmin/training-readiness?days=14'), get('/bikes'),
      get('/weekly-training-plan'), get('/garmin/vo2max'),
      get(`/garmin/zone-distribution-by-activity?days=${fetchDays}`),
    ]);
    const u = profile || {};
    // todosItems: histórico completo da janela de busca (p/ aquecer o EMA do
    // CTL/ATL); items: só o mês fechado (acumulados, aderência, maior pedal).
    const todosItems = (unified && Array.isArray(unified.items)) ? unified.items : [];
    const noMes = (d) => d && d >= janelaIni && d <= janelaFim;
    const items = todosItems.filter(a => noMes(a.data));
    // #108: acumulados do mês (distância, tempo, elevação; nº = items.length).
    const acumulados = items.reduce((s, a) => ({
      km:    s.km    + (a.distanciaKm || 0),
      horas: s.horas + (a.tempoMovS || 0) / 3600,
      elev:  s.elev  + (a.elevacaoM || 0),
    }), { km: 0, horas: 0, elev: 0 });
    const diasMes = _ultimoMesAnt.getDate();

    // #109 — dados do ciclista. CTL/ATL máx do mês: série EMA até o fim do mês,
    // pico restrito aos dias do mês. VO2máx: último conhecido (a Garmin deste
    // usuário não registra valor recente). HRV noturno: média do mês.
    let ctlMax = null, atlMax = null;
    if (u.fcMax && window.Metrics) {
      const { ctlSerie, atlSerie } = window.Metrics.calcTSBMetrics(todosItems, u.fcMax, _ultimoMesAnt);
      const tail = Math.min(diasMes, ctlSerie.length);
      if (tail > 0) {
        ctlMax = Math.round(Math.max(...ctlSerie.slice(-tail)));
        atlMax = Math.round(Math.max(...atlSerie.slice(-tail)));
      }
    }
    const hrvVals = (health || []).filter(h => noMes(h.data) && h.hrv_noite_avg != null && isFinite(h.hrv_noite_avg)).map(h => h.hrv_noite_avg);
    const hrvMedia = hrvVals.length ? Math.round(hrvVals.reduce((s, v) => s + v, 0) / hrvVals.length) : null;
    const vo2 = (vo2maxResp && vo2maxResp.latest && vo2maxResp.latest.value != null) ? Math.round(vo2maxResp.latest.value) : null;

    // #111 — aderência do mês: planejado semanal × (dias do mês / 7) vs. realizado.
    const planDias = (planResp && planResp.ok && planResp.payload && planResp.payload.dias) || [];
    const planWeeklyMin = planDias.reduce((s, d) => s + (d && !d.descanso ? (+d.duracaoMin || 0) : 0), 0);
    const realizadoMesMin = items.reduce((s, a) => s + (a.tempoMovS || 0) / 60, 0);
    const aderFrac = window.WeightStats ? window.WeightStats.adherence(planWeeklyMin, realizadoMesMin, diasMes / 7) : null;
    const aderPct = aderFrac != null ? Math.round(aderFrac * 100) : null;

    // #110 — distribuição por zona de FC acumulada no mês (rosca).
    const zonaSeg = [0, 0, 0, 0, 0];
    ((zoneResp && Array.isArray(zoneResp.items)) ? zoneResp.items : [])
      .filter(z => noMes(z.data))
      .forEach(z => (z.segundosPorZona || []).forEach((s, i) => { zonaSeg[i] += (s || 0); }));
    const zonaTotal = zonaSeg.reduce((s, v) => s + v, 0);

    const nome = u.nome ? String(u.nome).split(/\s+/)[0] : 'Ciclista';
    const pesoAtual = u.pesoAtual != null ? u.pesoAtual : null;
    const meta = u.pesoMeta != null ? u.pesoMeta : null;
    const faltam = (pesoAtual != null && meta != null) ? Math.abs(pesoAtual - meta) : null;
    const maiorPedal = items.reduce((mx, a) => Math.max(mx, a.distanciaKm || 0), 0);

    const kpi = (label, valueHtml, extra = '') =>
      `<td valign="top" style="width:33%;padding:16px;border-right:1px solid ${BORDER}"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:40px;line-height:1;margin-top:4px">${valueHtml}</div>${extra}</td>`;

    const fad = window.Fatigue ? window.Fatigue.fatigueIndex(health || []) : { ok: false };
    const rd = window.Fatigue ? window.Fatigue.readiness(readinessItems || []) : { ok: false };
    const bar = (label, score, color) =>
      `<tr><td style="padding:6px 0;font-size:13px;color:#c4ccd4;width:120px">${esc(label)}</td><td style="padding:6px 10px"><div style="height:6px;background:${SURF2};border-radius:3px;overflow:hidden"><div style="width:${Math.max(0, Math.min(100, score))}%;height:100%;background:${color}"></div></div></td><td align="right" style="padding:6px 0;font-size:13px;font-weight:700;color:${color};width:56px">${score}/100</td></tr>`;
    const bars = [];
    if (fad && fad.ok) bars.push(bar('Fadiga', fad.score, TOKEN_COLOR[fad.token] || AMBER));
    if (rd && rd.ok && rd.score != null) bars.push(bar('Readiness', rd.score, TOKEN_COLOR[rd.token] || MAG));

    const list = Array.isArray(bikes) ? bikes : [];
    const bike = list.find(b => b.active) || list[0];
    let alerta = '';
    if (bike && Array.isArray(bike.components)) {
      const venc = bike.components.filter(c => c.vidaUtilKm > 0 && c.kmDesgastado != null && c.kmDesgastado / c.vidaUtilKm >= 1);
      if (venc.length) alerta = `<div style="margin:0 36px 8px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:12px;padding:14px;font-size:13px;color:#eef2f4"><strong style="color:${RED}">${esc(bike.nome)} · ${venc.length} componente${venc.length > 1 ? 's' : ''} vencido${venc.length > 1 ? 's' : ''}.</strong> ${esc(venc.map(c => COMP_LABELS[c.tipo] || c.tipo).join(', '))}.</div>`;
    }

    // #109 — bloco "Dados do ciclista": só os tiles que têm valor (flex, para
    // lidar com nº variável de métricas presentes).
    const dadoTile = (label, val, un) => val == null ? '' :
      `<div style="flex:1;min-width:0;padding:12px 8px;text-align:center"><div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;margin-top:3px">${val}${un ? `<span style="font-size:12px;color:${LIME};margin-left:2px">${un}</span>` : ''}</div></div>`;
    const dadosTiles = [dadoTile('Carga CTL', ctlMax, ''), dadoTile('Fadiga ATL', atlMax, ''), dadoTile('VO₂máx', vo2, ''), dadoTile('HRV noturno', hrvMedia, '')].filter(Boolean);
    const dadosBloco = dadosTiles.length
      ? `<div style="margin:12px 36px 0"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding:0 0 6px">Dados do ciclista</div><div style="display:flex;background:${SURF};border:1px solid ${BORDER};border-radius:12px">${dadosTiles.join('')}</div></div>`
      : '';

    // #110 — rosca (donut via conic-gradient) da distribuição por zona de FC.
    const ZCORES = ['#60a5fa', '#22c55e', '#eab308', '#f97316', '#ef4444']; // Z1..Z5
    let _acc = 0; const stops = [];
    zonaSeg.forEach((s, i) => { const p = zonaTotal > 0 ? s / zonaTotal * 100 : 0; stops.push(`${ZCORES[i]} ${_acc.toFixed(2)}% ${(_acc + p).toFixed(2)}%`); _acc += p; });
    const zonaLegenda = zonaSeg.map((s, i) => {
      const p = zonaTotal > 0 ? Math.round(s / zonaTotal * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#c4ccd4;margin:3px 0"><span style="width:10px;height:10px;border-radius:2px;background:${ZCORES[i]};display:inline-block"></span>Z${i + 1} · ${p}% · ${vírgula(s / 3600)}h</div>`;
    }).join('');
    const roscaBloco = zonaTotal > 0
      ? `<div style="margin:12px 36px 0;background:${SURF};border:1px solid ${BORDER};border-radius:12px;padding:14px 16px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding-bottom:10px">Tempo por zona de FC · ${esc(mesNome)}</div><div style="display:flex;align-items:center;gap:20px"><div style="width:110px;height:110px;border-radius:50%;background:conic-gradient(${stops.join(',')});flex-shrink:0;position:relative"><div style="position:absolute;top:22px;left:22px;right:22px;bottom:22px;background:${SURF};border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:20px">${vírgula(zonaTotal / 3600)}h</div></div><div style="flex:1">${zonaLegenda}</div></div></div>`
      : '';

    // #111 — aderência ao plano no mês (barra + %).
    const aderCor = aderPct == null ? MUTED : (aderPct >= 80 ? GREEN : (aderPct >= 50 ? AMBER : RED));
    const aderBloco = aderPct != null
      ? `<div style="margin:12px 36px 0;background:${SURF};border:1px solid ${BORDER};border-radius:12px;padding:12px 16px"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">Aderência ao plano</span><span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:${aderCor}">${aderPct}%</span></div><div style="height:6px;background:${SURF2};border-radius:3px;overflow:hidden;margin-top:8px"><div style="width:${Math.min(100, aderPct)}%;height:100%;background:${aderCor}"></div></div></div>`
      : '';

    const dataTxt = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');

    document.getElementById('resumo').innerHTML = `
      <div style="height:6px;background:repeating-linear-gradient(90deg,${LIME} 0 18px,${MAG} 18px 36px)"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 36px 0"><span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.04em">VELOCE <span style="color:${LIME}">LABS</span></span><span style="font-size:11px;color:${MUTED}">${esc(dataTxt)}</span></div>
      <div style="padding:26px 36px 4px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${LIME}">Fechamento de ${esc(mesNome)}</div>
      <div style="padding:0 36px;font-family:'Bebas Neue',sans-serif;font-size:44px;line-height:.9">SEU RELATÓRIO DE EVOLUÇÃO</div>
      <div style="padding:10px 36px 22px;font-size:14px;line-height:1.5;color:#c4ccd4">Olá, ${esc(nome)}. Aqui está o fechamento de ${esc(mesNome)}. O relatório completo está no app.</div>
      <div style="margin:0 36px 12px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding:0 0 6px">Acumulados de ${esc(mesNome)}</div><table width="100%" cellpadding="0" cellspacing="0" style="background:${SURF};border:1px solid ${BORDER};border-radius:12px;border-collapse:separate"><tr>
        ${kpi('Distância', acumulados.km > 0 ? `${vírgula(acumulados.km, 0)}<span style="font-size:15px;color:${LIME};margin-left:3px">KM</span>` : '—')}
        ${kpi('Tempo', acumulados.horas > 0 ? `${vírgula(acumulados.horas)}<span style="font-size:15px;color:${LIME};margin-left:3px">H</span>` : '—')}
        <td valign="top" style="width:34%;padding:16px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Elevação</div><div style="font-family:'Bebas Neue',sans-serif;font-size:40px;line-height:1;margin-top:4px">${acumulados.elev > 0 ? `${vírgula(acumulados.elev, 0)}<span style="font-size:15px;color:${LIME};margin-left:3px">M</span>` : '—'}</div></td>
      </tr></table></div>
      <div style="margin:0 36px"><table width="100%" cellpadding="0" cellspacing="0" style="background:${SURF};border:1px solid ${BORDER};border-radius:12px;border-collapse:separate"><tr>
        ${kpi('Passeios', String(items.length))}
        ${kpi('Peso atual', pesoAtual != null ? `${vírgula(pesoAtual)}<span style="font-size:15px;color:${LIME};margin-left:3px">KG</span>` : '—', meta != null && faltam != null ? `<div style="font-size:11px;color:${MUTED};margin-top:4px">meta ${esc(String(meta))} kg · faltam <span style="color:${MAG};font-weight:700">${vírgula(faltam)}</span></div>` : '')}
        <td valign="top" style="width:34%;padding:16px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Maior pedal</div><div style="font-family:'Bebas Neue',sans-serif;font-size:40px;line-height:1;margin-top:4px">${maiorPedal > 0 ? `${vírgula(maiorPedal)}<span style="font-size:15px;color:${LIME};margin-left:3px">KM</span>` : '—'}</div></td>
      </tr></table></div>
      ${dadosBloco}
      ${roscaBloco}
      ${aderBloco}
      ${bars.length ? `<div style="margin:12px 36px 0;background:${SURF};border:1px solid ${BORDER};border-radius:12px;padding:8px 16px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding:8px 0 2px">Como você está</div><table width="100%" cellpadding="0" cellspacing="0">${bars.join('')}</table></div>` : ''}
      <div style="height:14px"></div>
      ${alerta}
      <div style="padding:14px 36px 22px;border-top:1px solid ${BORDER};font-size:11px;color:${MUTED}">Veloce Labs · relatório mensal automático</div>`;
  }

  build()
    .catch(err => { try { console.error('[resumo] falha', err); } catch (_) {} })
    .finally(() => { window.__reportReady = true; });
}

// ── HTML da página de impressão (PDF completo) ─────────────────────────
function printHtml(version) {
  const a = assets();
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<style>
  @font-face{font-family:'Bebas Neue';src:url(data:font/woff2;base64,${a.bebas}) format('woff2');font-weight:400;font-display:block}
  @font-face{font-family:'Archivo';src:url(data:font/woff2;base64,${a.archivo}) format('woff2');font-weight:100 900;font-display:block}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  @page{size:A4;margin:0}
  html,body{background:#0d0f12;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Archivo',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .page{width:210mm;height:297mm;overflow:hidden;position:relative;background:#0d0f12;color:#eef2f4;padding:0 44px 40px;display:flex;flex-direction:column;break-after:page}
  .page:last-child{break-after:auto}
  /* Ícones FA viram caixinhas sem a webfont; usamos glifos unicode como fallback leve */
  .fa-bicycle::before{content:"\\1F6B2"}
  .fa-triangle-exclamation::before{content:"\\26A0"}
  i[class^="fa-"]{font-style:normal}
</style>
</head><body>
  <section class="page" id="p1"></section>
  <section class="page" id="p2"></section>
  <script>window.__REPORT_VERSION=${JSON.stringify(version)};</script>
  <script>${a.core}</script>
  <script>(${reportRenderClient.toString()})();</script>
</body></html>`;
}

// ── HTML do resumo (PNG do Telegram) ───────────────────────────────────
function resumoHtml() {
  const a = assets();
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<style>
  @font-face{font-family:'Bebas Neue';src:url(data:font/woff2;base64,${a.bebas}) format('woff2');font-weight:400;font-display:block}
  @font-face{font-family:'Archivo';src:url(data:font/woff2;base64,${a.archivo}) format('woff2');font-weight:100 900;font-display:block}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#08090b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Archivo',system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:20px}
  #resumo{width:600px;background:#0d0f12;color:#eef2f4;border:1px solid #2a313a;border-radius:4px;overflow:hidden}
</style>
</head><body>
  <div id="resumo"></div>
  <script>${a.core}</script>
  <script>(${reportResumoClient.toString()})();</script>
</body></html>`;
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/report/print', async (req, reply) => {
    const version = require('../package.json').version;
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    return printHtml(version);
  });

  fastify.get('/api/report/print-resumo', async (req, reply) => {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    return resumoHtml();
  });

  // Rate-limit: cada chamada sobe um contexto Chromium + page.pdf() (caro em
  // CPU/memória). Mesmo autenticado/single-user, um cookie vazado ou loop no
  // front poderia empilhar renders e exaurir memória (self-DoS). Mesmo padrão
  // opt-in do POST /api/user/avatar. NÃO limitamos /print e /print-resumo: o
  // próprio Playwright as busca por loopback durante o render.
  fastify.get('/api/report/pdf', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const days = req.query && req.query.days ? String(req.query.days).replace(/[^0-9]/g, '') : '';
    let pdf;
    try {
      pdf = await reportRender.renderPdf({ days });
    } catch (e) {
      fastify.log.error({ err: e }, '[report] falha ao gerar PDF');
      return reply.code(500).send({ error: 'Falha ao gerar o relatório PDF' });
    }
    const hoje = new Date().toISOString().slice(0, 10);
    const periodo = days ? `${days}d` : 'completo';
    reply
      .type('application/pdf')
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="veloce-labs-relatorio-${periodo}-${hoje}.pdf"`);
    return pdf;
  });
}

module.exports = routes;
