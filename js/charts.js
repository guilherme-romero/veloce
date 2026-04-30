/* ═══════════════════════════════════════════════════════════════════════
   CHARTS — peso (projeção teórica + real medido + histórico) + intensidade
═══════════════════════════════════════════════════════════════════════ */

const CHART_COLORS = {
  grid:      'rgba(255,255,255,0.06)',
  tick:      '#6b7280',
  teal:      '#14d9b8',
  tealFill:  'rgba(20,217,184,0.10)',
  amber:     '#f5a523',
  amberFill: 'rgba(245,165,35,0.10)',
  muted:     '#6b7280',
};

let weightChart   = null;
let intensityChart = null;

/* ── Init dos gráficos (estrutura vazia, dados vêm depois) ──────────── */
function initCharts() {
  const weightCtx = document.getElementById('weightChart').getContext('2d');
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
        {
          label: 'Histórico',
          data: [],
          borderColor: CHART_COLORS.muted,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS.muted,
          pointBorderColor: '#0c0d10',
          pointBorderWidth: 1.5,
          fill: false,
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

  const intensityCtx = document.getElementById('intensityChart').getContext('2d');
  intensityChart = new Chart(intensityCtx, {
    type: 'doughnut',
    data: {
      labels: ['Baixa Z1/Z2', 'Média Z3', 'Alta Z4/Z5'],
      datasets: [{
        data: [80, 5, 15],
        backgroundColor: [CHART_COLORS.teal, CHART_COLORS.amber, '#f0523a'],
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
            font: { size: 11, family: "'Outfit', sans-serif" },
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: '#13151a',
          borderColor: '#252830',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: ctx => `${ctx.label}: ${ctx.parsed}%`
          }
        }
      },
      cutout: '70%'
    }
  });
}

/* ── Render do gráfico de peso ──────────────────────────────────────── */
/**
 * @param {Object}  user     — { pesoAtual, pesoMeta, dataInicioPlano }
 * @param {Array}   weights  — [ { data: 'YYYY-MM-DD', peso: 84.2, tipo: 'atual'|'historico' } ]
 */
function renderWeightChart(user, weights) {
  if (!weightChart) return;

  const peso  = user.pesoAtual || 0;
  const meta  = user.pesoMeta  || 0;
  const start = user.dataInicioPlano || tbToday();

  // Eixo X = 13 pontos = Sem 0..Sem 12
  const labels = [];
  const projection = [];

  for (let i = 0; i <= 12; i++) {
    const d = addDays(start, i * 7);
    labels.push(formatLabel(d, i));

    if (peso && meta) {
      const v = peso - ((peso - meta) / 12) * i;
      projection.push(+v.toFixed(2));
    } else {
      projection.push(null);
    }
  }
  if (peso && meta) projection[12] = meta;

  // Peso real semanal (mapeia datas para a semana correspondente)
  const real = new Array(13).fill(null);
  const historic = [];
  const histLabels = [];

  (weights || []).forEach(w => {
    if (w.tipo === 'historico') {
      historic.push({ x: w.data, y: w.peso });
      return;
    }
    const sem = weekIndex(start, w.data);
    if (sem >= 0 && sem <= 12) {
      real[sem] = w.peso;
    }
  });

  // Histórico anterior ao início do plano: prepende rótulos extras se houver
  // Simplificação: histórico é mostrado no mesmo eixo, em pontos antes da Sem 0
  // (aqui usamos labels separados se tiver histórico, senão só projeção/real)
  let finalLabels = labels;
  let finalProj   = projection;
  let finalReal   = real;
  let finalHist   = new Array(13).fill(null);

  if (historic.length > 0) {
    historic.sort((a, b) => a.x.localeCompare(b.x));
    const histN = historic.length;

    // Cria N labels extras à esquerda
    const histLabelsExtra = historic.map(h => {
      const semHist = -Math.ceil(daysBetween(h.x, start) / 7);
      return `Sem ${semHist}`;
    });

    finalLabels = [...histLabelsExtra, ...labels];
    finalProj   = [...new Array(histN).fill(null), ...projection];
    finalReal   = [...new Array(histN).fill(null), ...real];
    finalHist   = [...historic.map(h => h.y), ...new Array(13).fill(null)];

    // Conecta visualmente histórico ao primeiro real (se existir)
    const firstRealIdx = finalReal.findIndex(v => v != null);
    if (firstRealIdx >= 0 && histN > 0) {
      finalHist[histN - 1 + 1] = finalReal[firstRealIdx]; // emendar
    }
  }

  weightChart.data.labels             = finalLabels;
  weightChart.data.datasets[0].data   = finalProj;
  weightChart.data.datasets[1].data   = finalReal;
  weightChart.data.datasets[2].data   = finalHist;

  // Y axis: range com folga
  if (peso && meta) {
    const allVals = [...finalProj, ...finalReal, ...finalHist].filter(v => v != null);
    const min = Math.floor(Math.min(meta - 2, ...allVals) - 0.5);
    const max = Math.ceil(Math.max(peso + 1, ...allVals) + 0.5);
    weightChart.options.scales.y.min = min;
    weightChart.options.scales.y.max = max;
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
  init: initCharts,
  renderWeight: renderWeightChart,
};
