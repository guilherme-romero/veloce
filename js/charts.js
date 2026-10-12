/* ═══════════════════════════════════════════════════════════════════════
   CHARTS — peso (projeção teórica + real medido + histórico) + intensidade
═══════════════════════════════════════════════════════════════════════ */

const CHART_COLORS = {
  grid:      'rgba(255,255,255,0.06)',
  tick:      '#8b95a1',
  teal:      '#c6f135',   /* lima (Hi-Vis v2.0) */
  tealFill:  'rgba(198,241,53,0.12)',
  amber:     '#f5d523',
  amberFill: 'rgba(245,213,35,0.12)',
  muted:     '#8b95a1',
};

/* Tema escuro global do Chart.js — fonte Archivo + cor de texto muted */
if (window.Chart) {
  Chart.defaults.font.family = "'Archivo', system-ui, sans-serif";
  Chart.defaults.color = '#8b95a1';
}

let weightChart    = null;
let intensityChart = null;
let _intensityTotal = 0;
let _intensityToken = 0; // cancela respostas de fetches antigos (padrão _last5Token)

/* ── Init dos gráficos (estrutura vazia, dados vêm depois) ──────────── */
function initCharts() {
  const weightCtxEl = document.getElementById('weightChart');
  if (weightCtxEl) {
    const weightCtx = weightCtxEl.getContext('2d');
    weightChart = new Chart(weightCtx, {
      type: 'line',
      data: {
        labels: [],
        // Eixo x linear por timestamp (ms) — {x,y} por ponto. Sem adapter de
        // data (fora da CSP). Ordem: peso real, tendência (histórico),
        // projeção ritmo atual, potencial (plano 100%, #92), meta.
        datasets: [
          {
            label: 'Peso real',
            data: [],
            borderColor: CHART_COLORS.teal,
            backgroundColor: CHART_COLORS.tealFill,
            borderWidth: 2.5,
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: CHART_COLORS.teal,
            pointBorderColor: '#0c0d10',
            pointBorderWidth: 2,
            spanGaps: true,
          },
          {
            label: 'Tendência',
            data: [],
            borderColor: CHART_COLORS.muted,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            tension: 0,
            pointRadius: 0,
            fill: false,
          },
          {
            label: 'Projeção (ritmo atual)',
            data: [],
            borderColor: CHART_COLORS.muted,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [6, 4],
            tension: 0,
            pointRadius: 0,
            fill: false,
          },
          {
            label: 'Potencial (plano 100%)',
            data: [],
            borderColor: '#4e9ef5',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [6, 4],
            tension: 0,
            pointRadius: 0,
            fill: false,
          },
          {
            label: 'Meta',
            data: [],
            borderColor: CHART_COLORS.amber,
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderDash: [2, 4],
            tension: 0,
            pointRadius: 0,
            fill: false,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },   // legenda customizada no HTML (footer)
          tooltip: {
            backgroundColor: '#13151a',
            borderColor: '#252830',
            borderWidth: 1,
            padding: 12,
            titleColor: '#e8eaf0',
            bodyColor: '#9299a8',
            callbacks: {
              title: items => {
                const x = items && items[0] && items[0].parsed && items[0].parsed.x;
                return x ? new Date(x).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
              },
              label: ctx => {
                if (ctx.parsed.y == null) return null;
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} kg`;
              }
            }
          }
        },
        scales: {
          y: {
            grid: { color: CHART_COLORS.grid, borderDash: [4, 4] },
            ticks: {
              color: CHART_COLORS.tick,
              callback: v => v + ' kg',
              font: { size: 11, family: "'Outfit', sans-serif" }
            },
          },
          x: {
            type: 'linear',
            grid: { display: false },
            ticks: {
              color: CHART_COLORS.tick,
              maxTicksLimit: 7,
              font: { size: 10, family: "'Outfit', sans-serif" },
              callback: v => new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
            },
          }
        }
      }
    });
  }

  const intensityCtxEl = document.getElementById('intensityChart');
  if (intensityCtxEl) {
    const intensityCtx = intensityCtxEl.getContext('2d');
    intensityChart = new Chart(intensityCtx, {
      type: 'doughnut',
      data: {
        labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
        datasets: [{
          data: [0, 0, 0, 0, 0],
          backgroundColor: ['#4e9ef5', '#f5d523', '#22c55e', '#f0523a', '#a855f7'],
          borderColor: '#13151a',
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              color: CHART_COLORS.tick,
              font: { size: 11, family: "'Archivo', sans-serif" },
              padding: 10
            }
          },
          tooltip: {
            backgroundColor: '#13151a',
            borderColor: '#252830',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: ctx => {
                const pct = _intensityTotal ? Math.round((ctx.parsed / _intensityTotal) * 100) : 0;
                return `${ctx.label}: ${pct}% · ${Math.round(ctx.parsed / 60)} min`;
              }
            }
          }
        },
        cutout: '62%'
      }
    });
  }
}

/* ── Render da distribuição de intensidade ──────────────────────────── */
// Fonte: tempo real em cada zona de FC das atividades Garmin (hr_zones
// agregado no backend). Garmin usa 5 zonas; Z6 fica zerada. O argumento é
// ignorado (mantido por compatibilidade com as chamadas existentes).
function renderIntensity() {
  if (!intensityChart) return;

  const canvas = document.getElementById('intensityChart');
  const wrap = canvas ? canvas.parentElement : null;
  let emptyEl = wrap ? wrap.querySelector('.chart-empty') : null;

  const showEmpty = (msg) => {
    if (canvas) canvas.style.display = 'none';
    if (wrap && !emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'chart-empty';
      wrap.appendChild(emptyEl);
    }
    if (emptyEl) { emptyEl.textContent = msg; emptyEl.style.display = ''; }
  };

  const myToken = ++_intensityToken;
  (async () => {
    let dist = null;
    try {
      if (window.Api) dist = await window.Api.get('/garmin/zone-distribution?days=90');
    } catch (_) { /* trata como vazio abaixo */ }

    if (myToken !== _intensityToken) return; // um render mais novo já assumiu

    const seg   = (dist && Array.isArray(dist.segundosPorZona)) ? dist.segundosPorZona : [];
    const total = (dist && dist.totalSegundos) || 0;

    if (!total) {
      showEmpty('Sincronize atividades com FC no Garmin para ver a distribuição por zona.');
      return;
    }
    if (canvas) canvas.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';

    // Segundos reais (não % arredondado) — zonas pequenas (ex.: Z1 com poucos
    // minutos) continuam visíveis; o % aparece no tooltip.
    _intensityTotal = total;
    intensityChart.data.datasets[0].data = seg.slice(0, 5);
    intensityChart.update();
  })();
}

/* ── Render do gráfico de peso ──────────────────────────────────────── */
/**
 * Gráfico de peso (#91 + #92): 6 meses de pesagens reais do Garmin + linha de
 * tendência (regressão), sem a projeção teórica velha de 12 semanas. Pra frente
 * (#92): projeção no ritmo atual e, quando houver cenário, a projeção potencial
 * (plano 100%), cada uma até cruzar a linha horizontal da meta. A regressão vem
 * do core (WeightStats) pra tendência/projeção não divergirem do texto da
 * previsão. Eixo x linear por timestamp (ms). Só peso do Garmin.
 * @param {Object} user     — { pesoMeta }
 * @param {Array}  weights  — [ { data: 'YYYY-MM-DD', peso: 84.2 } ] (Garmin)
 * @param {Object} [scenario] — retorno de WeightStats.metaScenario (opcional)
 */
function renderWeightChart(user, weights, scenario) {
  if (!weightChart) return;

  const DAY  = 86400000;
  const now  = Date.now();
  const meta = (user && user.pesoMeta) || 0;
  const hist0 = now - 180 * DAY;   // 6 meses de histórico (#91)

  // Pesagens consolidadas por dia (média), em ms, cronológicas
  const byDay = {};
  (weights || []).forEach(w => {
    if (w.peso == null) return;
    (byDay[w.data] = byDay[w.data] || []).push(w.peso);
  });
  const measured = Object.entries(byDay)
    .map(([data, ps]) => ({ t: new Date(data + 'T12:00:00').getTime(), y: ps.reduce((s, p) => s + p, 0) / ps.length }))
    .filter(p => isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const hist = measured.filter(p => p.t >= hist0);

  // Regressão do core — mesmo slope/t0/intercept que a previsão da meta usa.
  const base = (window.WeightStats && window.WeightStats.weightAnalysis)
    ? window.WeightStats.weightAnalysis(user, weights) : null;

  const ds = weightChart.data.datasets;
  ds[0].data = hist.map(p => ({ x: p.t, y: +p.y.toFixed(2) }));  // peso real
  ds[1].data = []; ds[2].data = []; ds[3].data = []; ds[4].data = [];

  let xMax = now;
  if (base && base.ok && base.t0 != null && base.slope != null) {
    const trend = (t) => +(base.intercept + base.slope * ((t - base.t0) / DAY)).toFixed(2);
    // Tendência (histórico): do início da janela da regressão (ou 1ª pesagem
    // visível) até hoje.
    const tStart = hist.length ? Math.min(hist[0].t, base.t0) : base.t0;
    ds[1].data = [{ x: tStart, y: trend(tStart) }, { x: now, y: trend(now) }];

    // Projeção no ritmo atual: hoje → meta (só quando progride rumo à meta).
    if (meta && base.diasNec != null && isFinite(base.diasNec) && base.diasNec > 0) {
      const tMetaReal = now + base.diasNec * DAY;
      ds[2].data = [{ x: now, y: trend(now) }, { x: tMetaReal, y: meta }];
      xMax = Math.max(xMax, tMetaReal);
    }
    // Projeção potencial (plano 100%, #92): hoje → meta ao ritmo escalado.
    if (meta && scenario && scenario.mostra && scenario.diasNec > 0) {
      const tMetaPot = now + scenario.diasNec * DAY;
      ds[3].data = [{ x: now, y: trend(now) }, { x: tMetaPot, y: meta }];
      xMax = Math.max(xMax, tMetaPot);
    }
  }

  // Cap do horizonte futuro (~1 ano) pra uma meta muito distante não achatar
  // o histórico de 6 meses.
  const xMaxCap = now + 400 * DAY;
  if (xMax > xMaxCap) xMax = xMaxCap;

  const xMin = hist.length ? Math.min(hist[0].t, hist0) : hist0;
  if (meta) ds[4].data = [{ x: xMin, y: meta }, { x: xMax, y: meta }];  // linha da meta

  weightChart.options.scales.x.min = xMin;
  weightChart.options.scales.x.max = xMax;

  // Eixo y: folga considerando pesagens + meta + pontas das projeções.
  const allY = [
    ...hist.map(p => p.y),
    ...(meta ? [meta] : []),
    ...ds[2].data.map(p => p.y), ...ds[3].data.map(p => p.y),
  ].filter(v => v != null && isFinite(v));
  if (allY.length) {
    weightChart.options.scales.y.min = Math.floor(Math.min(...allY) - 0.8);
    weightChart.options.scales.y.max = Math.ceil(Math.max(...allY) + 0.8);
  }

  weightChart.update();
}


/* expor */
window.Charts = {
  init:            initCharts,
  renderWeight:    renderWeightChart,
  renderIntensity: renderIntensity,
};
