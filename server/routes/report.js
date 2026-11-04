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
const { lerCacheMensal, gerarEArmazenarMensal } = require('../services/monthly-analysis');

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
      'js/core/metrics.js',
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

  // Rótulos de componente agora vêm de window.BikeComp (js/utils.js), que o
  // assets().core injeta antes deste script — ver bikeCard() (#142).

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
    // /component-types entra aqui (e não numa chamada serial) porque é só
    // mais uma promessa no mesmo lote: sem ela, componentes "Outro (novo)"
    // saem rotulados com a chave crua `custom:<id>` (#142).
    const [profile, weights, unified, health, readinessItems, prs, vo2max, weeklyRec, fitness, bikes, tiposCustom] = await Promise.all([
      get('/profile'), get('/weights'), get(`/activities/unified?days=${fetchDays}`),
      get('/garmin/health?days=40'), get('/garmin/training-readiness?days=14'),
      get('/garmin/personal-records'), get('/garmin/vo2max'), get('/activities/weekly-records'),
      get('/garmin/fitness-scores?days=90'), get('/bikes'), get('/component-types'),
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
    buildPage2(u, allItems, totalItems, bikes, maint, fetchDays, tiposCustom);
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
  // `janelaDias` é o fetchDays real (≥120, ou 1825 em "Tudo"). Entra só no
  // rótulo do histórico: com 30d/90d o total NÃO é o total absoluto de
  // atividades, e dizer "de N" seco fazia o número mentir (Issue #132).
  function buildPage2(u, items, totalItems, bikes, maint, janelaDias, tiposCustom) {
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
      ${card(`<div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Histórico de atividades</span><span style="font-size:10.5px;color:${MUTED}">${janelaDias && janelaDias < 1825 ? `${recent.length} mais recentes · ${totalItems} nos últimos ${janelaDias} dias` : `${recent.length} mais recentes de ${totalItems}`}</span></div><div style="display:grid;grid-template-columns:${COLS};gap:10px;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};padding:0 0 7px;border-bottom:1px solid ${BORDER}"><span>Data</span><span>Atividade</span><span>Km</span><span>Tempo</span><span style="text-align:right">Elev.</span><span style="text-align:right">FC</span></div>${actsHtml || `<div style="padding:12px 0;color:${MUTED};font-size:12px">Sem atividades no período.</div>`}`, 'margin-bottom:14px')}
      ${bikeCard(bikes, maint, tiposCustom)}
      ${footer(2)}`;
  }

  function bikeCard(bikes, maint, tiposCustom) {
    // Rótulo e desgaste vêm de window.BikeComp (js/utils.js, injetado pelo
    // assets().core antes deste script). Antes cada cliente de relatório
    // tinha a sua cópia, e foi por isso que a correção do #134 não chegou
    // aqui (#142).
    const rotulo = (tipo) => window.BikeComp.label(tipo, tiposCustom);
    const razaoUso = (c) => window.BikeComp.razaoUso(c);
    const list = Array.isArray(bikes) ? bikes : [];
    if (!list.length) return card(`<div style="color:${MUTED};font-size:12px">Nenhuma bicicleta cadastrada.</div>`, 'flex:1');
    const bike = list.find(b => b.active) || list[0];
    const comps = Array.isArray(bike.components) ? bike.components : [];

    const compRows = comps.map(c => {
      // Só o nome do tipo: o antigo branch de marca/modelo era inalcançável
      // para tipo conhecido (o primeiro `||` já retornava), então só teria
      // efeito no caso custom — onde produzia "custom:ctype_… Shimano XT".
      const nome = rotulo(c.tipo);
      // Math.floor (não round) faz `pct >= 100` coincidir exatamente com o
      // `razão >= 1` do banner abaixo: com round, 0,996 vira 100% e a barra
      // marcava VENC. num componente que o banner não contava (#142).
      const r = razaoUso(c);
      const pct = r == null ? null : Math.floor(r * 100);
      const col = pct == null ? SURF2 : pct >= 100 ? RED : pct >= 80 ? AMBER : GREEN;
      const pstyle = `text-align:right;font-size:10.5px;font-weight:800${pct != null && pct >= 100 ? `;color:${RED}` : ''}`;
      const ptxt = pct == null ? '—' : pct >= 100 ? 'VENC.' : pct + '%';
      return `<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 44px;gap:10px;align-items:center;font-size:11.5px"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nome)}</span><span style="height:6px;background:${SURF2};border-radius:3px;overflow:hidden"><span style="display:block;width:${pct == null ? 0 : Math.min(100, pct)}%;height:100%;background:${col};border-radius:3px"></span></span><span style="${pstyle}">${ptxt}</span></div>`;
    }).join('');

    // Mesmo razaoUso das barras — é o que garante que a contagem daqui bata
    // com o número de "VENC." acima.
    const vencidos = comps.filter(c => razaoUso(c) >= 1);
    const alerta = vencidos.length
      ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:12px;padding:12px;font-size:12px;color:#eef2f4;display:flex;gap:10px;align-items:flex-start"><i class="fa-solid fa-triangle-exclamation" style="color:${RED};margin-top:2px"></i><span><strong>${vencidos.length} componente${vencidos.length > 1 ? 's' : ''} vencido${vencidos.length > 1 ? 's' : ''}:</strong> ${esc(vencidos.map(c => rotulo(c.tipo)).join(', '))}.</span></div>`
      : '';

    const mlist = Array.isArray(maint) ? maint : [];
    const maintHtml = mlist.length
      ? `<div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Manutenções · 12 meses</div>` +
        mlist.map(m => {
          const quando = fmtDiaMes(String(m.data).slice(0, 10));
          // Campo diferente (`componentTipo`, não `tipo`), mesmo defeito: era
          // aqui que a chave crua saía INTEIRA, sem as reticências da barra.
          const oque = m.componentTipo ? rotulo(m.componentTipo) : (m.tipoEvento || 'Serviço');
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
    // __reportError é o contrato com o report-render: marcar __reportReady
    // mesmo em falha é deliberado (imprimir o que deu em vez de estourar
    // timeout), mas sem um sinal explícito o PDF sairia em branco com HTTP
    // 200 — falha invisível. Com o sinal, a rota devolve 500 de forma
    // determinística, sem depender de farejar o console (Issue #132).
    .catch(err => {
      try { window.__reportError = String((err && err.stack) || err); } catch (_) {}
      try { console.error('[report] falha ao montar', err); } catch (_) {}
    })
    .finally(() => { window.__reportReady = true; });
}

// Função NO NAVEGADOR — monta o card resumido (#resumo) que vira o PNG do
// Telegram. Reusa o mesmo layout do email-relatorio.html (tokens/fontes do
// PDF, sem os artefatos de e-mail) e os mesmos módulos core. #95 Fase 2.
function reportResumoClient() {
  const INK = '#0d0f12', SURF = '#14181d', SURF2 = '#1c2128', BORDER = '#2a313a';
  const LIME = '#c6f135', MAG = '#ec3a8b', AMBER = '#e5c024', GREEN = '#22c55e', RED = '#ef4444', MUTED = '#8b95a1';
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
  const post = async (p, body) => {
    try {
      const r = await fetch('/api' + p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  };
  // Rótulos de componente: window.BikeComp (js/utils.js), via assets().core.

  const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const paraISO = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  // #106/#107: relatório de FECHAMENTO do mês anterior (o scheduler dispara dia
  // 1º). Janela = [1º dia, último dia] do mês passado, em horário LOCAL. Dia 0
  // deste mês = último dia do mês anterior.
  const _ultimoMesAnt = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
  const _primeiroMesAnt = new Date(_ultimoMesAnt.getFullYear(), _ultimoMesAnt.getMonth(), 1);
  const janelaIni = paraISO(_primeiroMesAnt), janelaFim = paraISO(_ultimoMesAnt);
  const mesNome = NOMES_MESES[_ultimoMesAnt.getMonth()];
  // #134: segunda janela — o mês ANTERIOR ao que fechou, usada só como base de
  // comparação (acumulados e dados do ciclista). Dia 0 do mês do fechamento =
  // último dia do mês anterior a ele.
  const _ultimoMesAnt2 = new Date(_primeiroMesAnt.getFullYear(), _primeiroMesAnt.getMonth(), 0);
  const _primeiroMesAnt2 = new Date(_ultimoMesAnt2.getFullYear(), _ultimoMesAnt2.getMonth(), 1);
  const janelaIniAnt = paraISO(_primeiroMesAnt2), janelaFimAnt = paraISO(_ultimoMesAnt2);
  const mesNomeAnt = NOMES_MESES[_ultimoMesAnt2.getMonth()];
  // Busca com folga (cobre o mês anterior mesmo gerando no fim do mês atual) e
  // filtra a janela no cliente — o endpoint só aceita "últimos N dias".
  // 130 e não ~100 (#134): o pico de CTL/ATL do mês de COMPARAÇÃO sai de uma
  // série de 60 dias que termina no fim daquele mês (calcTSBMetrics é fixa em
  // 60). A busca precisa cobrir esses 60 dias — gerando sob demanda no último
  // dia do mês atual, o começo deles fica ~122 dias atrás. Com janela menor o
  // mês de comparação perderia atividades que o do fechamento tem, seu CTL
  // sairia SUBESTIMADO e a variação apareceria falsamente positiva. Aumentar
  // além disso NÃO melhora a precisão: a janela de 60 dias é fixa nos dois.
  const fetchDays = 130;

  async function build() {
    // #134: `/garmin/training-readiness` saiu junto com a seção "Como você
    // está". As duas leituras de VO2máx são datadas (`asOf`) — o valor do mês
    // que fechou e o do mês anterior, para a variação.
    const [profile, unified, health, bikes, planResp, vo2maxResp, vo2maxAntResp, zoneResp, tiposCustom] = await Promise.all([
      get('/profile'), get(`/activities/unified?days=${fetchDays}`),
      get(`/garmin/health?days=${fetchDays}`), get('/bikes'),
      get('/weekly-training-plan'),
      get(`/garmin/vo2max?asOf=${janelaFim}`), get(`/garmin/vo2max?asOf=${janelaFimAnt}`),
      get(`/garmin/zone-distribution-by-activity?days=${fetchDays}`),
      get('/component-types'),
    ]);
    const u = profile || {};
    // todosItems: histórico completo da janela de busca (p/ aquecer o EMA do
    // CTL/ATL); items: só o mês fechado (acumulados, aderência, maior pedal).
    const todosItems = (unified && Array.isArray(unified.items)) ? unified.items : [];
    const noMes = (d) => d && d >= janelaIni && d <= janelaFim;
    const noMesAnt = (d) => d && d >= janelaIniAnt && d <= janelaFimAnt;
    const items = todosItems.filter(a => noMes(a.data));
    // #134: mesmas atividades, janela do mês de comparação — só para as notas
    // de variação. Sem query nova: filtra o histórico que já veio.
    const itemsAnt = todosItems.filter(a => noMesAnt(a.data));
    // #108: acumulados do mês (distância, tempo, elevação; nº = items.length).
    const somaAcumulados = (arr) => arr.reduce((s, a) => ({
      km:    s.km    + (a.distanciaKm || 0),
      horas: s.horas + (a.tempoMovS || 0) / 3600,
      elev:  s.elev  + (a.elevacaoM || 0),
    }), { km: 0, horas: 0, elev: 0 });
    const acumulados = somaAcumulados(items);
    const acumuladosAnt = somaAcumulados(itemsAnt);
    const diasMes = _ultimoMesAnt.getDate();

    // #109 — dados do ciclista. CTL/ATL máx do mês: série EMA até o fim do mês,
    // pico restrito aos dias do mês. VO2máx: último valor até o fim do mês
    // (`asOf`, #134 — a Garmin deste usuário não registra valor recente, então
    // sem a data o número exibido poderia ser posterior ao mês do relatório).
    // HRV noturno: média do mês. Cada métrica é calculada DUAS vezes, para o
    // mês fechado e para o anterior, de onde sai a nota de variação.
    // fcMax: usa o salvo; senão estima 220 − idade (mesma regra de
    // Profile.calcFCMax, que não está inlinado aqui). dataNascimento é ISO.
    const _idade = (iso) => {
      if (!iso) return 0;
      const [y, m, dd] = iso.split('-').map(Number);
      const t = new Date(); let a = t.getFullYear() - y;
      if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < dd)) a--;
      return a > 0 ? a : 0;
    };
    const fcMax = u.fcMax || (_idade(u.dataNascimento) > 0 ? 220 - _idade(u.dataNascimento) : null);
    // Pico de CTL/ATL de um mês: série EMA fechada no último dia dele, máximo
    // restrito aos seus dias. Extraído para rodar nos dois meses sem duplicar.
    const picosDoMes = (fimDoMes, dias) => {
      if (!fcMax || !window.Metrics) return { ctl: null, atl: null };
      const { ctlSerie, atlSerie } = window.Metrics.calcTSBMetrics(todosItems, fcMax, fimDoMes);
      const tail = Math.min(dias, ctlSerie.length);
      if (tail <= 0) return { ctl: null, atl: null };
      return {
        ctl: Math.round(Math.max(...ctlSerie.slice(-tail))),
        atl: Math.round(Math.max(...atlSerie.slice(-tail))),
      };
    };
    const { ctl: ctlMax, atl: atlMax } = picosDoMes(_ultimoMesAnt, diasMes);
    const { ctl: ctlMaxAnt, atl: atlMaxAnt } = picosDoMes(_ultimoMesAnt2, _ultimoMesAnt2.getDate());

    const mediaHrv = (dentro) => {
      const vals = (health || []).filter(h => dentro(h.data) && h.hrv_noite_avg != null && isFinite(h.hrv_noite_avg)).map(h => h.hrv_noite_avg);
      return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    };
    const hrvMedia = mediaHrv(noMes);
    const hrvMediaAnt = mediaHrv(noMesAnt);

    const vo2De = (resp) => (resp && resp.latest && resp.latest.value != null) ? Math.round(resp.latest.value) : null;
    const vo2 = vo2De(vo2maxResp);
    const vo2Ant = vo2De(vo2maxAntResp);

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
    const maiorPedalAnt = itemsAnt.reduce((mx, a) => Math.max(mx, a.distanciaKm || 0), 0);

    // `cellStyle` (#134): a última célula de cada tabela não tem `border-right`
    // e é mais larga. Antes isso obrigava a repetir o <td> inteiro inline duas
    // vezes (Elevação e Maior pedal), que então ficavam sem o slot `extra` —
    // justamente onde a nota de comparação precisa entrar. Com o parâmetro, as
    // seis células passam pelo helper.
    const kpi = (label, valueHtml, extra = '', cellStyle = `width:33%;padding:16px;border-right:1px solid ${BORDER}`) =>
      `<td valign="top" style="${cellStyle}"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:40px;line-height:1;margin-top:4px">${valueHtml}</div>${extra}</td>`;
    const CELULA_FIM = 'width:34%;padding:16px';

    // #134 — nota de comparação com o mês anterior, no molde da nota do PESO:
    // 11px, MUTED, com o valor do mês anterior destacado na cor do movimento.
    // `bomSubir=false` inverte o veredito (é o caso da fadiga ATL: carga aguda
    // em alta não é conquista). Sem base de comparação a nota sai neutra em vez
    // de inventar uma queda de 100%.
    // Variação percentual já formatada, com teto: a largura da célula é fixa
    // (o PNG tem 600 px), e uma base pequena produz número gigante — sair de
    // 0,1 h para 100 h dá 99900%, que estouraria a coluna. Acima de 999% o
    // número exato não informa nada que ">999%" não informe.
    const pctVar = (atual, anterior) => {
      const d = Math.round(Math.abs(atual - anterior) / anterior * 100);
      return d > 999 ? '>999%' : d + '%';
    };
    // O veredito (seta e cor) sai do MESMO número que aparece ao lado dele.
    // Comparar os floats crus dava "▲ 0%" em VERDE para 20,01 contra 20,00 —
    // movimento invisível pintado como ganho. Se o delta arredonda para zero,
    // é empate, e empate é cinza.
    const direcao = (atual, anterior, bomSubir) => {
      if (Math.round(Math.abs(atual - anterior) / anterior * 100) === 0) return { seta: '=', cor: MUTED };
      const subiu = atual > anterior;
      return { seta: subiu ? '▲' : '▼', cor: (subiu === bomSubir) ? GREEN : MAG };
    };
    const nota = (atual, anterior, fmt, bomSubir = true) => {
      const temBase = anterior != null && isFinite(anterior) && anterior > 0;
      if (!temBase) return `<div style="font-size:11px;color:${MUTED};margin-top:4px">${esc(mesNomeAnt)}: <span style="font-weight:700">—</span></div>`;
      const atualNum = (atual == null || !isFinite(atual)) ? 0 : atual;
      const { seta, cor } = direcao(atualNum, anterior, bomSubir);
      return `<div style="font-size:11px;color:${MUTED};margin-top:4px">${esc(mesNomeAnt)}: ${fmt(anterior)} <span style="color:${cor};font-weight:700">${seta} ${pctVar(atualNum, anterior)}</span></div>`;
    };
    const fmtInt = (v) => vírgula(v, 0);
    const fmtDec = (v) => vírgula(v);

    // #134 item 5 — status da bike. Antes havia só o alerta de vencidos; agora
    // o bloco traz km total e as barras de desgaste por componente, no mesmo
    // critério de cor do PDF (vermelho ≥100% com "VENC.", âmbar ≥80%, verde).
    // NÃO é o bikeCard do PDF: aquele depende dos helpers card()/eyebrow() do
    // outro cliente e usa duas colunas que não cabem nos 528 px úteis daqui.
    // Sem manutenções e sem outras bikes — assim o bloco se resolve com o
    // /bikes que o resumo já busca (components e kmTotal vêm embutidos), sem
    // nenhuma requisição nova. Sem ícones: o resumoHtml não carrega o Font
    // Awesome nem o fallback unicode que o printHtml define, então um <i> viria
    // como caixinha vazia no PNG.
    const list = Array.isArray(bikes) ? bikes : [];
    const bike = list.find(b => b.active) || list[0];
    const comps = (bike && Array.isArray(bike.components)) ? bike.components : [];
    // Uma única fonte de verdade para "vencido". Antes a barra usava
    // `Math.round(razao*100) >= 100` e o banner usava `razao >= 1`: a razão
    // 0,996 arredonda para 100% e a barra marcaria "VENC." num componente que
    // o banner não conta ("1 componente vencido" sob duas barras VENC.).
    // `Math.floor` faz `pct >= 100` coincidir exatamente com `razao >= 1`.
    // Rótulo e razão vêm de window.BikeComp (js/utils.js): o cliente do PDF
    // usa exatamente os mesmos, e era a duplicação disto aqui que fazia a
    // correção alcançar um relatório e não o outro (#142).
    const razaoUso = (c) => window.BikeComp.razaoUso(c);
    const vencidos = comps.filter(c => razaoUso(c) >= 1);
    const labelComp = (tipo) => window.BikeComp.label(tipo, tiposCustom);
    const compRows = comps.map(c => {
      const r = razaoUso(c);
      const pct = r == null ? null : Math.floor(r * 100);
      const col = pct == null ? SURF2 : pct >= 100 ? RED : pct >= 80 ? AMBER : GREEN;
      const ptxt = pct == null ? '—' : pct >= 100 ? 'VENC.' : pct + '%';
      return `<div style="display:grid;grid-template-columns:140px minmax(0,1fr) 46px;gap:10px;align-items:center;font-size:11.5px"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(labelComp(c.tipo))}</span><span style="height:6px;background:${SURF2};border-radius:3px;overflow:hidden"><span style="display:block;width:${pct == null ? 0 : Math.min(100, pct)}%;height:100%;background:${col};border-radius:3px"></span></span><span style="text-align:right;font-size:10.5px;font-weight:800${pct != null && pct >= 100 ? `;color:${RED}` : ''}">${ptxt}</span></div>`;
    }).join('');
    const alertaVenc = vencidos.length
      ? `<div style="margin-top:12px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:10px;padding:10px 12px;font-size:12px;color:#eef2f4"><strong style="color:${RED}">${vencidos.length} componente${vencidos.length > 1 ? 's' : ''} vencido${vencidos.length > 1 ? 's' : ''}:</strong> ${esc(vencidos.map(c => labelComp(c.tipo)).join(', '))}.</div>`
      : '';
    const bikeBloco = bike
      ? `<div style="margin:12px 36px 0;background:${SURF};border:1px solid ${BORDER};border-radius:12px;padding:14px 16px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding-bottom:10px">Status da bike</div><div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px"><span style="font-family:'Bebas Neue',sans-serif;font-size:22px;line-height:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(bike.nome || '').toUpperCase())}</span><span style="font-size:10.5px;color:${MUTED};flex-shrink:0">${bike.tipo ? esc(bike.tipo) + ' · ' : ''}${bike.kmTotal != null ? vírgula(bike.kmTotal, 0) + ' km' : ''}</span></div><div style="display:flex;flex-direction:column;gap:8px">${compRows || `<span style="font-size:11.5px;color:${MUTED}">Sem componentes cadastrados.</span>`}</div>${alertaVenc}</div>`
      : '';

    // #109 — bloco "Dados do ciclista": só os tiles que têm valor (flex, para
    // lidar com nº variável de métricas presentes).
    // `nota` (#134): slot de variação, o equivalente ao `extra` do `kpi` — o
    // tile não tinha nenhum. Fonte menor que a dos acumulados porque aqui são
    // quatro tiles dividindo os mesmos 528 px.
    const dadoTile = (label, val, un, nota = '') => val == null ? '' :
      `<div style="flex:1;min-width:0;padding:12px 8px;text-align:center"><div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;margin-top:3px">${val}${un ? `<span style="font-size:12px;color:${LIME};margin-left:2px">${un}</span>` : ''}</div>${nota}</div>`;
    // Variação de um tile: só a seta e o %, sem repetir o nome do mês (não cabe
    // em 1/4 da largura). ATL com `bomSubir=false` — fadiga aguda em alta é o
    // sinal ruim, ao contrário de carga, VO₂ e HRV.
    const notaTile = (atual, anterior, bomSubir = true) => {
      const temBase = anterior != null && isFinite(anterior) && anterior > 0;
      if (!temBase) return '';
      const atualNum = (atual == null || !isFinite(atual)) ? 0 : atual;
      const { seta, cor } = direcao(atualNum, anterior, bomSubir);
      return `<div style="font-size:10px;font-weight:700;margin-top:3px;color:${cor}">${seta} ${pctVar(atualNum, anterior)}</div>`;
    };
    const dadosTiles = [
      dadoTile('Carga CTL', ctlMax, '', notaTile(ctlMax, ctlMaxAnt)),
      dadoTile('Fadiga ATL', atlMax, '', notaTile(atlMax, atlMaxAnt, false)),
      dadoTile('VO₂máx', vo2, '', notaTile(vo2, vo2Ant)),
      dadoTile('HRV noturno', hrvMedia, '', notaTile(hrvMedia, hrvMediaAnt)),
    ].filter(Boolean);
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
      ? `<div style="margin:12px 36px 0;background:${SURF};border:1px solid ${BORDER};border-radius:12px;padding:14px 16px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding-bottom:10px">Tempo por zona de FC · ${esc(mesNome)}</div><div style="display:flex;align-items:center;justify-content:center;gap:20px"><div style="width:110px;height:110px;border-radius:50%;background:conic-gradient(${stops.join(',')});flex-shrink:0;position:relative"><div style="position:absolute;top:22px;left:22px;right:22px;bottom:22px;background:${SURF};border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:20px">${vírgula(zonaTotal / 3600)}h</div></div><div>${zonaLegenda}</div></div></div>`
      : '';

    // #111 — aderência ao plano no mês (barra + %).
    const aderCor = aderPct == null ? MUTED : (aderPct >= 80 ? GREEN : (aderPct >= 50 ? AMBER : RED));
    const aderBloco = aderPct != null
      ? `<div style="margin:12px 36px 0;background:${SURF};border:1px solid ${BORDER};border-radius:12px;padding:12px 16px"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">Aderência ao plano</span><span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:${aderCor}">${aderPct}%</span></div><div style="height:6px;background:${SURF2};border-radius:3px;overflow:hidden;margin-top:8px"><div style="width:${Math.min(100, aderPct)}%;height:100%;background:${aderCor}"></div></div></div>`
      : '';

    // #112 — análise de IA do mês. POST com os insumos já calculados (cache por
    // mês no servidor). Só pede se houve atividade; falha/timeout/sem-IA → omite
    // a seção (o PNG nunca deixa de sair por causa da IA).
    let analiseBloco = '';
    if (items.length > 0) {
      const dados = {
        acumulados: { km: Math.round(acumulados.km), horas: Math.round(acumulados.horas * 10) / 10, elev: Math.round(acumulados.elev), count: items.length },
        ctlMax, atlMax, vo2, hrv: hrvMedia,
        zonasPct: zonaTotal > 0 ? zonaSeg.map(s => Math.round(s / zonaTotal * 100)) : [],
        aderPct,
        peso: { atual: pesoAtual, meta },
      };
      const r = await post('/report/monthly-analysis', { mes: janelaIni.slice(0, 7), dados });
      if (r && r.observacao) {
        analiseBloco = `<div style="margin:12px 36px 0;background:${SURF};border:1px solid ${BORDER};border-radius:12px;padding:14px 16px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${LIME};padding-bottom:6px">Análise do mês</div><div style="font-size:13px;line-height:1.5;color:#eef2f4">${esc(r.observacao)}</div>${r.foco ? `<div style="margin-top:10px;font-size:12px;line-height:1.5;color:#c4ccd4"><span style="color:${MAG};font-weight:700">Foco: </span>${esc(r.foco)}</div>` : ''}</div>`;
      }
    }

    const dataTxt = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');

    document.getElementById('resumo').innerHTML = `
      <div style="height:6px;background:repeating-linear-gradient(90deg,${LIME} 0 18px,${MAG} 18px 36px)"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 36px 0"><span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.04em">VELOCE <span style="color:${LIME}">LABS</span></span><span style="font-size:11px;color:${MUTED}">${esc(dataTxt)}</span></div>
      <div style="padding:26px 36px 4px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${LIME}">Fechamento de ${esc(mesNome)}</div>
      <div style="padding:0 36px;font-family:'Bebas Neue',sans-serif;font-size:44px;line-height:.9">SEU RELATÓRIO DE EVOLUÇÃO</div>
      <div style="padding:10px 36px 22px;font-size:14px;line-height:1.5;color:#c4ccd4">Olá, ${esc(nome)}. Aqui está o fechamento de ${esc(mesNome)}. O relatório completo está no app.</div>
      <div style="margin:0 36px 12px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};padding:0 0 6px">Acumulados de ${esc(mesNome)}</div><table width="100%" cellpadding="0" cellspacing="0" style="background:${SURF};border:1px solid ${BORDER};border-radius:12px;border-collapse:separate"><tr>
        ${kpi('Distância', acumulados.km > 0 ? `${vírgula(acumulados.km, 0)}<span style="font-size:15px;color:${LIME};margin-left:3px">KM</span>` : '—', nota(acumulados.km, acumuladosAnt.km, fmtInt))}
        ${kpi('Tempo', acumulados.horas > 0 ? `${vírgula(acumulados.horas)}<span style="font-size:15px;color:${LIME};margin-left:3px">H</span>` : '—', nota(acumulados.horas, acumuladosAnt.horas, fmtDec))}
        ${kpi('Elevação', acumulados.elev > 0 ? `${vírgula(acumulados.elev, 0)}<span style="font-size:15px;color:${LIME};margin-left:3px">M</span>` : '—', nota(acumulados.elev, acumuladosAnt.elev, fmtInt), CELULA_FIM)}
      </tr></table></div>
      <div style="margin:0 36px"><table width="100%" cellpadding="0" cellspacing="0" style="background:${SURF};border:1px solid ${BORDER};border-radius:12px;border-collapse:separate"><tr>
        ${kpi('Passeios', String(items.length), nota(items.length, itemsAnt.length, fmtInt))}
        ${kpi('Peso atual', pesoAtual != null ? `${vírgula(pesoAtual)}<span style="font-size:15px;color:${LIME};margin-left:3px">KG</span>` : '—', meta != null && faltam != null ? `<div style="font-size:11px;color:${MUTED};margin-top:4px">meta ${esc(String(meta))} kg · faltam <span style="color:${MAG};font-weight:700">${vírgula(faltam)}</span></div>` : '')}
        ${kpi('Maior pedal', maiorPedal > 0 ? `${vírgula(maiorPedal)}<span style="font-size:15px;color:${LIME};margin-left:3px">KM</span>` : '—', nota(maiorPedal, maiorPedalAnt, fmtDec), CELULA_FIM)}
      </tr></table></div>
      ${dadosBloco}
      ${roscaBloco}
      ${aderBloco}
      ${analiseBloco}
      ${bikeBloco}
      <div style="height:14px"></div>
      <div style="padding:14px 36px 22px;border-top:1px solid ${BORDER};font-size:11px;color:${MUTED}">Veloce Labs · relatório mensal automático</div>`;
  }

  build()
    .catch(err => {
      try { window.__reportError = String((err && err.stack) || err); } catch (_) {}
      try { console.error('[resumo] falha', err); } catch (_) {}
    })
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

  // ── POST /api/report/monthly-analysis ─────────────────────────────────
  // Análise de IA do mês (#112). Chamada pelo próprio template do resumo
  // durante o render (loopback), com os insumos já calculados. Cache por mês:
  // a 1ª chamada do mês gera via IA; as seguintes batem no cache. Falha de IA
  // NUNCA quebra o relatório — responde {observacao:null} e o client omite a
  // seção (o resto do PNG renderiza igual).
  fastify.post('/api/report/monthly-analysis', async (req, reply) => {
    const { mes, dados } = req.body || {};
    if (!mes || !/^\d{4}-\d{2}$/.test(String(mes))) {
      reply.code(400);
      return { error: 'mes (YYYY-MM) é obrigatório' };
    }
    const cache = lerCacheMensal(fastify.db, mes);
    if (cache) {
      const p = JSON.parse(cache.payload);
      return { observacao: p.observacao, foco: p.foco, geradoEm: cache.gerado_em, cache: true };
    }
    try {
      const r = await gerarEArmazenarMensal(fastify.db, { mes, dados: dados || {} });
      return { observacao: r.observacao, foco: r.foco, geradoEm: r.geradoEm, cache: false };
    } catch (err) {
      req.log.warn({ err: err.message, cascata: err.cascata }, '[report] análise mensal: IA indisponível');
      return { observacao: null };   // 200 — relatório sai sem a seção
    }
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
      const r = await reportRender.renderPdf({ days });
      pdf = r.pdf;
      if (r.ruido.length) {
        // Só log: 4xx de recurso vira console.error no Chromium sem o render
        // estar quebrado. Serve pra diagnosticar, nunca pra gate.
        fastify.log.warn({ days: days || 'completo', ruido: r.ruido.slice(0, 5) }, '[report] erros no console do render');
      }
      // Erro de JS na montagem ainda marca __reportReady (decisão deliberada,
      // ver report-render.js), então sem este guard o PDF sairia em branco ou
      // parcial com HTTP 200 — indistinguível de sucesso pra quem baixa.
      if (r.falhou) {
        fastify.log.error({ days: days || 'completo', erro: r.falhou }, '[report] render do PDF falhou ao montar');
        return reply.code(500).send({ error: 'O relatório não pôde ser montado (erro ao renderizar os dados)' });
      }
    } catch (e) {
      fastify.log.error({ err: e, days: days || 'completo' }, '[report] falha ao gerar PDF');
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
