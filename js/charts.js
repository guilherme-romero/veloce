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

/* ── Init dos gráficos (estrutura vazia, dados vêm depois) ──────────── */
function initCharts() {
  const weightCtxEl = document.getElementById('weightChart');
  if (weightCtxEl) {
    const weightCtx = weightCtxEl.getContext('2d');
    weightChart = new Chart(weightCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Projeção',
            data: [],
            borderColor: CHART_COLORS.teal,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4],
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: CHART_COLORS.teal,
            fill: false,
            spanGaps: true,
          },
          {
            label: 'Peso real',
            data: [],
            borderColor: CHART_COLORS.teal,
            backgroundColor: CHART_COLORS.tealFill,
            borderWidth: 2.5,
            tension: 0.3,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: CHART_COLORS.teal,
            pointBorderColor: '#0c0d10',
            pointBorderWidth: 2,
            spanGaps: true,
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
            grid: { display: false },
            ticks: {
              color: CHART_COLORS.tick,
              maxTicksLimit: 7,
              font: { size: 10, family: "'Outfit', sans-serif" }
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

  (async () => {
    let dist = null;
    try {
      if (window.Api) dist = await window.Api.get('/garmin/zone-distribution?days=90');
    } catch (_) { /* trata como vazio abaixo */ }

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
 * Projeção gerada a partir do histórico real de pesagens (balança Garmin):
 * regressão linear sobre as medições → linha de tendência estendida pelas
 * 12 semanas do plano. Sem entrada manual de peso. (Fase — projeção Garmin)
 * @param {Object}  user     — { pesoMeta, dataInicioPlano }
 * @param {Array}   weights  — [ { data: 'YYYY-MM-DD', peso: 84.2 } ]  (somente Garmin)
 */
function renderWeightChart(user, weights) {
  if (!weightChart) return;

  const meta  = user.pesoMeta  || 0;
  const start = user.dataInicioPlano || tbToday();

  // Consolida todas as pesagens por dia (média) — base da regressão
  const byDay = {};
  (weights || []).forEach(w => {
    if (w.peso == null) return;
    (byDay[w.data] = byDay[w.data] || []).push(w.peso);
  });
  const measured = Object.entries(byDay)
    .map(([data, ps]) => ({ data, peso: ps.reduce((s, p) => s + p, 0) / ps.length }))
    .sort((a, b) => a.data.localeCompare(b.data));

  // Regressão linear (kg/dia) sobre as medições reais → tendência
  let slope = null, intercept = null, t0 = null;
  if (measured.length >= 2) {
    t0 = new Date(measured[0].data + 'T12:00:00').getTime();
    const pts = measured.map(w => ({
      x: (new Date(w.data + 'T12:00:00').getTime() - t0) / 86400000,
      y: w.peso,
    }));
    const n  = pts.length;
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const sy = pts.reduce((s, p) => s + p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
    const denom = n * sx2 - sx * sx;
    if (denom !== 0) {
      slope = (n * sxy - sx * sy) / denom;
      intercept = (sy - slope * sx) / n;
    }
  }
  const trendAt = (iso) => {
    if (slope == null) return null;
    const x = (new Date(iso + 'T12:00:00').getTime() - t0) / 86400000;
    return +(intercept + slope * x).toFixed(2);
  };

  // Eixo: 13 pontos (Sem 0..Sem 12) a partir do início do plano
  const planLabels = [], planDates = [];
  for (let i = 0; i <= 12; i++) {
    const d = addDays(start, i * 7);
    planDates.push(d);
    planLabels.push(formatLabel(d, i));
  }
  const projection = planDates.map(trendAt);

  // Medições do plano mapeadas para a semana mais próxima (só dados do Garmin)
  const real = new Array(13).fill(null);
  (weights || []).forEach(w => {
    const sem = weekIndex(start, w.data);
    if (sem >= 0 && sem <= 12) real[sem] = w.peso;  // última da semana vence
  });

  const finalLabels = planLabels;
  const finalProj   = projection;
  const finalReal   = real;

  weightChart.data.labels           = finalLabels;
  weightChart.data.datasets[0].data = finalProj;
  weightChart.data.datasets[1].data = finalReal;

  // Y axis: range com folga, considerando meta + medições + tendência
  const pesoRef = measured.length ? measured[measured.length - 1].peso : 0;
  const allVals = [...finalProj, ...finalReal].filter(v => v != null);
  if (allVals.length > 0) {
    const loBase = meta ? Math.min(meta - 2, ...allVals) : Math.min(...allVals);
    const hiBase = Math.max(pesoRef + 1, ...allVals);
    weightChart.options.scales.y.min = Math.floor(loBase - 0.5);
    weightChart.options.scales.y.max = Math.ceil(hiBase + 0.5);
  }

  weightChart.update();
}

/* ── Helpers de data ────────────────────────────────────────────────── */
function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function weekIndex(startISO, dataISO) {
  return Math.round(daysBetween(startISO, dataISO) / 7);
}
function formatLabel(iso, semana) {
  const d = new Date(iso + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `S${semana} · ${dd}/${mm}`;
}

/* expor */
window.Charts = {
  init:            initCharts,
  renderWeight:    renderWeightChart,
  renderIntensity: renderIntensity,
};
