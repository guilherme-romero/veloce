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
                     km: 0 });
    }
    const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
    activities.forEach(x => {
      const d = new Date(x.inicio);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (byKey[key]) byKey[key].km += (x.distanciaKm || 0);
    });
    return buckets;
  }

  // ── Renders ─────────────────────────────────────────────────────
  function renderLastActivity(act) {
    const body = $('last-activity-body');
    const esc  = window.esc || (s => String(s || ''));
    body.innerHTML =
      `<div class="last-activity-title">${esc(act.nome || 'Atividade')}</div>` +
      `<div class="last-activity-meta">${esc(fmtDate(act.inicio))} · ${esc(act.tipo || 'Ride')}</div>` +
      '<div class="last-activity-stats">' +
        `<div><span class="lv">${fmtKm(act.distanciaKm * 1000)}</span><span class="ll">distância</span></div>` +
        `<div><span class="lv">${fmtTime(act.tempoMovS)}</span><span class="ll">movimento</span></div>` +
        `<div><span class="lv">${fmtElev(act.elevacaoM)}</span><span class="ll">elevação</span></div>` +
        `<div><span class="lv">${act.velMediaKmh != null ? act.velMediaKmh.toFixed(1).replace('.', ',') + ' km/h' : '—'}</span><span class="ll">vel. média</span></div>` +
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
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [{
          data: buckets.map(b => +b.km.toFixed(1)),
          backgroundColor: 'rgba(20,217,184,0.5)',
          borderColor: '#14d9b8',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} km` } } },
        scales: {
          y: { beginAtZero: true, ticks: { color: '#9299a8', callback: v => v + ' km' }, grid: { color: '#252830' } },
          x: { ticks: { color: '#9299a8' }, grid: { display: false } },
        },
      },
    });
  }

  async function load() {
    const empty   = $('activities-empty');
    const content = $('activities-content');
    if (!empty || !content) return;

    try {
      const acts = await window.Api.get('/strava/activities?days=180');
      if (!acts || acts.length === 0) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      // Atividade mais recente = primeira (a rota retorna ORDER BY DESC)
      // Precisamos puxar a polyline do payload bruto via novo endpoint? Por enquanto, fica sem mapa
      // se nao houver polyline embutida. Ajustaremos abaixo se necessario.
      const last = acts[0];
      empty.hidden = true;
      content.hidden = false;

      // Tenta enriquecer last com polyline via /strava/activities-detail (fallback: sem mapa)
      try {
        const detail = await window.Api.get('/strava/activity/' + last.id);
        last.polyline = detail.polyline;
      } catch (_) { /* sem mapa */ }

      renderLastActivity(last);
      renderWeek(bucketByWeek(acts));
      renderVolume(bucketByMonth(acts, 6));
    } catch (err) {
      console.error('[activities]', err);
      empty.textContent = 'Falha ao carregar atividades.';
      empty.hidden = false;
      content.hidden = true;
    }
  }

  window.Activities = { load };
})();
