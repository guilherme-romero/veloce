/* ═══════════════════════════════════════════════════════════════════════
   COMPARATIVO DE DESEMPENHO — bloco da seção Desempenho, abaixo da Análise
   de Performance (GLOSSARY.md "Comparativo de Desempenho"). Reaproveita o
   motor puro ComparativePerformance (js/core/) e renderiza 5 mini-gráficos
   via Chart.js (já carregado pelo resto do app).

   Desktop-only nesta rodada (mobile fica para depois, mesmo padrão faseado
   de sempre) — só este arquivo + index.html são tocados.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  const COLORS = {
    amber: '#f5d523',
    red:   '#f0523a',
    green: '#22c55e',
    // Hex literal, não var(--x): estas cores alimentam fillStyle/strokeStyle
    // de <canvas> via Chart.js, e canvas não resolve variáveis CSS (ao
    // contrário de propriedades DOM) — o navegador ignora o valor inválido
    // silenciosamente e mantém preto. Mesmo motivo de js/charts.js usar hex
    // literal em CHART_COLORS em vez de var(--teal).
    teal:  '#c6f135',
    muted2: '#c4ccd4',
  };

  const CATEGORIA_LABELS = ['Resistência', 'Limiar lático', 'Esforço máximo'];
  const CATEGORIA_CORES = ['#4e9ef5', COLORS.amber, COLORS.red]; // mesma leitura de intensidade crescente usada em intensityChart

  let _charts = {}; // id -> instância Chart.js, destruída/recriada a cada load()

  function destruirCharts() {
    Object.values(_charts).forEach((c) => c && c.destroy());
    _charts = {};
  }

  // Selo neutro (sem juízo de valor) — usado em zona/peso.
  function setBadgeNeutro(el, texto) {
    el.textContent = texto;
    el.style.background = 'transparent';
    el.style.color = COLORS.muted2;
  }

  // Selo verde/vermelho (alta/baixa) — só Volume/Tempo/Altimetria.
  function setBadgeDirecao(el, metrica) {
    const cor = metrica.direcao === 'alta' ? COLORS.green : (metrica.direcao === 'baixa' ? COLORS.red : COLORS.muted2);
    const seta = metrica.direcao === 'alta' ? '▲' : (metrica.direcao === 'baixa' ? '▼' : '—');
    // percentual é null quando o período anterior foi 0 (divisão por zero
    // evitada) — mostra o delta absoluto em vez de deixar a seta sem número.
    const pct = metrica.percentual != null ? Math.abs(metrica.percentual) + '%' : '+' + Math.round(Math.abs(metrica.delta) * 10) / 10;
    el.textContent = [seta, pct].filter(Boolean).join(' ');
    el.style.background = cor + '20';
    el.style.color = cor;
  }

  function barraAgrupada(canvasId, atual, anterior, cor) {
    const el = $(canvasId);
    if (!el) return;
    _charts[canvasId] = new Chart(el.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Anterior', 'Atual'],
        datasets: [{ data: [anterior, atual], backgroundColor: cor, borderRadius: 6, maxBarThickness: 48 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  function barraEmpilhadaZona(zonaAtual, zonaAnterior) {
    const el = $('compZonaChart');
    if (!el) return;
    const paraHoras = (seg) => Math.round((seg / 3600) * 10) / 10;
    _charts.compZonaChart = new Chart(el.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Anterior', 'Atual'],
        datasets: [
          { label: CATEGORIA_LABELS[0], data: [paraHoras(zonaAnterior.resistencia), paraHoras(zonaAtual.resistencia)], backgroundColor: CATEGORIA_CORES[0] },
          { label: CATEGORIA_LABELS[1], data: [paraHoras(zonaAnterior.limiarLatico), paraHoras(zonaAtual.limiarLatico)], backgroundColor: CATEGORIA_CORES[1] },
          { label: CATEGORIA_LABELS[2], data: [paraHoras(zonaAnterior.esforcoMaximo), paraHoras(zonaAtual.esforcoMaximo)], backgroundColor: CATEGORIA_CORES[2] },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'horas', font: { size: 10 } } },
        },
      },
    });
  }

  function linhaPeso(dadosPeso) {
    const card = $('compPesoCard');
    const badge = $('compPesoVariacao');
    if (!dadosPeso || !dadosPeso.ok) {
      if (card) card.hidden = true;
      return;
    }
    if (card) card.hidden = false;
    const el = $('compPesoChart');
    if (!el) return;

    const pontos = dadosPeso.pontos;
    const primeiro = pontos[0].peso;
    const ultimo = pontos[pontos.length - 1].peso;
    setBadgeNeutro(badge, (ultimo - primeiro >= 0 ? '+' : '') + (ultimo - primeiro).toFixed(1) + ' kg');

    const annotationPlugin = window['chartjs-plugin-annotation'];
    const fronteiraIdx = pontos.findIndex((p) => p.data >= dadosPeso.fronteira);

    _charts.compPesoChart = new Chart(el.getContext('2d'), {
      type: 'line',
      data: {
        labels: pontos.map((p) => p.data),
        datasets: [{
          data: pontos.map((p) => p.peso),
          borderColor: COLORS.teal,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          // O UMD do chartjs-plugin-annotation se auto-registra em Chart
          // global assim que o <script> carrega (é assim que o bundle da
          // CDN funciona, não há como evitar sem um build step) — mas só
          // tem efeito aqui: nenhum outro gráfico da página (weightChart,
          // intensityChart, etc.) define options.plugins.annotation, então
          // nenhum deles ganha anotação nenhuma.
          annotation: annotationPlugin && fronteiraIdx > 0 ? {
            annotations: {
              fronteira: {
                type: 'line',
                xMin: fronteiraIdx,
                xMax: fronteiraIdx,
                borderColor: COLORS.muted2,
                borderWidth: 1,
                borderDash: [4, 4],
              },
            },
          } : undefined,
        },
        scales: { x: { ticks: { maxTicksLimit: 6 } } },
      },
    });
  }

  function renderCards(r) {
    setBadgeDirecao($('compVolumeBadge'), r.volume);
    setBadgeDirecao($('compTempoBadge'), r.tempo);
    setBadgeDirecao($('compAltimetriaBadge'), r.altimetria);
    setBadgeNeutro($('compZonaVariacao'), 'variação por categoria');
  }

  function renderCharts(r) {
    destruirCharts();
    barraAgrupada('compVolumeChart', Math.round(r.volume.atual), Math.round(r.volume.anterior), COLORS.teal);
    barraAgrupada('compTempoChart', Math.round(r.tempo.atual * 10) / 10, Math.round(r.tempo.anterior * 10) / 10, COLORS.teal);
    barraAgrupada('compAltimetriaChart', Math.round(r.altimetria.atual), Math.round(r.altimetria.anterior), COLORS.teal);
    barraEmpilhadaZona(r.zona.atual, r.zona.anterior);
    linhaPeso(r.peso);
  }

  async function load() {
    const empty   = $('comparative-performance-empty');
    const content = $('comparative-performance-content');
    if (!empty || !content) return;

    try {
      const [unified, zoneDist, weights] = await Promise.all([
        window.Api.get('/activities/unified?days=61').catch(() => ({ items: [] })),
        window.Api.get('/garmin/zone-distribution-by-activity?days=61').catch(() => ({ items: [] })),
        window.Api.get('/weights').catch(() => []),
      ]);

      const resultado = window.ComparativePerformance.comparar({
        activities: (unified && unified.items) || [],
        zoneItems:  (zoneDist && zoneDist.items) || [],
        weights:    (weights || []).filter((w) => w.fonte === 'garmin'),
      });

      if (!resultado.ok) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;
      renderCards(resultado);
      renderCharts(resultado);
    } catch (err) {
      console.error('[comparative-performance]', err);
      empty.hidden = false;
      content.hidden = true;
    }
  }

  window.ComparativePerformanceUI = { load };
})();
