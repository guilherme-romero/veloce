/* ═══════════════════════════════════════════════════════════════════════
   HEATMAP — heat-map de atividade dos últimos 90 dias (Fase 5a)
   Renderiza grid estilo GitHub contributions na seção Perfil.
   Cores: bike=teal, fisico=amber, alongamento=blue, multi=purple,
   vazio=surface2.
   Totais: % dias ativos, sequência atual, recorde.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const TIPO_COLOR = {
    bike:        'var(--teal)',
    fisico:      'var(--amber)',
    alongamento: 'var(--blue)',
    multi:       'var(--purple)',
    none:        'var(--surface2)',
  };

  const TIPO_DIM = {
    bike:        'var(--teal-dim)',
    fisico:      'var(--amber-dim)',
    alongamento: 'var(--blue-dim)',
    multi:       'var(--purple-dim)',
    none:        'var(--surface2)',
  };

  const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  function buildDayMap() {
    const log = (window.Storage && Storage.getTrainingLog) ? Storage.getTrainingLog() : [];
    const map = {};
    log.forEach(e => {
      if (!map[e.data]) map[e.data] = { tipos: new Set(), payload: e.payload };
      (e.tipos || []).forEach(t => map[e.data].tipos.add(t));
      if (e.payload) map[e.data].payload = e.payload;
    });
    return map;
  }

  function dominantTipo(tipos) {
    const arr = [...tipos];
    if (arr.length === 0) return 'none';
    if (arr.length > 1)   return 'multi';
    return arr[0];
  }

  function calcStreaks(days, dayMap) {
    let current = 0, record = 0, run = 0;
    const today = days[days.length - 1];
    for (const d of days) {
      if (dayMap[d]) { run++; record = Math.max(record, run); }
      else           { run = 0; }
    }
    // Sequência atual (de trás pra frente até hoje)
    for (let i = days.length - 1; i >= 0; i--) {
      if (dayMap[days[i]]) current++;
      else break;
    }
    return { current, record };
  }

  function render() {
    const card    = document.getElementById('heatmap-card');
    const grid    = document.getElementById('heatmap-grid');
    const wdEl    = document.getElementById('heatmap-weekdays');
    const totals  = document.getElementById('heatmap-totals');
    if (!card || !grid) return;

    const dayMap = buildDayMap();

    // Gera lista de 91 dias (hoje + 90 anteriores)
    const days = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    for (let i = 90; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const ativos = days.filter(d => dayMap[d]).length;
    const pct    = Math.round((ativos / days.length) * 100);
    const { current, record } = calcStreaks(days, dayMap);

    if (ativos === 0) { card.style.display = 'none'; return; }
    card.style.display = '';

    // Totais
    totals.innerHTML =
      `<span class="heatmap-stat"><strong>${pct}%</strong> dias ativos</span>` +
      `<span class="heatmap-stat"><strong>${current}</strong> seq. atual</span>` +
      `<span class="heatmap-stat"><strong>${record}</strong> recorde</span>`;

    // Rótulos de dias da semana (coluna fixa à esquerda)
    wdEl.innerHTML = WEEKDAY_LABELS
      .map(l => `<div class="heatmap-wd">${l}</div>`)
      .join('');

    // Grid: primeira célula = início de semana (domingo) do dia mais antigo
    const firstDay = new Date(days[0] + 'T12:00:00');
    const startDow = firstDay.getDay(); // 0=dom

    let html = '';
    // Células vazias antes do primeiro dia
    for (let p = 0; p < startDow; p++) {
      html += '<div class="heatmap-cell heatmap-cell-pad"></div>';
    }

    days.forEach(iso => {
      const entry = dayMap[iso];
      const tipo  = entry ? dominantTipo(entry.tipos) : 'none';
      const esc   = window.esc || (s => String(s || ''));
      const b     = entry?.payload?.bike;
      const label = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
        weekday: 'short', day: '2-digit', month: 'short',
      });
      let tip = label;
      if (entry && entry.tipos.size) {
        tip += ' — ' + [...entry.tipos].map(t =>
          (window.TrainingLog?.TL_TYPES?.[t]?.label || t)
        ).join(', ');
      }
      if (b?.km)       tip += `\n${b.km} km`;
      if (b?.tempoMovS) tip += ` · ${Math.floor(b.tempoMovS/3600)}h${String(Math.floor((b.tempoMovS%3600)/60)).padStart(2,'0')}`;
      if (b?.fonte)    tip += ` (${b.fonte})`;
      const isToday = iso === days[days.length - 1];
      html += `<div class="heatmap-cell${isToday ? ' heatmap-today' : ''}" data-tipo="${tipo}" title="${esc(tip)}"></div>`;
    });

    grid.innerHTML = html;
  }

  window.Heatmap = { render };
})();
