/* ═══════════════════════════════════════════════════════════════════════
   ATIVIDADES (tela 02 do handoff) — filtros por ano, KPIs em carrossel
   horizontal, mapa de constância, última atividade e volume mensal.

   Mesma fonte do desktop (/activities/unified) e as mesmas somas
   (ActivityStats.totals). O que muda: 4 KPIs espremidos viram carrossel, e
   o heatmap de 90 dias vira um grid compacto de 15×4.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-atividades';
  const { esc, fmtDateHora, fmtDuracao, fmtNum, mChart } = MShell;

  let _all = [];        // todas as atividades carregadas (5 anos, como o desktop)
  let _year = 'all';
  let _chart = null;
  let _loaded = false;

  const forYear = () => _year === 'all'
    ? _all
    : _all.filter(a => {
        const d = ActivityStats.parseLocalDT(a.inicio || a.data);
        return d && d.getFullYear() === _year;
      });

  function kpiCard(label, value, unit, sub) {
    return `<div class="m-kpi" style="min-width:132px">
      <span class="m-eyebrow">${esc(label)}</span>
      <div class="m-kpi-value">
        <span class="m-num">${esc(value)}</span>
        ${unit ? `<span class="m-unit">${esc(unit)}</span>` : ''}
      </div>
      <div class="m-sub">${esc(sub)}</div>
    </div>`;
  }

  function skeleton() {
    return `
      <div class="m-chiprow" id="m-act-chips"></div>
      <div class="m-hs" id="m-act-kpis"></div>

      <div class="m-card">
        <div class="m-card-head">
          <span class="m-eyebrow">Constância · 60 dias</span>
          <span class="m-sub" id="m-act-const-sub"></span>
        </div>
        <div class="m-grid15" id="m-act-const"></div>
      </div>

      <div class="m-section-head"><span class="m-eyebrow">Última atividade</span></div>
      <div id="m-act-last"></div>

      <div class="m-card">
        <div class="m-card-head">
          <span class="m-eyebrow">Volume mensal</span>
          <span class="m-sub" id="m-act-vol-tag"></span>
        </div>
        <div class="m-chart"><canvas id="m-act-volume"></canvas></div>
      </div>
    `;
  }

  function renderChips() {
    const el = document.getElementById('m-act-chips');
    if (!el) return;
    // Mesma janela do desktop: ano atual + 2 anteriores, só os que têm dados.
    const atual = new Date().getFullYear();
    const comDados = new Set(_all.map(a => {
      const d = ActivityStats.parseLocalDT(a.inicio || a.data);
      return d && d.getFullYear();
    }));
    const anos = [atual, atual - 1, atual - 2].filter(y => comDados.has(y));

    el.innerHTML = anos.map(y =>
      `<button class="m-chip ${_year === y ? 'is-active' : ''}" data-year="${y}" type="button">${y}</button>`
    ).join('') +
      `<button class="m-chip ${_year === 'all' ? 'is-active' : ''}" data-year="all" type="button">Tudo</button>`;

    el.querySelectorAll('.m-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const y = btn.dataset.year;
        _year = y === 'all' ? 'all' : parseInt(y, 10);
        renderChips();
        renderAll();
      });
    });
  }

  function renderKpis() {
    const el = document.getElementById('m-act-kpis');
    if (!el) return;
    const t = ActivityStats.totals(forYear());
    const periodo = _year === 'all' ? 'total' : String(_year);
    el.innerHTML =
      kpiCard('Distância', Math.round(t.km).toLocaleString('pt-BR'), 'km', periodo) +
      kpiCard('Tempo', Math.round(t.segs / 3600).toLocaleString('pt-BR'), 'h', periodo) +
      kpiCard('Elevação', fmtNum(t.elev / 1000, 1), 'km', periodo) +
      kpiCard('Pedaladas', t.count.toLocaleString('pt-BR'), '', periodo);
  }

  function renderConstancia() {
    const grid = document.getElementById('m-act-const');
    const sub  = document.getElementById('m-act-const-sub');
    if (!grid) return;
    const { cells, ativos, dias, pct } = ActivityStats.consistencyGrid(_all, 60);
    grid.innerHTML = cells.map(c =>
      `<div class="m-cell" data-lvl="${c.lvl}" title="${esc(c.date)}: ${esc(fmtNum(c.km, 1))} km"></div>`
    ).join('');
    if (sub) sub.textContent = `${ativos}/${dias} dias · ${Math.round(pct)}%`;
  }

  function renderLast() {
    const el = document.getElementById('m-act-last');
    if (!el) return;
    const a = forYear()[0];
    if (!a) { el.innerHTML = `<div class="m-empty">Nenhuma atividade no período.</div>`; return; }
    const km   = isFinite(a.distanciaKm) ? fmtNum(a.distanciaKm, 1) : '—';
    const vel  = isFinite(a.velMediaKmh) ? fmtNum(a.velMediaKmh, 1) : '—';
    const elev = isFinite(a.elevacaoM)   ? String(Math.round(a.elevacaoM)) : '—';
    el.innerHTML = `<div class="m-act" data-src="${esc(a.fonte || '')}">
      <div class="m-act-head">
        <div class="m-act-icon"><i class="fa-solid fa-bicycle"></i></div>
        <div style="min-width:0">
          <div class="m-act-title">${esc(a.nome || 'Atividade')}</div>
          <div class="m-sub">${esc(fmtDateHora(a.inicio || a.data))}</div>
        </div>
      </div>
      <div class="m-act-metrics">
        <div class="m-act-metric"><span class="m-num">${esc(km)}</span><span class="m-micro">km</span></div>
        <div class="m-act-metric"><span class="m-num">${esc(fmtDuracao(a.tempoMovS))}</span><span class="m-micro">tempo</span></div>
        <div class="m-act-metric" data-accent="lime"><span class="m-num">${esc(vel)}</span><span class="m-micro">km/h</span></div>
        <div class="m-act-metric" data-accent="green"><span class="m-num">${esc(elev)}</span><span class="m-micro">elev m</span></div>
      </div>
    </div>`;
  }

  function renderVolume() {
    const canvas = document.getElementById('m-act-volume');
    const tag = document.getElementById('m-act-vol-tag');
    if (!canvas) return;
    if (tag) tag.textContent = _year === 'all' ? 'todos os anos' : String(_year);

    const buckets = ActivityStats.monthlyVolume(
      _year === 'all' ? _all : forYear(),
      _year === 'all' ? null : _year
    );

    if (_chart) { _chart.destroy(); _chart = null; }
    _chart = mChart(canvas, {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [{
          data: buckets.map(b => Math.round(b.km)),
          backgroundColor: '#c6f135',
          borderRadius: 4,
          maxBarThickness: 18,
        }],
      },
      options: {
        scales: {
          x: { grid: { display: false },
               ticks: { color: '#8b95a1', font: { size: 9 }, autoSkip: true, maxTicksLimit: 12 } },
          y: { grid: { color: '#1c2128' }, border: { display: false },
               ticks: { color: '#8b95a1', font: { size: 9 }, maxTicksLimit: 4 } },
        },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.parsed.y} km` } } },
      },
    });
  }

  function renderAll() {
    renderKpis();
    renderConstancia();
    renderLast();
    renderVolume();
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    view.innerHTML = skeleton();

    if (!_loaded) {
      try {
        // Mesma janela do desktop: ~5 anos de histórico unificado.
        const resp = await Api.get('/activities/unified?days=1825');
        _all = (resp && resp.items) || [];
        _loaded = true;
        // Default = ano mais recente com dados, como no desktop.
        const anos = _all.map(a => {
          const d = ActivityStats.parseLocalDT(a.inicio || a.data);
          return d && d.getFullYear();
        }).filter(Boolean);
        if (anos.length) _year = Math.max(...anos);
      } catch (e) {
        console.error('[activities-mobile]', e);
        view.innerHTML = `<div class="m-empty">Falha ao carregar o histórico.</div>`;
        return;
      }
    }

    renderChips();
    renderAll();
  }

  MRouter.register({
    slug: 'atividades',
    aliases: ['historico'],
    viewId: VIEW_ID,
    label: 'Histórico',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Registro', title: 'HISTÓRICO DE PEDALADAS' });
      load();
    },
    // Um canvas de Chart.js sobrevive à view escondida, mas fica pendurado
    // com listener de resize: destrói na saída e recria no próximo onEnter.
    onLeave: () => { if (_chart) { _chart.destroy(); _chart = null; } },
  });
})();
