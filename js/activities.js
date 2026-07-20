/* ═══════════════════════════════════════════════════════════════════════
   ACTIVITIES — dashboard consolidado (Strava hoje, Garmin no futuro)
   - Card "Última atividade" + mini-mapa via polyline
   - Semana atual vs. semana anterior
   - Gráfico de volume mensal (6 meses)
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);
  let _map = null, _volumeChart = null;

  // Estilo de tooltip escuro — igual ao usado nos gráficos de INSIGHTS, para
  // manter a "mini legenda flutuante" visualmente consistente entre as seções.
  const TOOLTIP_STYLE = {
    backgroundColor: 'rgba(19,21,26,0.95)',
    borderColor: '#252830',
    borderWidth: 1,
    titleColor: '#e6e8ec',
    bodyColor: '#c4c9d4',
    padding: 10,
    cornerRadius: 8,
    usePointStyle: true,
    boxWidth: 8,
    boxHeight: 8,
    boxPadding: 4,
  };

  // ── Polyline decoder (algoritmo Google) ─────────────────────────
  function decodePolyline(str) {
    const points = [];
    let index = 0, lat = 0, lng = 0;
    while (index < str.length) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }

  // ── Formatadores ────────────────────────────────────────────────
  // Recebe km (mesmo contrato de l5Km); '—' quando ausente.
  const fmtKm    = (km) => (km == null ? '—' : km.toFixed(1).replace('.', ',') + ' km');
  const fmtTime  = (s) => {
    if (s == null) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
  };
  const fmtElev  = (m) => (m == null ? '—' : Math.round(m) + ' m');
  // parseDT normaliza o timestamp p/ meio-dia local, evitando recuo de dia em
  // pedais de madrugada (start_date_local vem com "Z"). parseDT é hoisted.
  const fmtDate  = (iso) => { try { return parseDT(iso).toLocaleDateString('pt-BR'); } catch { return iso; } };

  function delta(curr, prev, fmt) {
    if (prev === 0 && curr === 0) return { txt: '—', cls: '' };
    if (prev === 0)               return { txt: '+nova', cls: 'up' };
    const pct = ((curr - prev) / prev) * 100;
    const sign = pct >= 0 ? '▲ ' : '▼ ';
    const cls  = pct >= 0 ? 'up' : 'down';
    return { txt: sign + Math.abs(pct).toFixed(0) + '%', cls };
  }

  // Normaliza timestamp Garmin ("YYYY-MM-DD HH:MM:SS") e Strava ("...Z") para Date local
  function parseDT(iso) {
    if (!iso) return new Date(NaN);
    const s = iso.replace(' ', 'T').replace(/Z$/, '');
    return new Date(s.includes('T') ? s : s + 'T12:00:00');
  }

  // ── Week helpers (domingo como inicio) ─────────────────────────
  function weekStart(d) {
    const date = new Date(d);
    const day  = date.getDay(); // 0 = domingo
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day);
    return date;
  }

  function bucketByWeek(activities) {
    const now = new Date();
    const thisWeekStart = weekStart(now);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const acc = (start, end) => {
      const r = activities.reduce((a, x) => {
        const d = parseDT(x.inicio);
        if (d >= start && d < end) {
          a.km       += (x.distanciaKm || 0);
          a.time     += (x.tempoMovS   || 0);
          a.elev     += (x.elevacaoM   || 0);
          a.calorias += (x.calorias    || 0);
          a.count    += 1;
        }
        return a;
      }, { km: 0, time: 0, elev: 0, calorias: 0, count: 0 });
      r.velMedia = r.time > 0 ? r.km / (r.time / 3600) : 0;
      return r;
    };
    return {
      curr: acc(thisWeekStart, new Date(thisWeekStart.getTime() + 7 * 86400_000)),
      prev: acc(lastWeekStart, thisWeekStart),
    };
  }

  // 12 meses (Jan–Dez) somando TODOS os anos: jan/2026 + jan/2024 = jan total.
  // Usado no filtro "Tudo" para consolidar o histórico inteiro por mês do calendário.
  function bucketByCalendarMonth(activities) {
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      const d = new Date(2000, m, 1);
      buckets.push({ key: m,
                     label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
                     km: 0, count: 0, elev: 0 });
    }
    activities.forEach(x => {
      const m = parseDT(x.inicio).getMonth();
      const b = buckets[m];
      if (b) {
        b.km    += (x.distanciaKm || 0);
        b.count += 1;
        b.elev  += (x.elevacaoM || 0);
      }
    });
    return buckets;
  }

  // 12 meses (Jan–Dez) de um ano específico, mesmo formato de bucketByCalendarMonth.
  function bucketMonthsOfYear(activities, year) {
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      const d = new Date(year, m, 1);
      buckets.push({ key: `${year}-${String(m + 1).padStart(2, '0')}`,
                     label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
                     km: 0, count: 0, elev: 0 });
    }
    const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
    activities.forEach(x => {
      const d = parseDT(x.inicio);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (byKey[key]) {
        byKey[key].km    += (x.distanciaKm || 0);
        byKey[key].count += 1;
        byKey[key].elev  += (x.elevacaoM || 0);
      }
    });
    return buckets;
  }

  // ── Filtro por ano (KPIs + Volume Mensal + lista) ───────────────
  let _histAll  = [];
  let _histYear = 'all';

  function histActsForYear() {
    if (_histYear === 'all') return _histAll;
    return _histAll.filter(a => parseDT(a.inicio).getFullYear() === _histYear);
  }

  function renderHistKpis() {
    const kpisEl = document.getElementById('hist-kpis');
    if (kpisEl) kpisEl.style.display = '';
    const acts = histActsForYear();
    const totKm   = acts.reduce((s, a) => s + (a.distanciaKm || 0), 0);
    const totS    = acts.reduce((s, a) => s + (a.tempoMovS   || 0), 0);
    const totElev = acts.reduce((s, a) => s + (a.elevacaoM   || 0), 0);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('hist-kpi-dist',  Math.round(totKm).toLocaleString('pt-BR'));
    set('hist-kpi-tempo', Math.round(totS / 3600));
    set('hist-kpi-elev',  (totElev / 1000).toFixed(1).replace('.', ','));
    set('hist-kpi-ativ',  acts.length.toLocaleString('pt-BR'));
    // Badge de período: replicada em todos os blocos que alternam pelo filtro.
    const periodo = _histYear === 'all' ? 'Total' : String(_histYear);
    ['hist-kpi-dist-tag', 'hist-kpi-tempo-tag', 'hist-kpi-elev-tag', 'hist-kpi-ativ-tag',
     'hist-tag-volume', 'hist-tag-last5'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = periodo;
    });
  }

  function renderYearChips() {
    const cont = document.getElementById('hist-year-filters');
    if (!cont) return;
    // Janela de filtros: ano atual + 2 anteriores. Anos sem dados não viram chip.
    const anoAtual = new Date().getFullYear();
    const comDados = new Set(_histAll.map(a => parseDT(a.inicio).getFullYear()));
    const years = [anoAtual, anoAtual - 1, anoAtual - 2].filter(y => comDados.has(y));
    let html = '';
    years.forEach(y => {
      html += `<button class="year-chip ${_histYear === y ? 'is-active' : ''}" data-year="${y}">${y}</button>`;
    });
    html += `<button class="year-chip ${_histYear === 'all' ? 'is-active' : ''}" data-year="all">Tudo</button>`;
    cont.innerHTML = html;
    cont.querySelectorAll('.year-chip').forEach(btn => {
      btn.onclick = () => {
        const y = btn.dataset.year;
        _histYear = (y === 'all') ? 'all' : parseInt(y, 10);
        renderYearChips();
        applyYearFilter();
      };
    });
  }

  function applyYearFilter() {
    _last5Page = 0;
    const acts = histActsForYear();
    renderHistKpis();
    renderVolume(_histYear === 'all' ? bucketByCalendarMonth(_histAll) : bucketMonthsOfYear(acts, _histYear));
    renderLast5(acts);
  }

  // ── Renders ─────────────────────────────────────────────────────
  function renderLastActivity(act) {
    const body = $('last-activity-body');
    const esc  = window.esc || (s => String(s || ''));
    const fonteBadge = act.fonte
      ? `<span class="source-badge source-${esc(act.fonte)}">${esc(act.fonte)}</span>`
      : '';
    body.innerHTML =
      `<div class="last-activity-title">${esc(act.nome || 'Atividade')} ${fonteBadge}</div>` +
      `<div class="last-activity-meta">${esc(fmtDate(act.inicio))} · ${esc(act.tipo || 'Ride')}</div>` +
      '<div class="last-activity-stats">' +
        `<div><span class="lv">${fmtKm(act.distanciaKm)}</span><span class="ll">distância</span></div>` +
        `<div><span class="lv">${fmtTime(act.tempoMovS)}</span><span class="ll">movimento</span></div>` +
        `<div><span class="lv">${fmtElev(act.elevacaoM)}</span><span class="ll">elevação</span></div>` +
        `<div><span class="lv">${act.velMediaKmh != null ? act.velMediaKmh.toFixed(1).replace('.', ',') + ' km/h' : '—'}</span><span class="ll">vel. média</span></div>` +
        `<div><span class="lv">${l5Fc(act.fcMedia)}</span><span class="ll">FC média</span></div>` +
        `<div><span class="lv">${l5Rpm(act.cadenciaAvg)}</span><span class="ll">cadência</span></div>` +
        `<div><span class="lv">${l5Kcal(act.calorias)}</span><span class="ll">calorias</span></div>` +
      '</div>';

    const mapEl = $('last-activity-map');
    mapEl.innerHTML = '';
    if (!window.L || !act.polyline) { mapEl.classList.add('no-map'); return; }
    mapEl.classList.remove('no-map');
    const pts = decodePolyline(act.polyline);
    if (!pts.length) { mapEl.classList.add('no-map'); return; }
    if (_map) { _map.remove(); _map = null; }
    _map = L.map(mapEl, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_map);
    const lineColor = act.fonte === 'garmin' ? '#007cc3' : '#fc4c02';
    const line = L.polyline(pts, { color: lineColor, weight: 3 }).addTo(_map);
    _map.fitBounds(line.getBounds(), { padding: [10, 10] });
  }

  function renderWeek(bucket) {
    $('week-km').textContent     = bucket.curr.km.toFixed(1).replace('.', ',');
    $('week-time').textContent   = fmtTime(bucket.curr.time);
    $('week-elev').textContent   = Math.round(bucket.curr.elev) + ' m';
    $('week-count').textContent  = bucket.curr.count;

    const velEl = $('week-vel');
    if (velEl) velEl.textContent = bucket.curr.velMedia > 0 ? bucket.curr.velMedia.toFixed(1).replace('.', ',') + ' km/h' : '—';

    const calEl = $('week-cal');
    if (calEl) calEl.textContent = bucket.curr.calorias > 0 ? Math.round(bucket.curr.calorias).toLocaleString('pt-BR') + ' kcal' : '—';

    const dKm   = delta(bucket.curr.km,       bucket.prev.km);
    const dTime = delta(bucket.curr.time,     bucket.prev.time);
    const dElev = delta(bucket.curr.elev,     bucket.prev.elev);
    const dCnt  = delta(bucket.curr.count,    bucket.prev.count);
    const dVel  = delta(bucket.curr.velMedia, bucket.prev.velMedia);
    const dCal  = delta(bucket.curr.calorias, bucket.prev.calorias);

    const apply = (id, d) => { const el = $(id); if (!el) return; el.textContent = d.txt; el.className = 'week-stat-delta ' + d.cls; };
    apply('week-km-delta',    dKm);
    apply('week-time-delta',  dTime);
    apply('week-elev-delta',  dElev);
    apply('week-count-delta', dCnt);
    apply('week-vel-delta',   dVel);
    apply('week-cal-delta',   dCal);
  }

  function renderVolume(buckets) {
    const canvas = $('volumeChart');
    if (!canvas || !window.Chart) return;
    if (_volumeChart) _volumeChart.destroy();
    _volumeChart = new Chart(canvas, {
      data: {
        labels: buckets.map(b => b.label),
        datasets: [
          {
            type: 'bar',
            label: 'Distância (km)',
            data: buckets.map(b => +b.km.toFixed(1)),
            backgroundColor: 'rgba(198,241,53,0.5)',
            borderColor: '#c6f135',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y',
            order: 3,
          },
          {
            type: 'bar',
            label: 'Atividades',
            data: buckets.map(b => b.count),
            backgroundColor: 'rgba(236,58,139,0.45)',
            borderColor: '#ec3a8b',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'yCount',
            order: 2,
          },
          {
            type: 'line',
            label: 'Elevação (m)',
            data: buckets.map(b => Math.round(b.elev)),
            borderColor: '#f5d523',
            backgroundColor: 'rgba(245,213,35,0.15)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#f5d523',
            tension: 0.3,
            fill: false,
            yAxisID: 'yElev',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#9299a8', boxWidth: 12, padding: 12, font: { size: 11 } } },
          tooltip: { ...TOOLTIP_STYLE, callbacks: { label: (ctx) => {
            const v = ctx.parsed.y;
            if (ctx.dataset.label === 'Distância (km)') return `${v} km`;
            if (ctx.dataset.label === 'Elevação (m)')   return `${v} m`;
            return `${v} atividade${v === 1 ? '' : 's'}`;
          } } },
        },
        scales: {
          y:      { beginAtZero: true, position: 'left',  ticks: { color: '#9299a8', callback: v => v + ' km' }, grid: { color: '#252830' } },
          yElev:  { beginAtZero: true, position: 'right', ticks: { color: '#f5d523', callback: v => v + ' m' }, grid: { drawOnChartArea: false } },
          yCount: { display: false, beginAtZero: true },
          x:      { ticks: { color: '#9299a8' }, grid: { display: false } },
        },
      },
    });
  }

  async function load() {
    const empty   = $('activities-empty');
    const content = $('activities-content');
    if (!empty || !content) return;

    try {
      // Endpoint unificado: server-side dedupe via activity_links (Garmin > Strava)
      // ~3 anos para alimentar os filtros por ano (atual + 2 anteriores).
      const resp = await window.Api.get('/activities/unified?days=1095');
      const combined = (resp && resp.items) || [];

      // Scores de Endurance por dia (p/ exibir o ganho na lista de atividades).
      try {
        const scores = await window.Api.get('/garmin/fitness-scores?days=365');
        buildEnduranceDeltas(scores);
      } catch (_) { buildEnduranceDeltas([]); }

      if (combined.length === 0) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;

      const last = combined[0];
      // Carrega a polyline conforme a fonte — Garmin tem endpoint próprio
      // (antes só buscava p/ Strava, então o mapa sumia quando a atividade mais
      // recente vinha do Garmin, que vence a deduplicação).
      try {
        const endpoint = last.fonte === 'garmin'
          ? `/garmin/activity/${last.id}/polyline`
          : `/strava/activity/${last.id}`;
        const detail = await window.Api.get(endpoint);
        last.polyline = detail?.polyline;
      } catch (_) {}

      // Estes não filtram por ano (dados recentes): última atividade, semana
      // vs. semana passada e volume de treino das últimas 12 semanas.
      renderLastActivity(last);
      renderWeek(bucketByWeek(combined));
      renderVolumeTraining(combined);

      // KPIs + Volume Mensal + lista: filtrados pelo ano (default = mais recente).
      _histAll = combined;
      const anos = [...new Set(combined.map(a => parseDT(a.inicio).getFullYear()))]
        .filter(y => isFinite(y)).sort((a, b) => b - a);
      _histYear = anos[0] ?? 'all';
      renderYearChips();
      applyYearFilter();
    } catch (err) {
      console.error('[activities]', err);
      empty.textContent = 'Falha ao carregar atividades.';
      empty.hidden = false;
      content.hidden = true;
    }
  }

  // ── Revisão de auto-registros (Fase 4.6c) ─────────────────────
  function fmtTimeShort(s) {
    if (!s) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`;
  }

  function renderReview() {
    const card = $('review-card');
    const list = $('review-list');
    const countEl = $('review-count');
    if (!card || !list) return;

    const log = (window.Storage && Storage.getTrainingLog) ? Storage.getTrainingLog() : [];
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    // Itens com payload.bike preenchido por sync (fonte != manual) E nao confirmados manualmente
    const items = log
      .filter(e => e.data >= cutoff)
      .filter(e => e.payload?.bike && e.payload.bike.fonte && e.payload.bike.fonte !== 'manual')
      .filter(e => e.payload?.manual !== true)
      .sort((a, b) => b.data.localeCompare(a.data));

    if (countEl) countEl.textContent = items.length;
    if (items.length === 0) { card.hidden = true; return; }
    card.hidden = false;

    const esc = window.esc || (s => String(s || ''));
    list.innerHTML = items.map(e => {
      const b = e.payload.bike || {};
      const fonte = esc(b.fonte || '');
      const dataFmt = new Date(e.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      return `
        <div class="review-item" data-id="${esc(e.id)}">
          <div class="review-item-info">
            <div class="review-item-date">${esc(dataFmt)} <span class="source-badge source-${fonte}">${fonte}</span></div>
            <div class="review-item-metrics">
              ${isFinite(b.km) && b.km > 0 ? `<span><strong>${b.km}</strong> km</span>` : ''}
              ${isFinite(b.tempoMovS) && b.tempoMovS > 0 ? `<span><strong>${fmtTimeShort(b.tempoMovS)}</strong></span>` : ''}
              ${isFinite(b.elevM) && b.elevM > 0 ? `<span><strong>${Math.round(b.elevM)}</strong> m</span>` : ''}
              ${isFinite(b.fcMedia) && b.fcMedia > 0 ? `<span><strong>${Math.round(b.fcMedia)}</strong> bpm</span>` : ''}
            </div>
          </div>
          <div class="review-item-actions">
            <button type="button" class="btn btn-sm btn-primary" data-act="confirm" title="Travar como definitivo">
              <i class="fa-solid fa-check"></i>
            </button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="edit" title="Editar manualmente">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button type="button" class="btn btn-sm btn-danger" data-act="discard" title="Descartar (remove bike e bloqueia re-import)">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.review-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-act="confirm"]').onclick = () => reviewConfirm(id);
      el.querySelector('[data-act="edit"]').onclick    = () => reviewEdit(id);
      el.querySelector('[data-act="discard"]').onclick = () => reviewDiscard(id);
    });
  }

  function reviewConfirm(id) {
    const entry = Storage.getTrainingLog().find(e => e.id === id);
    if (!entry) return;
    const newPayload = { ...(entry.payload || {}), manual: true };
    Storage.updateTrainingEntry(id, { payload: newPayload });
    if (window.toast) window.toast('Confirmado — sync futuro não sobrescreverá');
    renderReview();
    if (window.Rides?.render) Rides.render();
  }

  function reviewEdit(id) {
    const entry = Storage.getTrainingLog().find(e => e.id === id);
    if (!entry) return;
    if (window.TrainingLog?.openMarkTrainingModal) {
      TrainingLog.openMarkTrainingModal(entry.data);
    }
  }

  async function reviewDiscard(id) {
    const ok = await window.Modals.confirm({
      title: 'Descartar este registro?',
      message: 'A bike sairá deste dia e o sync não voltará a importá-la.',
      confirmLabel: 'Descartar',
      danger: true,
    });
    if (!ok) return;
    const entry = Storage.getTrainingLog().find(e => e.id === id);
    if (!entry) return;
    const tipos = (entry.tipos || []).filter(t => t !== 'bike');
    const newPayload = { ...(entry.payload || {}), bike: null, bikeDiscarded: true };
    if (tipos.length === 0) {
      // Sem tipos, remove a entrada inteira
      Storage.deleteTrainingEntry(id);
    } else {
      Storage.updateTrainingEntry(id, { tipos, payload: newPayload });
    }
    if (window.toast) window.toast('Registro descartado', { kind: 'success' });
    renderReview();
    if (window.Rides?.render) Rides.render();
  }

  // ── Volume de treino (Fase 5c) ──────────────────────────────────
  let _weeklyChart = null, _zoneChart = null;
  let _zoneToken = 0; // cancela respostas de fetches antigos (padrão _last5Token)

  function renderVolumeTraining(acts) {
    const card = $('volume-training-card');
    if (!card || !window.Chart) return;
    if (!acts || acts.length === 0) { card.hidden = true; return; }

    card.hidden = false;

    // Janela de 12 semanas: tudo no card (stats, barras e zonas) usa o mesmo
    // recorte, coerente com o título. acts pode vir com ~3 anos (days=1095).
    const now = new Date();
    const firstWeekStart = weekStart(new Date(now.getTime() - 11 * 7 * 86400_000));
    const acts12 = acts.filter(a => parseDT(a.inicio) >= firstWeekStart);

    // KM e tempo totais (das 12 semanas)
    const totalKm   = acts12.reduce((s, a) => s + (a.distanciaKm || 0), 0);
    const totalMovS  = acts12.reduce((s, a) => s + (a.tempoMovS || 0), 0);
    const totalElevM = acts12.reduce((s, a) => s + (a.elevacaoM || 0), 0);
    const h = Math.floor(totalMovS / 3600), m = Math.floor((totalMovS % 3600) / 60);

    const statsEl = $('volume-training-stats');
    if (statsEl) {
      statsEl.innerHTML =
        `<div class="vt-stat"><strong>${Math.round(totalKm).toLocaleString('pt-BR')} km</strong><span>total</span></div>` +
        `<div class="vt-stat"><strong>${h}h${String(m).padStart(2,'0')}</strong><span>em movimento</span></div>` +
        `<div class="vt-stat"><strong>${Math.round(totalElevM).toLocaleString('pt-BR')} m</strong><span>elevação</span></div>` +
        `<div class="vt-stat"><strong>${acts12.length.toLocaleString('pt-BR')}</strong><span>atividades</span></div>`;
    }

    // Volume por semana (12 semanas): km + nº de atividades + elevação
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const ws = weekStart(new Date(now.getTime() - i * 7 * 86400_000));
      const we = new Date(ws.getTime() + 7 * 86400_000);
      const label = ws.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
      const inWeek = acts12.filter(a => { const d = parseDT(a.inicio); return d >= ws && d < we; });
      const km   = inWeek.reduce((s, a) => s + (a.distanciaKm || 0), 0);
      const elev = inWeek.reduce((s, a) => s + (a.elevacaoM || 0), 0);
      weeks.push({ label, km: +km.toFixed(1), count: inWeek.length, elev: Math.round(elev) });
    }

    const kmCanvas = $('weeklyKmChart');
    if (kmCanvas) {
      if (_weeklyChart) _weeklyChart.destroy();
      _weeklyChart = new Chart(kmCanvas, {
        data: {
          labels: weeks.map(w => w.label),
          datasets: [
            {
              type: 'bar', label: 'Distância (km)',
              data: weeks.map(w => w.km),
              backgroundColor: 'rgba(198,241,53,0.5)',
              // Borda âmbar na última barra (semana em curso, parcial); verde-limão nas demais.
              borderColor: weeks.map((_, i) => i === weeks.length - 1 ? '#f5d523' : '#c6f135'),
              borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 3,
            },
            {
              type: 'bar', label: 'Atividades',
              data: weeks.map(w => w.count),
              backgroundColor: 'rgba(236,58,139,0.45)', borderColor: '#ec3a8b',
              borderWidth: 1, borderRadius: 4, yAxisID: 'yCount', order: 2,
            },
            {
              type: 'line', label: 'Elevação (m)',
              data: weeks.map(w => w.elev),
              borderColor: '#f5d523', backgroundColor: 'rgba(245,213,35,0.15)',
              borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#f5d523',
              tension: 0.3, fill: false, yAxisID: 'yElev', order: 1,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, labels: { color: '#9299a8', boxWidth: 12, padding: 12, font: { size: 11 } } },
            tooltip: { ...TOOLTIP_STYLE, callbacks: { label: (ctx) => {
              const v = ctx.parsed.y;
              const emCurso = ctx.dataIndex === weeks.length - 1;
              if (ctx.dataset.label === 'Distância (km)') return `${v} km` + (emCurso ? ' (semana em curso)' : '');
              if (ctx.dataset.label === 'Elevação (m)')   return `${v} m`;
              return `${v} atividade${v === 1 ? '' : 's'}`;
            } } },
          },
          scales: {
            y:      { beginAtZero: true, position: 'left',  ticks: { color: '#9299a8', callback: v => v + ' km' }, grid: { color: '#252830' } },
            yElev:  { beginAtZero: true, position: 'right', ticks: { color: '#f5d523', callback: v => v + ' m' }, grid: { drawOnChartArea: false } },
            yCount: { display: false, beginAtZero: true },
            x:      { ticks: { color: '#9299a8', maxRotation: 45 }, grid: { display: false } },
          },
        },
      });
    }

    // Distribuição por zona FC — tempo real em zona (Garmin), mesmo padrão do
    // INSIGHTS e do Perfil. Fire-and-forget (não bloqueia stats/barras).
    renderZoneDist();
  }

  // Doughnut de zonas FC por TEMPO real em zona (segundos do Garmin), via
  // /garmin/zone-distribution. Reflete os picos (Z5 aparece) — ao contrário de
  // classificar o pedal inteiro pela FC média. Janela de 12 semanas (84 dias).
  function fmtZoneTime(seg) {
    const hh = Math.floor(seg / 3600), mm = Math.round((seg % 3600) / 60);
    return hh > 0 ? `${hh}h${String(mm).padStart(2, '0')}` : `${mm}min`;
  }

  async function renderZoneDist() {
    const zoneCanvas = $('zoneDistChart');
    if (!zoneCanvas || !window.Chart) return;
    const FC_ZONES_FALLBACK = [
      { label: 'Z1', color: '#4e9ef5', max: 0.6 }, { label: 'Z2', color: '#22c55e', max: 0.7 },
      { label: 'Z3', color: '#f5d523', max: 0.8 }, { label: 'Z4', color: '#f0523a', max: 0.9 },
      { label: 'Z5', color: '#a855f7', max: 1.0 },
    ];
    const ZONES = (window.FC_ZONES || FC_ZONES_FALLBACK).filter(z => z.max !== Infinity); // Z1..Z5

    const myToken = ++_zoneToken;
    let dist = null;
    try { dist = await window.Api.get('/garmin/zone-distribution?days=84'); } catch (_) {}
    if (myToken !== _zoneToken) return; // um render mais novo já assumiu
    const seg   = (dist && dist.segundosPorZona) || [];
    const total = (dist && dist.totalSegundos) || 0;

    if (_zoneChart) { _zoneChart.destroy(); _zoneChart = null; }
    if (!total) {
      zoneCanvas.parentElement.innerHTML = '<div class="vt-chart-label">Distribuição por zona FC</div><div style="color:var(--muted2);font-size:12px;padding:20px 0;text-align:center;">Sem dados de zona de FC do Garmin nas últimas 12 semanas.</div>';
      return;
    }

    const data = seg.slice(0, 5);
    _zoneChart = new Chart(zoneCanvas, {
      type: 'doughnut',
      data: {
        labels: ZONES.map(z => z.label),
        datasets: [{ data, backgroundColor: ZONES.map(z => z.color), borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#9299a8', boxWidth: 12, font: { size: 11 } } },
          tooltip: { ...TOOLTIP_STYLE, callbacks: { label: c => {
            const pct = total ? Math.round((c.raw / total) * 100) : 0;
            return `${c.label}: ${pct}% · ${fmtZoneTime(c.raw)}`;
          } } },
        },
      },
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Últimas 5 atividades (Fase 9.1)
  // ──────────────────────────────────────────────────────────────
  const _last5Maps = new Map(); // id → { map: L.Map, bounds: L.LatLngBounds } (para destruir/refitBounds)
  let _last5Token = 0;          // incrementado a cada render — promises de renders antigos descartam
  let _last5Page  = 0;          // página atual (0-based)
  let _last5Data  = [];         // atividades completas do ano selecionado (para paginação)

  // Ganho de Endurance por DIA (delta do endurance_score diário da Garmin).
  // NB: a API não expõe contribuição por atividade — o valor é a variação do
  // score do dia; havendo mais de uma atividade na data, reflete o ganho do dia.
  let _enduranceDelta = {};     // 'YYYY-MM-DD' → delta (inteiro, pode ser < 0)
  function buildEnduranceDeltas(scores) {
    _enduranceDelta = {};
    const rows = (Array.isArray(scores) ? scores : [])
      .filter(s => s && s.data && s.endurance_score != null)
      .sort((a, b) => a.data.localeCompare(b.data));
    let prev = null;
    for (const r of rows) {
      if (prev != null) _enduranceDelta[r.data] = r.endurance_score - prev;
      prev = r.endurance_score;
    }
  }
  function enduranceMetaHtml(dateStr) {
    const day = (dateStr || '').slice(0, 10);
    const d = _enduranceDelta[day];
    if (d == null || d === 0) return '';
    const sign = d > 0 ? '+' : '−';
    const cls  = d > 0 ? 'up' : 'down';
    // O delta é diário (uma leitura Garmin/dia); com 2+ atividades no mesmo dia o
    // ganho é do dia inteiro, não de cada pedal — sufixa "(dia)" p/ não parecer dobrado (BUG-048).
    const multiDia = (_last5Data || []).filter(a => a && (a.data || '').slice(0, 10) === day).length > 1;
    return ` · <span class="last5-endurance ${cls}">${sign}${Math.abs(d)} Endurance${multiDia ? ' (dia)' : ''}</span>`;
  }

  function l5Km(v)    { return (v == null || !isFinite(v)) ? '—' : v.toFixed(1).replace('.', ',') + ' km'; }
  function l5Hm(s)    {
    if (!s || !isFinite(s)) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
  }
  function l5Elev(v)  { return (v == null || !isFinite(v)) ? '—' : Math.round(v) + ' m'; }
  function l5Fc(v)    { return (v == null || !isFinite(v)) ? '—' : Math.round(v) + ' bpm'; }
  function l5Kcal(v)  { return (v == null || !isFinite(v)) ? '—' : Math.round(v) + ' kcal'; }
  function l5Rpm(v)   { return (v == null || !isFinite(v)) ? '—' : Math.round(v) + ' rpm'; }
  function l5Watts(v) { return (v == null || !isFinite(v)) ? '—' : Math.round(v) + ' W'; }
  function l5DataLong(iso) {
    try {
      const d = new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'));
      return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    } catch { return iso; }
  }

  // Pizza de distribuição de tempo por zona de FC (item 5).
  // Reusa as cores de window.FC_ZONES (Z1..Z5 → índices 0..4).
  // Usa conic-gradient (sem canvas/Chart.js) para caber no card.
  function renderZonePie(zones) {
    const list = (zones || []).filter(z => (z.segundos || 0) > 0);
    const total = list.reduce((s, z) => s + (z.segundos || 0), 0);
    if (!total) return '<div class="last5-zones-empty">Sem dados de zona de FC nesta atividade.</div>';
    const COLORS = window.FC_ZONES || [
      { color: '#4e9ef5' }, { color: '#22c55e' }, { color: '#f5d523' },
      { color: '#f0523a' }, { color: '#a855f7' },
    ];
    const colorFor = (z) => (COLORS[(z.zona || 1) - 1] || {}).color || 'var(--muted2)';
    let acc = 0;
    const stops = list.map(z => {
      const start = acc;
      acc += (z.segundos / total) * 100;
      return `${colorFor(z)} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
    }).join(', ');
    const legend = list.map(z => {
      const pct = Math.round((z.segundos / total) * 100);
      return `<span class="last5-zone-key"><span class="last5-zone-dot" style="background:${colorFor(z)}"></span>Z${z.zona} ${pct}%</span>`;
    }).join('');
    return `<div class="last5-zones-label">Distribuição por zona de FC</div>
      <div class="last5-zone-pie-wrap">
        <div class="last5-zone-pie" style="background:conic-gradient(${stops})"></div>
        <div class="last5-zone-legend">${legend}</div>
      </div>`;
  }

  function renderLast5(acts) {
    const card = $('last5-card');
    const list = $('last5-list');
    if (!card || !list) return;

    _last5Data = acts || [];

    const PAGE_SIZE  = 5;
    const total      = _last5Data.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _last5Page       = Math.min(_last5Page, totalPages - 1);
    const page       = _last5Page;

    // Token deste render — promises em voo de renders antigos serão descartadas
    const myToken = ++_last5Token;

    // Destrói mapas anteriores para evitar leak
    _last5Maps.forEach(({ map }) => { try { map.remove(); } catch (_) {} });
    _last5Maps.clear();

    const top5 = _last5Data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (top5.length === 0) { card.hidden = true; return; }
    card.hidden = false;

    const esc = window.esc || (s => String(s || ''));
    list.innerHTML = top5.map((a, i) => {
      const mapId = `last5-map-${i}`;
      const stats = `
        <div class="last5-stat"><strong>${l5Km(a.distanciaKm)}</strong><span>distância</span></div>
        <div class="last5-stat"><strong>${l5Hm(a.tempoMovS)}</strong><span>tempo</span></div>
        <div class="last5-stat"><strong>${l5Elev(a.elevacaoM)}</strong><span>elevação</span></div>
        <div class="last5-stat"><strong>${l5Fc(a.fcMedia)}</strong><span>FC média</span></div>
        <div class="last5-stat"><strong>${l5Kcal(a.calorias)}</strong><span>calorias</span></div>
        <div class="last5-stat"><strong>${a.wattsAvg ? l5Watts(a.wattsAvg) : l5Rpm(a.cadenciaAvg)}</strong><span>${a.wattsAvg ? 'potência' : 'cadência'}</span></div>
      `;
      const fonte = a.fonte ? `<span class="source-badge source-${esc(a.fonte)}">${esc(a.fonte)}</span>` : '';
      return `
        <div class="last5-item">
          <div id="${mapId}" class="last5-map"></div>
          <div class="last5-body">
            <div class="last5-title">${esc(a.nome || 'Atividade')} ${fonte}</div>
            <div class="last5-meta">${esc(l5DataLong(a.data))} · ${esc(a.tipo || 'Ride')}${enduranceMetaHtml(a.data)}</div>
            <div class="last5-stats">${stats}</div>
            ${a.fonte === 'garmin' && a.fcMedia ? `<div class="last5-zones" id="last5-zones-${i}"></div>` : ''}
          </div>
        </div>`;
    }).join('');

    // Carrega distribuição de zonas de FC (Garmin) — lazy + cache no backend
    top5.forEach((a, i) => {
      if (a.fonte !== 'garmin' || !a.fcMedia) return;
      const zEl = document.getElementById(`last5-zones-${i}`);
      if (!zEl) return;
      window.Api.get(`/garmin/activity/${a.id}/hr-zones`).then(res => {
        if (myToken !== _last5Token || !zEl.isConnected) return;
        zEl.innerHTML = renderZonePie(res && res.zones);
      }).catch(err => {
        if (myToken !== _last5Token) return;
        console.warn('[last5] hr-zones failed', a.id, err);
      });
    });

    // Carrega polyline assíncrona para cada um dos 5
    top5.forEach((a, i) => {
      const mapEl = document.getElementById(`last5-map-${i}`);
      if (!mapEl || !window.L) return;
      const endpoint = a.fonte === 'garmin'
        ? `/garmin/activity/${a.id}/polyline`
        : `/strava/activity/${a.id}`;
      window.Api.get(endpoint).then(res => {
        // Render mais novo já rodou ou nó saiu do DOM → descarta
        if (myToken !== _last5Token || !mapEl.isConnected) return;
        const enc = res?.polyline;
        if (!enc) { mapEl.classList.add('no-map'); return; }
        const pts = decodePolyline(enc);
        if (!pts.length) { mapEl.classList.add('no-map'); return; }
        const map = L.map(mapEl, {
          zoomControl: false, attributionControl: false,
          dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
        const color = a.fonte === 'garmin' ? '#007cc3' : '#fc4c02';
        const line = L.polyline(pts, { color, weight: 3 }).addTo(map);
        const bounds = line.getBounds();
        map.fitBounds(bounds, { padding: [8, 8] });
        _last5Maps.set(`${a.fonte}:${a.id}`, { map, bounds });
      }).catch(err => {
        if (myToken !== _last5Token) return;
        console.warn('[last5] polyline failed', a.id, err);
        mapEl.classList.add('no-map');
      });
    });

    // Paginação
    const pag = $('last5-pagination');
    if (pag) {
      if (totalPages <= 1) {
        pag.hidden = true;
      } else {
        pag.hidden = false;
        pag.innerHTML = `
          <button class="last5-pag-btn" id="last5-prev" ${page === 0 ? 'disabled' : ''}>&#8249;</button>
          <span class="last5-pag-info">${page + 1} / ${totalPages}</span>
          <button class="last5-pag-btn" id="last5-next" ${page >= totalPages - 1 ? 'disabled' : ''}>&#8250;</button>`;
        $('last5-prev').onclick = () => { _last5Page = Math.max(0, _last5Page - 1); renderLast5(_last5Data); };
        $('last5-next').onclick = () => { _last5Page = Math.min(totalPages - 1, _last5Page + 1); renderLast5(_last5Data); };
      }
    }
  }

  // Re-renderiza tiles dos mapas Leaflet (necessário quando os containers
  // foram criados em uma seção display:none — o Leaflet inicia com 0x0 e
  // os tiles só aparecem após invalidateSize() depois que a seção fica visível).
  function refreshMaps() {
    try { if (_map) _map.invalidateSize(); } catch (_) {}
    _last5Maps.forEach(({ map, bounds }) => {
      try {
        map.invalidateSize();
        if (bounds) map.fitBounds(bounds, { padding: [8, 8] });
      } catch (_) {}
    });
  }

  // Expor o trigger principal
  async function loadAndRender() {
    await load();
    renderReview();
  }

  window.Activities = { load: loadAndRender, renderReview, renderVolumeTraining, renderLast5, refreshMaps };
})();
