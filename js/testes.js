/* ═══════════════════════════════════════════════════════════════════════
   TESTES (TEMPORÁRIO) — propostas de novos gráficos para Sono e HRV.
   Renderiza variações a partir de /api/garmin/health para validação visual.
   ⚠️ Seção descartável: remover (e o módulo) depois de escolher os gráficos.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);
  const _charts = {};

  const COLORS = {
    deep:   '#4e9ef5',
    light:  '#7c5cff',
    rem:    '#22c55e',
    line:   '#c6f135',
    amber:  '#f5d523',
    red:    '#f0523a',
    muted2: '#9299a8',
    grid:   '#252830',
  };

  const hours = (s) => (s == null ? null : +(s / 3600).toFixed(2));
  const mmdd  = (iso) => (iso || '').slice(5);

  // Média móvel simples de N pontos (ignora nulos na janela)
  function movingAvg(arr, n) {
    return arr.map((_, i) => {
      const win = arr.slice(Math.max(0, i - n + 1), i + 1).filter(v => v != null && isFinite(v));
      return win.length ? +(win.reduce((s, v) => s + v, 0) / win.length).toFixed(1) : null;
    });
  }

  const baseOpts = (extra = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, labels: { color: COLORS.muted2, boxWidth: 12, padding: 10, font: { size: 11 } } },
      tooltip: { enabled: true },
    },
    scales: {
      x: { ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } },
      y: { ticks: { color: COLORS.muted2 }, grid: { color: COLORS.grid } },
    },
    ...extra,
  });

  function destroy(id) { if (_charts[id]) { _charts[id].destroy(); _charts[id] = null; } }

  function mk(id, cfg) {
    const canvas = $(id);
    if (!canvas || !window.Chart) return;
    destroy(id);
    _charts[id] = new Chart(canvas, cfg);
  }

  // ── SONO ──────────────────────────────────────────────────────────────
  function renderSono(health30) {
    const labels = health30.map(h => mmdd(h.data));

    // S1 — Composição do sono (barras empilhadas: deep + light + rem)
    mk('t-sleep-stack', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Profundo', data: health30.map(h => hours(h.sono_deep_s)),  backgroundColor: COLORS.deep,  stack: 's' },
          { label: 'Leve',     data: health30.map(h => hours(h.sono_light_s)), backgroundColor: COLORS.light, stack: 's' },
          { label: 'REM',      data: health30.map(h => hours(h.sono_rem_s)),   backgroundColor: COLORS.rem,   stack: 's' },
        ],
      },
      options: baseOpts({
        scales: {
          x: { stacked: true, ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } },
          y: { stacked: true, ticks: { color: COLORS.muted2, callback: v => v + ' h' }, grid: { color: COLORS.grid } },
        },
      }),
    });

    // S2 — Sono profundo (barras) + média móvel 7 noites (linha)
    const deepH = health30.map(h => hours(h.sono_deep_s));
    mk('t-sleep-deep', {
      data: {
        labels,
        datasets: [
          { type: 'bar',  label: 'Sono profundo', data: deepH, backgroundColor: 'rgba(78,158,245,0.55)', borderColor: COLORS.deep, borderWidth: 1, borderRadius: 3 },
          { type: 'line', label: 'Média 7 noites', data: movingAvg(deepH, 7), borderColor: COLORS.line, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
        ],
      },
      options: baseOpts({ scales: { x: { ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } }, y: { ticks: { color: COLORS.muted2, callback: v => v + ' h' }, grid: { color: COLORS.grid } } } }),
    });

    // S3 — % de sono profundo sobre o total, com faixa de referência (13–23%)
    const pct = health30.map(h => (h.sono_total_s && h.sono_deep_s) ? +((h.sono_deep_s / h.sono_total_s) * 100).toFixed(1) : null);
    mk('t-sleep-pct', {
      data: {
        labels,
        datasets: [
          { type: 'line', label: '% profundo', data: pct, borderColor: COLORS.deep, backgroundColor: 'rgba(78,158,245,0.15)', borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
          { type: 'line', label: 'Ideal máx (23%)', data: labels.map(() => 23), borderColor: COLORS.muted2, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
          { type: 'line', label: 'Ideal mín (13%)', data: labels.map(() => 13), borderColor: COLORS.muted2, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: baseOpts({ scales: { x: { ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } }, y: { ticks: { color: COLORS.muted2, callback: v => v + '%' }, grid: { color: COLORS.grid }, suggestedMin: 0, suggestedMax: 35 } } }),
    });
  }

  // ── HRV ───────────────────────────────────────────────────────────────
  function renderHrv(health30) {
    const labels = health30.map(h => mmdd(h.data));
    const noite  = health30.map(h => h.hrv_noite_avg ?? null);

    // H1 — HRV noturno + baseline semanal do Garmin
    mk('t-hrv-baseline', {
      data: {
        labels,
        datasets: [
          { type: 'line', label: 'HRV noturno', data: noite, borderColor: COLORS.line, backgroundColor: 'rgba(198,241,53,0.12)', borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
          { type: 'line', label: 'Baseline semanal', data: health30.map(h => h.hrv_semanal_avg ?? null), borderColor: COLORS.amber, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.3 },
        ],
      },
      options: baseOpts({ scales: { x: { ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } }, y: { ticks: { color: COLORS.muted2, callback: v => v + ' ms' }, grid: { color: COLORS.grid } } } }),
    });

    // H2 — HRV noturno × sono profundo (dispersão)
    const pts = health30
      .filter(h => h.hrv_noite_avg != null && h.sono_deep_s != null)
      .map(h => ({ x: hours(h.sono_deep_s), y: h.hrv_noite_avg }));
    mk('t-hrv-scatter', {
      type: 'scatter',
      data: { datasets: [{ label: 'HRV × sono profundo', data: pts, backgroundColor: 'rgba(34,197,94,0.7)', borderColor: COLORS.rem, pointRadius: 5, pointHoverRadius: 7 }] },
      options: baseOpts({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} ms · ${c.parsed.x} h profundo` } } },
        scales: {
          x: { title: { display: true, text: 'Sono profundo (h)', color: COLORS.muted2 }, ticks: { color: COLORS.muted2 }, grid: { color: COLORS.grid } },
          y: { title: { display: true, text: 'HRV (ms)', color: COLORS.muted2 }, ticks: { color: COLORS.muted2 }, grid: { color: COLORS.grid } },
        },
      }),
    });

    // H3 — HRV noturno vs média móvel 7 noites (desvio do próprio baseline)
    mk('t-hrv-ma', {
      data: {
        labels,
        datasets: [
          { type: 'bar',  label: 'HRV noturno', data: noite, backgroundColor: 'rgba(198,241,53,0.4)', borderColor: COLORS.line, borderWidth: 1, borderRadius: 3 },
          { type: 'line', label: 'Média 7 noites', data: movingAvg(noite, 7), borderColor: COLORS.amber, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
        ],
      },
      options: baseOpts({ scales: { x: { ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } }, y: { ticks: { color: COLORS.muted2, callback: v => v + ' ms' }, grid: { color: COLORS.grid } } } }),
    });
  }

  async function load() {
    const empty = $('testes-empty');
    try {
      const health = await window.Api.get('/garmin/health?days=60').catch(() => []);
      const arr = Array.isArray(health) ? [...health].sort((a, b) => a.data.localeCompare(b.data)) : [];
      const last30 = arr.slice(-30);
      if (last30.length === 0) {
        if (empty) { empty.hidden = false; empty.textContent = 'Sem dados de saúde do Garmin para exibir.'; }
        return;
      }
      if (empty) empty.hidden = true;
      renderSono(last30);
      renderHrv(last30);
    } catch (err) {
      console.error('[testes]', err);
      if (empty) { empty.hidden = false; empty.textContent = 'Falha ao carregar dados de teste.'; }
    }
  }

  window.Testes = { load };
})();
