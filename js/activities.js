/* ═══════════════════════════════════════════════════════════════════════
   ACTIVITIES — dashboard consolidado (Strava hoje, Garmin no futuro)
   - Card "Última atividade" + mini-mapa via polyline
   - Semana atual vs. semana anterior
   - Gráfico de volume mensal (6 meses)
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);
  let _map = null, _volumeChart = null;

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
  const fmtKm    = (m) => (m == null ? '—' : (m / 1000).toFixed(1).replace('.', ',') + ' km');
  const fmtTime  = (s) => {
    if (s == null) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
  };
  const fmtElev  = (m) => (m == null ? '—' : Math.round(m) + ' m');
  const fmtDate  = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; } };

  function delta(curr, prev, fmt) {
    if (prev === 0 && curr === 0) return { txt: '—', cls: '' };
    if (prev === 0)               return { txt: '+nova', cls: 'up' };
    const pct = ((curr - prev) / prev) * 100;
    const sign = pct >= 0 ? '▲ ' : '▼ ';
    const cls  = pct >= 0 ? 'up' : 'down';
    return { txt: sign + Math.abs(pct).toFixed(0) + '%', cls };
  }

  // ── ISO week helpers (segunda como inicio) ─────────────────────
  function weekStart(d) {
    const date = new Date(d);
    const day  = (date.getDay() + 6) % 7; // seg=0..dom=6
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day);
    return date;
  }

  function bucketByWeek(activities) {
    const now = new Date();
    const thisWeekStart = weekStart(now);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const acc = (start, end) => activities.reduce((a, x) => {
      const d = new Date(x.inicio);
      if (d >= start && d < end) {
        a.km    += (x.distanciaKm || 0);
        a.time  += (x.tempoMovS   || 0);
        a.elev  += (x.elevacaoM   || 0);
        a.count += 1;
      }
      return a;
    }, { km: 0, time: 0, elev: 0, count: 0 });
    return {
      curr: acc(thisWeekStart, new Date(thisWeekStart.getTime() + 7 * 86400_000)),
      prev: acc(lastWeekStart, thisWeekStart),
    };
  }

  function bucketByMonth(activities, months = 6) {
    const buckets = [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                     label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
                     km: 0, count: 0, elev: 0 });
    }
    const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
    activities.forEach(x => {
      const d = new Date(x.inicio);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (byKey[key]) {
        byKey[key].km    += (x.distanciaKm || 0);
        byKey[key].count += 1;
        byKey[key].elev  += (x.elevacaoM || 0);
      }
    });
    return buckets;
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
        `<div><span class="lv">${fmtKm(act.distanciaKm * 1000)}</span><span class="ll">distância</span></div>` +
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
    const line = L.polyline(pts, { color: '#fc4c02', weight: 3 }).addTo(_map);
    _map.fitBounds(line.getBounds(), { padding: [10, 10] });
  }

  function renderWeek(bucket) {
    $('week-km').textContent     = bucket.curr.km.toFixed(1).replace('.', ',');
    $('week-time').textContent   = fmtTime(bucket.curr.time);
    $('week-elev').textContent   = Math.round(bucket.curr.elev) + ' m';
    $('week-count').textContent  = bucket.curr.count;

    const dKm   = delta(bucket.curr.km,    bucket.prev.km);
    const dTime = delta(bucket.curr.time,  bucket.prev.time);
    const dElev = delta(bucket.curr.elev,  bucket.prev.elev);
    const dCnt  = delta(bucket.curr.count, bucket.prev.count);

    const apply = (id, d) => { const el = $(id); el.textContent = d.txt; el.className = 'week-stat-delta ' + d.cls; };
    apply('week-km-delta',    dKm);
    apply('week-time-delta',  dTime);
    apply('week-elev-delta',  dElev);
    apply('week-count-delta', dCnt);
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
            backgroundColor: 'rgba(20,217,184,0.5)',
            borderColor: '#14d9b8',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y',
            order: 3,
          },
          {
            type: 'bar',
            label: 'Atividades',
            data: buckets.map(b => b.count),
            backgroundColor: 'rgba(155,123,255,0.45)',
            borderColor: '#9b7bff',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'yCount',
            order: 2,
          },
          {
            type: 'line',
            label: 'Elevação (m)',
            data: buckets.map(b => Math.round(b.elev)),
            borderColor: '#f5923a',
            backgroundColor: 'rgba(245,146,58,0.15)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#f5923a',
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
          tooltip: { callbacks: { label: (ctx) => {
            const v = ctx.parsed.y;
            if (ctx.dataset.label === 'Distância (km)') return `${v} km`;
            if (ctx.dataset.label === 'Elevação (m)')   return `${v} m`;
            return `${v} atividade${v === 1 ? '' : 's'}`;
          } } },
        },
        scales: {
          y:      { beginAtZero: true, position: 'left',  ticks: { color: '#9299a8', callback: v => v + ' km' }, grid: { color: '#252830' } },
          yElev:  { beginAtZero: true, position: 'right', ticks: { color: '#f5923a', callback: v => v + ' m' }, grid: { drawOnChartArea: false } },
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
      const resp = await window.Api.get('/activities/unified?days=180');
      const combined = (resp && resp.items) || [];

      if (combined.length === 0) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;

      const last = combined[0];
      // Polyline so existe pra Strava por enquanto
      if (last.fonte === 'strava') {
        try {
          const detail = await window.Api.get('/strava/activity/' + last.id);
          last.polyline = detail.polyline;
        } catch (_) {}
      }

      renderLastActivity(last);
      renderWeek(bucketByWeek(combined));
      renderVolume(bucketByMonth(combined, 6));
      renderVolumeTraining(combined);
      renderLast5(combined);
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

  function reviewDiscard(id) {
    if (!confirm('Descartar este registro? A bike sairá deste dia e o sync não voltará a importá-la.')) return;
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
    if (window.toast) window.toast('Registro descartado', 'success');
    renderReview();
    if (window.Rides?.render) Rides.render();
  }

  // ── Volume de treino (Fase 5c) ──────────────────────────────────
  let _weeklyChart = null, _zoneChart = null;

  function getWeekStart(d) {
    const date = new Date(d);
    const dow = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dow);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function renderVolumeTraining(acts) {
    const card = $('volume-training-card');
    if (!card || !window.Chart) return;
    if (!acts || acts.length === 0) { card.hidden = true; return; }

    card.hidden = false;

    // KM e tempo totais
    const totalKm   = acts.reduce((s, a) => s + (a.distanciaKm || 0), 0);
    const totalMovS  = acts.reduce((s, a) => s + (a.tempoMovS || 0), 0);
    const totalElevM = acts.reduce((s, a) => s + (a.elevacaoM || 0), 0);
    const h = Math.floor(totalMovS / 3600), m = Math.floor((totalMovS % 3600) / 60);

    const statsEl = $('volume-training-stats');
    if (statsEl) {
      statsEl.innerHTML =
        `<div class="vt-stat"><strong>${totalKm.toFixed(0)} km</strong><span>total</span></div>` +
        `<div class="vt-stat"><strong>${h}h${String(m).padStart(2,'0')}</strong><span>em movimento</span></div>` +
        `<div class="vt-stat"><strong>${totalElevM.toFixed(0)} m</strong><span>elevação</span></div>` +
        `<div class="vt-stat"><strong>${acts.length}</strong><span>atividades</span></div>`;
    }

    // Km por semana (12 semanas)
    const weeks = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const ws = getWeekStart(new Date(now.getTime() - i * 7 * 86400_000));
      const we = new Date(ws.getTime() + 7 * 86400_000);
      const label = ws.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
      const km = acts
        .filter(a => { const d = new Date(a.inicio); return d >= ws && d < we; })
        .reduce((s, a) => s + (a.distanciaKm || 0), 0);
      weeks.push({ label, km: +km.toFixed(1) });
    }

    const kmCanvas = $('weeklyKmChart');
    if (kmCanvas) {
      if (_weeklyChart) _weeklyChart.destroy();
      _weeklyChart = new Chart(kmCanvas, {
        type: 'bar',
        data: {
          labels: weeks.map(w => w.label),
          datasets: [{ data: weeks.map(w => w.km), backgroundColor: 'rgba(20,217,184,0.45)', borderColor: '#14d9b8', borderWidth: 1, borderRadius: 3 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + ' km' } } },
          scales: {
            y: { beginAtZero: true, ticks: { color: '#9299a8', callback: v => v + ' km' }, grid: { color: '#252830' } },
            x: { ticks: { color: '#9299a8', maxRotation: 45 }, grid: { display: false } },
          },
        },
      });
    }

    // Zonas FC
    const user = window.Storage ? Storage.getUser() : {};
    const fcMax = user.fcMax || (user.dataNascimento ? 220 - Math.floor((Date.now() - new Date(user.dataNascimento).getTime()) / (365.25 * 86400_000)) : null);
    const zoneCanvas = $('zoneDistChart');
    if (zoneCanvas && fcMax) {
      const ZONES = (window.FC_ZONES || []).filter(z => z.max !== Infinity);
      const zoneCounts = ZONES.map(() => 0);
      let withFC = 0;
      acts.forEach(a => {
        if (!a.fcMedia) return;
        withFC++;
        const pct = a.fcMedia / fcMax;
        const zi = ZONES.findIndex(z => pct < z.max);
        if (zi >= 0) zoneCounts[zi]++;
      });
      if (withFC > 0) {
        if (_zoneChart) _zoneChart.destroy();
        _zoneChart = new Chart(zoneCanvas, {
          type: 'doughnut',
          data: {
            labels: ZONES.map(z => z.label),
            datasets: [{ data: zoneCounts, backgroundColor: ZONES.map(z => z.color), borderWidth: 0 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { color: '#9299a8', boxWidth: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => `${c.label}: ${c.raw} atividades` } },
            },
          },
        });
      } else {
        if (_zoneChart) { _zoneChart.destroy(); _zoneChart = null; }
        zoneCanvas.parentElement.innerHTML = '<div class="vt-chart-label">Distribuição por zona FC</div><div style="color:var(--muted2);font-size:12px;padding:20px 0;text-align:center;">Sem dados de FC nas atividades importadas.</div>';
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Últimas 5 atividades (Fase 9.1)
  // ──────────────────────────────────────────────────────────────
  const _last5Maps = new Map(); // id → { map: L.Map, bounds: L.LatLngBounds } (para destruir/refitBounds)
  let _last5Token = 0;          // incrementado a cada render — promises de renders antigos descartam

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

  // Barra de distribuição de tempo por zona de FC (item 5).
  // Reusa as cores de window.FC_ZONES (Z1..Z5 → índices 0..4).
  function renderZoneBar(zones) {
    const list = (zones || []).filter(z => (z.segundos || 0) > 0);
    const total = list.reduce((s, z) => s + (z.segundos || 0), 0);
    if (!total) return '<div class="last5-zones-empty">Sem dados de zona de FC nesta atividade.</div>';
    const COLORS = window.FC_ZONES || [];
    const colorFor = (z) => (COLORS[(z.zona || 1) - 1] || {}).color || 'var(--muted2)';
    const segs = list.map(z => {
      const pct = (z.segundos / total) * 100;
      return `<div class="last5-zone-seg" style="width:${pct.toFixed(1)}%;background:${colorFor(z)}" title="Z${z.zona}: ${Math.round(pct)}%"></div>`;
    }).join('');
    const legend = list.map(z => {
      const pct = Math.round((z.segundos / total) * 100);
      return `<span class="last5-zone-key"><span class="last5-zone-dot" style="background:${colorFor(z)}"></span>Z${z.zona} ${pct}%</span>`;
    }).join('');
    return `<div class="last5-zones-label">Distribuição por zona de FC</div>
      <div class="last5-zone-bar">${segs}</div>
      <div class="last5-zone-legend">${legend}</div>`;
  }

  function renderLast5(acts) {
    const card = $('last5-card');
    const list = $('last5-list');
    if (!card || !list) return;

    // Token deste render — promises em voo de renders antigos serão descartadas
    const myToken = ++_last5Token;

    // Destrói mapas anteriores para evitar leak
    _last5Maps.forEach(({ map }) => { try { map.remove(); } catch (_) {} });
    _last5Maps.clear();

    const top5 = (acts || []).slice(0, 5);
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
            <div class="last5-meta">${esc(l5DataLong(a.data))} · ${esc(a.tipo || 'Ride')}</div>
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
        zEl.innerHTML = renderZoneBar(res && res.zones);
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
