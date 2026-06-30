/* ═══════════════════════════════════════════════════════════════════════
   HEATMAP — heat-map de atividade dos últimos 90 dias (Fase 5a)
   Renderiza grid estilo GitHub contributions na seção Perfil.
   Cores: bike=teal, fisico=amber, alongamento=blue, multi=purple,
   vazio=surface2.
   Totais: % dias ativos, sequência atual e recorde em SEMANAS treinando
   (semana "vale" com ≥ 2 dias ativos; semana = domingo→sábado).
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

  const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']; // dom→sáb (domingo como início da semana)

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

  function addDaysISO(iso, delta) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  // Domingo (início da semana) da data ISO informada.
  function weekStartISO(iso) {
    const d = new Date(iso + 'T12:00:00');
    return addDaysISO(iso, -d.getDay()); // getDay(): 0=dom
  }

  function calcStreaks(days, dayMap) {
    // Sequência por SEMANAS treinando: uma semana "vale" com ≥ 2 dias ativos.
    // Visão histórica: percorre TODAS as datas do training_log (não apenas a
    // janela de 91 dias exibida no grid).
    const MIN_DIAS = 2;
    const semanas = {}; // weekISO -> nº de dias ativos
    for (const iso of Object.keys(dayMap)) {
      const wk = weekStartISO(iso);
      semanas[wk] = (semanas[wk] || 0) + 1;
    }
    const qualifica = (wk) => (semanas[wk] || 0) >= MIN_DIAS;
    const prevWeek = (wk) => addDaysISO(wk, -7);

    // RECORDE — maior nº de semanas consecutivas qualificadas no histórico.
    const wks = Object.keys(semanas).filter(qualifica).sort();
    let record = 0, run = 0, prev = null;
    for (const wk of wks) {
      run = (prev && prevWeek(wk) === prev) ? run + 1 : 1;
      record = Math.max(record, run);
      prev = wk;
    }

    // SEQ. ATUAL — conta para trás a partir da semana corrente. Se a semana
    // atual ainda não qualifica, começa pela anterior (não quebra).
    const todayISO = new Date(); todayISO.setHours(12, 0, 0, 0);
    let cursor = weekStartISO(todayISO.toISOString().slice(0, 10));
    if (!qualifica(cursor)) cursor = prevWeek(cursor);
    let current = 0;
    while (qualifica(cursor)) { current++; cursor = prevWeek(cursor); }

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
      `<span class="heatmap-stat"><strong>${current}</strong> sem. seguidas</span>` +
      `<span class="heatmap-stat"><strong>${record}</strong> recorde (sem)</span>`;

    // Rótulos de dias da semana (coluna fixa à esquerda)
    wdEl.innerHTML = WEEKDAY_LABELS
      .map(l => `<div class="heatmap-wd">${l}</div>`)
      .join('');

    // Grid: primeira célula = início de semana (domingo) do dia mais antigo
    const firstDay = new Date(days[0] + 'T12:00:00');
    const startDow = firstDay.getDay(); // dom=0 … sáb=6 (domingo como início da semana)

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
