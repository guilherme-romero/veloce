/* ═══════════════════════════════════════════════════════════════════════
   INSIGHTS (tela 03 do handoff) — alerta de sobrecarga, CTL/ATL/VO₂/HRV,
   curva carga×fadiga de 8 semanas e rosca de tempo por zona.

   Os números vêm de js/core/metrics.js — as MESMAS funções que o desktop
   usa, então CTL/ATL/TSB batem dígito a dígito entre as duas telas.

   Os gráficos são criados no onEnter (um canvas em view escondida nasce
   0×0) e destruídos no onLeave.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-insights';
  const { esc, fmtNum, mChart } = MShell;

  let charts = [];
  const ZONA_COR = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
  const ZONA_HEX = ['#3b82f6', '#e5c024', '#22c55e', '#ef4444', '#a855f7'];

  function destroyCharts() {
    charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    charts = [];
  }

  function kpi(label, value, unit, sub, token) {
    return `<div class="m-kpi">
      <span class="m-eyebrow">${esc(label)}</span>
      <div class="m-kpi-value">
        <span class="m-num"${token ? ` style="color:var(--${esc(token)})"` : ''}>${esc(value)}</span>
        ${unit ? `<span class="m-unit">${esc(unit)}</span>` : ''}
      </div>
      <div class="m-sub">${esc(sub)}</div>
    </div>`;
  }

  function skeleton() {
    return `
      <div id="m-ins-alert"></div>
      <div class="m-kpigrid" id="m-ins-kpis"></div>

      <div class="m-card">
        <div class="m-card-head">
          <span class="m-eyebrow">Carga × fadiga · 8 sem.</span>
          <span class="m-sub">
            <span style="color:var(--lime)">■</span> carga
            <span style="color:var(--magenta);margin-left:8px">■</span> fadiga
          </span>
        </div>
        <div class="m-chart"><canvas id="m-ins-load"></canvas></div>
      </div>

      <div class="m-card">
        <div class="m-card-head"><span class="m-eyebrow">Tempo por zona · 30 dias</span></div>
        <div id="m-ins-zonas"></div>
      </div>
    `;
  }

  function renderAlerta(tsb) {
    const el = document.getElementById('m-ins-alert');
    if (!el) return;
    // Só o regime de sobrecarga (TSB ≤ -20) vira superfície colorida cheia —
    // é a única da tela, conforme a regra de cor do handoff.
    if (tsb == null || tsb > -20) { el.innerHTML = ''; return; }
    const { status, msg } = Metrics.tsbStatus(tsb);
    el.innerHTML = `<div class="m-alert">
      <div class="m-alert-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div style="flex:1;min-width:0">
        <div class="m-title">${esc(status.toUpperCase())} — PRIORIZE RECUPERAÇÃO</div>
        <p style="font-size:12px;margin-top:8px">${esc(msg)}</p>
      </div>
      <div style="text-align:right;flex:none">
        <div class="m-num m-num-lg" style="color:var(--bg)">${esc(String(Math.round(tsb)))}</div>
        <div class="m-micro" style="color:var(--bg)">TSB hoje</div>
      </div>
    </div>`;
  }

  function renderKpis({ ctl, atl, tsb, vo2, hrv }) {
    const el = document.getElementById('m-ins-kpis');
    if (!el) return;
    const st = tsb == null ? null : Metrics.tsbStatus(tsb);
    el.innerHTML =
      kpi('Carga (CTL)', ctl == null ? '—' : fmtNum(ctl), '', 'forma de base') +
      kpi('Fadiga (ATL)', atl == null ? '—' : fmtNum(atl), '',
          st ? st.status.toLowerCase() : '—',
          st && st.token === 'red' ? 'magenta' : '') +
      kpi('VO₂ máx',
          vo2 && vo2.latest && vo2.latest.value != null ? fmtNum(vo2.latest.value) : '—',
          'ml/kg',
          vo2 && vo2.latest && vo2.latest.date
            ? `medido em ${MShell.fmtDate(vo2.latest.date)}` : 'sem dado Garmin') +
      kpi('HRV noturno', hrv == null ? '—' : String(Math.round(hrv)), 'ms', 'média 7 dias');
  }

  // Carga (CTL) × fadiga (ATL) por semana, a partir das séries diárias de 60
  // dias que calcTSBMetrics devolve — mesma fonte do gráfico do desktop.
  function renderLoadChart(ctlSerie, atlSerie) {
    const canvas = document.getElementById('m-ins-load');
    if (!canvas || !ctlSerie.length) return;

    const semanas = 8;
    const porSemana = (serie) => {
      const out = [];
      for (let s = semanas - 1; s >= 0; s--) {
        const fim = serie.length - s * 7;
        out.push(fim > 0 ? +serie[fim - 1].toFixed(1) : null);
      }
      return out;
    };
    const labels = Array.from({ length: semanas }, (_, i) => `S${i + 1}`);

    const c = mChart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { data: porSemana(ctlSerie), borderColor: '#c6f135', borderWidth: 2, tension: .35 },
          { data: porSemana(atlSerie), borderColor: '#ec3a8b', borderWidth: 2, tension: .35 },
        ],
      },
      options: {
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8b95a1', font: { size: 9 } } },
          y: { grid: { color: '#1c2128' }, border: { display: false },
               ticks: { color: '#8b95a1', font: { size: 9 }, maxTicksLimit: 4 } },
        },
      },
    });
    if (c) charts.push(c);
  }

  // Legenda em HTML à direita da rosca (handoff): fora do canvas, o texto
  // não briga com o espaço do gráfico em 390px.
  function renderZonas(dist) {
    const el = document.getElementById('m-ins-zonas');
    if (!el) return;
    const seg   = (dist && dist.segundosPorZona) || [];
    const total = (dist && dist.totalSegundos) || 0;

    if (!total) {
      el.innerHTML = `<div class="m-empty">Sem dados de zona de FC nos últimos 30 dias.</div>`;
      return;
    }

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:130px;height:130px;flex:none;position:relative">
          <canvas id="m-ins-zone"></canvas>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:7px">
          ${seg.slice(0, 5).map((s, i) => {
            const pct = Math.round((s / total) * 100);
            return `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
              <span style="width:10px;height:10px;border-radius:3px;background:${ZONA_COR[i]};flex:none"></span>
              <span style="color:var(--muted)">Z${i + 1}</span>
              <b style="margin-left:auto">${pct}%</b>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    const c = mChart(document.getElementById('m-ins-zone'), {
      type: 'doughnut',
      data: {
        labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
        datasets: [{
          data: seg.slice(0, 5),
          backgroundColor: ZONA_HEX,
          borderColor: '#14181d',
          borderWidth: 2,
        }],
      },
      options: {
        cutout: '62%',
        plugins: {
          tooltip: { callbacks: { label: (c2) => {
            const pct = Math.round((c2.parsed / total) * 100);
            return `${c2.label}: ${pct}% · ${Math.round(c2.parsed / 60)} min`;
          } } },
        },
      },
    });
    if (c) charts.push(c);
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    view.innerHTML = skeleton();
    destroyCharts();

    const user = (window.Storage && Storage.getUser && Storage.getUser()) || {};
    const fcMax = Metrics.calcFCMax(user);

    const [acts, health, vo2, dist] = await Promise.all([
      Api.get('/activities/unified?days=180').catch(() => ({ items: [] })),
      Api.get('/garmin/health?days=60').catch(() => []),
      Api.get('/garmin/vo2max').catch(() => null),
      Api.get('/garmin/zone-distribution?days=30').catch(() => null),
    ]);

    const items = (acts && acts.items) || [];
    let ctl = null, atl = null, tsb = null, ctlSerie = [], atlSerie = [];
    if (items.length && fcMax) {
      ({ ctl, atl, tsb, ctlSerie, atlSerie } = Metrics.calcTSBMetrics(items, fcMax));
    }

    // HRV: média dos últimos 7 registros noturnos disponíveis.
    let hrv = null;
    if (Array.isArray(health) && health.length) {
      const vals = health.map(h => h.hrv_noite_avg).filter(v => v != null && isFinite(v)).slice(-7);
      if (vals.length) hrv = vals.reduce((s, v) => s + v, 0) / vals.length;
    }

    renderAlerta(tsb);
    renderKpis({ ctl, atl, tsb, vo2, hrv });
    renderLoadChart(ctlSerie, atlSerie);
    renderZonas(dist);
  }

  MRouter.register({
    slug: 'insights',
    viewId: VIEW_ID,
    label: 'Insights',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Análise de carga', title: 'INSIGHTS DE TREINO' });
      load();
    },
    onLeave: destroyCharts,
  });
})();
