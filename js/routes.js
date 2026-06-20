/* ═══════════════════════════════════════════════════════════════════════
   ROUTES — análise de rotas GPX com mapa, perfil de elevação,
   calculadora de tempo e previsão do tempo (Open-Meteo)
═══════════════════════════════════════════════════════════════════════ */

let _leafletMap       = null;
let _leafletPolyline  = null;
let _elevationChart   = null;
let _currentRoute     = null;
let _kmMarkers        = [];
let _endpointMarkers  = [];   // marcadores início e fim

// Tile layers (criados uma vez)
let _osmLayer     = null;
let _topoLayer    = null;
let _satLayer     = null;
let _layerControl = null;

/* ── Init ─────────────────────────────────────────────────────────────── */
function initRoutes() {
  const fileInput = document.getElementById('gpx-file-input');
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadGPXFile(file);
    fileInput.value = '';
  });

  const zone = document.getElementById('routes-upload');
  if (zone) {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.gpx')) loadGPXFile(file);
      else toast('Use um arquivo .gpx', { kind: 'error' });
    });
  }

  document.getElementById('btn-calcular')   ?.addEventListener('click', calcularTempo);
  document.getElementById('btn-plan-ride')  ?.addEventListener('click', planRide);
  document.getElementById('btn-save-route') ?.addEventListener('click', salvarRota);
  document.getElementById('btn-clear-route')?.addEventListener('click', limparRota);

  const calcData = document.getElementById('calc-data');
  if (calcData) calcData.value = tbToday();

  renderSavedRoutes();
}

/* ── Carregar arquivo GPX ─────────────────────────────────────────────── */
async function loadGPXFile(file) {
  try {
    const text = await file.text();
    const result = parseGPX(text);
    if (!result || result.waypoints.length < 2) {
      toast('GPX inválido ou sem pontos de track', { kind: 'error' });
      return;
    }
    _currentRoute = { ...result, nome: file.name.replace(/\.gpx$/i, '') };
    showAnalysis(_currentRoute);
    toast(`Rota carregada: ${result.stats.distancia.toFixed(1)} km`);
  } catch (err) {
    console.error('[Routes]', err);
    toast('Erro ao ler arquivo GPX: ' + err.message, { kind: 'error' });
  }
}

/* ── Exibir análise ──────────────────────────────────────────────────── */
function showAnalysis(route) {
  document.getElementById('routes-upload')  ?.classList.add('hidden');
  document.getElementById('routes-analysis')?.classList.remove('hidden');

  document.getElementById('stat-distancia')  .textContent = route.stats.distancia.toFixed(1) + ' km';
  document.getElementById('stat-desnivel-pos').textContent = route.stats.desnivelPos + ' m';
  document.getElementById('stat-desnivel-neg').textContent = route.stats.desnivelNeg + ' m';
  document.getElementById('stat-alt-max')    .textContent = route.stats.altMax + ' m';

  initOrUpdateMap(route.waypoints);
  renderElevationChart(route.waypoints);
}

/* ── Mapa Leaflet ────────────────────────────────────────────────────── */
function initOrUpdateMap(waypoints) {
  if (typeof L === 'undefined') {
    document.getElementById('routes-map').innerHTML =
      '<p style="padding:16px;color:var(--muted);text-align:center">Mapa indisponível offline.</p>';
    return;
  }

  const coords = waypoints.map(p => [p.lat, p.lon]);

  if (!_leafletMap) {
    _osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    });
    _topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      maxZoom: 17,
    });
    _satLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    });

    _leafletMap = L.map('routes-map', { layers: [_osmLayer] });

    _layerControl = document.createElement('div');
    _layerControl.className = 'map-layer-control';
    _layerControl.innerHTML =
      '<button class="active" data-layer="osm">Padrão</button>' +
      '<button data-layer="topo">Topo</button>' +
      '<button data-layer="sat">Satélite</button>';
    _leafletMap.getContainer().appendChild(_layerControl);
    _layerControl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-layer]');
      if (!btn) return;
      const layer = btn.dataset.layer;
      [['osm', _osmLayer], ['topo', _topoLayer], ['sat', _satLayer]].forEach(([k, l]) => {
        if (k === layer) { if (!_leafletMap.hasLayer(l)) _leafletMap.addLayer(l); }
        else             { if (_leafletMap.hasLayer(l))  _leafletMap.removeLayer(l); }
      });
      _layerControl.querySelectorAll('[data-layer]').forEach(b => b.classList.toggle('active', b === btn));
    });
  }

  // Remove polyline, marcadores de km e marcadores de extremidade anteriores
  if (_leafletPolyline) _leafletMap.removeLayer(_leafletPolyline);
  _kmMarkers.forEach(m => _leafletMap.removeLayer(m));
  _kmMarkers = [];
  _endpointMarkers.forEach(m => _leafletMap.removeLayer(m));
  _endpointMarkers = [];

  // Polyline vermelha
  _leafletPolyline = L.polyline(coords, { color: '#ef4444', weight: 3.5, opacity: 0.9 })
    .addTo(_leafletMap);

  _leafletMap.fitBounds(_leafletPolyline.getBounds(), { padding: [30, 30] });

  // Marcadores início e fim (rastreados para remoção)
  _endpointMarkers.push(
    L.circleMarker(coords[0], {
      radius: 8, fillColor: '#22c55e', color: '#0c0d10', weight: 2.5, fillOpacity: 1,
    }).bindTooltip('Início', { direction: 'top' }).addTo(_leafletMap)
  );
  _endpointMarkers.push(
    L.circleMarker(coords[coords.length - 1], {
      radius: 8, fillColor: '#ef4444', color: '#0c0d10', weight: 2.5, fillOpacity: 1,
    }).bindTooltip('Fim', { direction: 'top' }).addTo(_leafletMap)
  );

  // Marcadores de quilometragem
  addKmMarkers(waypoints);
}

function addKmMarkers(waypoints) {
  // Intervalo adaptativo: ~10 marcadores por rota, arredondado para número "bonito"
  const totalKm = _currentRoute?.stats?.distancia || 0;
  const raw     = totalKm / 10;
  const steps   = [1, 2, 5, 10, 20, 25, 50, 100];
  const interval = steps.find(s => s >= raw) || steps[steps.length - 1];

  let dist    = 0;
  let nextKm  = interval;

  for (let i = 1; i < waypoints.length; i++) {
    dist += haversine(waypoints[i - 1], waypoints[i]);
    if (dist >= nextKm) {
      const label = nextKm >= 1000 ? (nextKm / 1000) + 'k' : nextKm + 'km';
      const m = L.marker([waypoints[i].lat, waypoints[i].lon], {
        icon: L.divIcon({
          html: `<div class="km-marker">${label}</div>`,
          className: '',
          iconSize: [24, 20],
          iconAnchor: [12, 10],
        }),
        zIndexOffset: -10,
      }).addTo(_leafletMap);
      _kmMarkers.push(m);
      nextKm += interval;
    }
  }
}

/* ── Perfil de elevação (X = km) ─────────────────────────────────────── */
function renderElevationChart(waypoints) {
  const canvas = document.getElementById('elevationChart');
  if (!canvas) return;

  const step    = Math.max(1, Math.floor(waypoints.length / 200));
  const sampled = waypoints.filter((_, i) => i % step === 0);

  // Distâncias acumuladas para cada ponto amostrado
  const distances = [0];
  for (let i = 1; i < sampled.length; i++) {
    distances.push(distances[i - 1] + haversine(sampled[i - 1], sampled[i]));
  }
  const totalKm = distances[distances.length - 1];

  // Posições (índices) onde cruza cada km inteiro → usadas para linhas verticais
  const kmPositions = [];
  let nextKm = 1;
  distances.forEach((d, i) => {
    if (d >= nextKm) { kmPositions.push(i); nextKm++; }
  });

  // Labels: exibe valor em km apenas nos índices de km inteiro
  const posSet = new Set(kmPositions);
  const labels = distances.map((d, i) => {
    if (i === 0) return '0km';
    if (i === sampled.length - 1) return totalKm.toFixed(1) + 'km';
    return posSet.has(i) ? Math.round(d) + 'km' : '';
  });

  // Plugin de linhas verticais nos marcadores de km
  const kmLinesPlugin = {
    id: 'kmLines',
    afterDraw(chart) {
      const { ctx, scales: { x: xs, y: ys } } = chart;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      kmPositions.forEach(idx => {
        const xPx = xs.getPixelForValue(idx);
        ctx.beginPath();
        ctx.moveTo(xPx, ys.top);
        ctx.lineTo(xPx, ys.bottom);
        ctx.stroke();
      });
      ctx.restore();
    },
  };

  if (_elevationChart) { _elevationChart.destroy(); _elevationChart = null; }

  _elevationChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [kmLinesPlugin],
    data: {
      labels,
      datasets: [{
        data: sampled.map(p => p.ele || 0),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.07)',
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#13151a',
          borderColor: '#252830',
          borderWidth: 1,
          callbacks: {
            title: (items) => labels[items[0].dataIndex] || '',
            label: ctx => ctx.parsed.y.toFixed(0) + ' m',
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#6b7280',
            font: { size: 10, family: "'Outfit', sans-serif" },
            maxRotation: 0,
          },
          grid: { display: false },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#6b7280',
            callback: v => v + ' m',
            font: { size: 10, family: "'Outfit', sans-serif" },
          },
        },
      },
    },
  });
}

/* ── Calculadora de tempo ─────────────────────────────────────────────── */
function calcularTempo() {
  if (!_currentRoute) return;

  const vel     = parseFloat(document.getElementById('calc-velocidade').value) || 18;
  const data    = document.getElementById('calc-data').value;
  const horario = document.getElementById('calc-horario').value || '07:00';

  const { distancia, desnivelPos } = _currentRoute.stats;

  const tempoBase  = distancia / vel;
  const penalidade = (desnivelPos / 10) / 60;
  const tempoTotal = tempoBase + penalidade;

  const horas   = Math.floor(tempoTotal);
  const minutos = Math.round((tempoTotal - horas) * 60);

  let chegadaStr = '';
  if (data && horario) {
    const chegada = new Date(`${data}T${horario}:00`);
    chegada.setTime(chegada.getTime() + tempoTotal * 3_600_000);
    chegadaStr = chegada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  const resultEl = document.getElementById('calc-resultado');
  if (resultEl) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `
      <div class="calc-result-row">
        <span><i class="fa-solid fa-clock" style="color:var(--teal)"></i>&nbsp;Duração estimada</span>
        <strong>${horas}h ${String(minutos).padStart(2, '0')}min</strong>
      </div>
      ${chegadaStr ? `
      <div class="calc-result-row">
        <span><i class="fa-solid fa-flag-checkered" style="color:var(--green)"></i>&nbsp;Chegada estimada</span>
        <strong>${chegadaStr}</strong>
      </div>` : ''}
      <div class="calc-result-note">
        <i class="fa-solid fa-circle-info"></i>
        ${vel} km/h · penalidade desnível: ${Math.round(penalidade * 60)} min
        (Naismith: +1 min/10 m de subida)
      </div>
    `;
  }

  if (data && _currentRoute.waypoints.length > 0) {
    const mid = _currentRoute.waypoints[Math.floor(_currentRoute.waypoints.length / 2)];
    fetchWeather(mid.lat, mid.lon, data);
  }
}

/* ── Previsão do tempo (Open-Meteo) — modal expandido ───────────────── */
const WMO_ICON_ROUTE = {
  0:'fa-sun', 1:'fa-sun', 2:'fa-cloud-sun', 3:'fa-cloud',
  45:'fa-smog', 48:'fa-smog',
  51:'fa-cloud-sun-rain', 53:'fa-cloud-sun-rain', 55:'fa-cloud-sun-rain',
  61:'fa-cloud-rain', 63:'fa-cloud-rain', 65:'fa-cloud-showers-heavy',
  71:'fa-snowflake', 73:'fa-snowflake', 75:'fa-snowflake',
  80:'fa-cloud-rain', 81:'fa-cloud-rain', 82:'fa-cloud-showers-heavy',
  95:'fa-cloud-bolt', 96:'fa-cloud-bolt', 99:'fa-cloud-bolt',
};
function wmoIconRoute(code) { return WMO_ICON_ROUTE[code] || 'fa-cloud-sun'; }

function calcularEsforco(tMax, vento, chuva) {
  if (tMax > 38 || chuva > 60 || vento > 40) return { label: 'Alto',        color: 'var(--red)' };
  if (tMax > 35 || (chuva > 30 && vento > 20)) return { label: 'Médio-Alto', color: '#f5923a' };
  if (tMax > 30 || vento > 25 || chuva > 20) return { label: 'Médio',       color: 'var(--amber)' };
  if (tMax > 25 || vento > 15) return            { label: 'Baixo-Médio',    color: 'var(--teal)' };
  return                                          { label: 'Baixo',          color: 'var(--green)' };
}

function weatherIcon(tMax, chuva) {
  if (chuva > 50) return 'fa-cloud-rain';
  if (chuva > 20) return 'fa-cloud-sun-rain';
  if (tMax > 30)  return 'fa-sun';
  return 'fa-cloud-sun';
}

async function fetchWeather(lat, lon, dateISO) {
  const el = document.getElementById('routes-weather');
  if (!el) return;

  el.innerHTML = '<p style="color:var(--muted);font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Consultando previsão…</p>';

  try {
    const day = await window.Api.get(
      `/weather/point?lat=${lat}&lon=${lon}&date=${encodeURIComponent(dateISO)}`
    );
    if (!day || day.error) {
      el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Previsão indisponível para esta data.</p>';
      return;
    }

    const tMax   = day.temperature_2m_max   ?? 0;
    const tMin   = day.temperature_2m_min   ?? 0;
    const tSens  = day.apparent_temperature_max ?? null;
    const chuva  = day.precipitation_probability_max ?? 0;
    const chuvaM = day.precipitation_sum    ?? 0;
    const vento  = day.wind_speed_10m_max   ?? 0;
    const rajada = day.windgusts_10m_max    ?? null;
    const uv     = day.uv_index_max         ?? null;
    const sunrise = day.sunrise             || null;
    const sunset  = day.sunset              || null;
    const wmo    = day.weathercode;
    const esf    = calcularEsforco(tMax, vento, chuva);

    const escFn = window.esc || (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));

    const fmtTime = (iso) => {
      if (!iso) return '—';
      try { return new Date(String(iso).replace(' ','T').replace(/Z$/,'')).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }); }
      catch { return '—'; }
    };

    // Todos os valores numéricos são seguros; strings da API passam por escFn
    const row = (icon, label, value, color) => `
      <div class="weather-detail-row">
        <span class="weather-detail-key"><i class="fa-solid ${icon}"></i> ${label}</span>
        <span class="weather-detail-val"${color ? ` style="color:${color}"` : ''}>${escFn(value)}</span>
      </div>`;

    el.innerHTML = `
      <div class="route-weather-header">
        <span class="weather-icon-lg"><i class="fa-solid ${wmoIconRoute(wmo)}"></i></span>
        <div>
          <div class="weather-temp-lg">${Math.round(tMax)}°C <span class="weather-temp-min">/ ${Math.round(tMin)}°C mín</span></div>
          <div class="weather-esforco-badge" style="color:${esf.color}">
            <i class="fa-solid fa-gauge"></i> Esforço: <strong>${esf.label}</strong>
          </div>
        </div>
      </div>
      <div class="route-weather-grid">
        ${tSens != null ? row('fa-temperature-half', 'Sensação térmica', `${Math.round(tSens)}°C`) : ''}
        ${row('fa-droplet', 'Prob. de chuva', `${chuva}%`, chuva > 50 ? 'var(--red)' : chuva > 20 ? 'var(--amber)' : '')}
        ${row('fa-cloud-rain', 'Chuva acumulada', `${chuvaM.toFixed(1)} mm`, chuvaM > 5 ? 'var(--red)' : '')}
        ${row('fa-wind', 'Vento', `${Math.round(vento)} km/h`)}
        ${rajada != null ? row('fa-tornado', 'Rajadas', `${Math.round(rajada)} km/h`, rajada > 40 ? 'var(--red)' : rajada > 25 ? 'var(--amber)' : '') : ''}
        ${uv != null ? row('fa-sun', 'Índice UV', `${Math.round(uv)}`, uv >= 8 ? 'var(--amber)' : '') : ''}
        ${sunrise ? row('fa-sun', 'Nascer do sol', fmtTime(sunrise)) : ''}
        ${sunset  ? row('fa-moon', 'Pôr do sol',   fmtTime(sunset))  : ''}
      </div>
    `;
  } catch (err) {
    console.warn('[Routes] Weather:', err);
    el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Não foi possível consultar a previsão.</p>';
  }
}

/* ── Planejar passeio (integração com calendário de Objetivos) ────────── */
function planRide() {
  if (!_currentRoute) { toast('Nenhuma rota carregada', { kind: 'error' }); return; }

  const { distancia, desnivelPos } = _currentRoute.stats;

  // Duração estimada — usa velocidade do calculador se disponível
  const vel        = parseFloat(document.getElementById('calc-velocidade')?.value) || 18;
  const tempoTotal = distancia / vel + (desnivelPos / 10) / 60;
  const horas      = Math.floor(tempoTotal);
  const minutos    = Math.round((tempoTotal - horas) * 60);
  const duracaoStr = `${horas}h ${String(minutos).padStart(2, '0')}min`;

  // Dificuldade automática pelo desnível
  const dificuldade = desnivelPos > 900 ? 'alta' : desnivelPos > 300 ? 'media' : 'baixa';

  // Data preferencial: campo calc-data se preenchido, senão hoje
  const dataEl = document.getElementById('calc-data');
  const data   = (dataEl?.value && dataEl.value >= tbToday()) ? dataEl.value : tbToday();

  const ridePreset = {
    data,
    destino:     _currentRoute.nome || '',
    distancia:   Math.round(distancia * 10) / 10,
    altitude:    desnivelPos,
    duracao:     duracaoStr,
    dificuldade,
    nota:        0,
    notas:       '',
  };

  if (window.Rides?.openRideModal) {
    Rides.openRideModal(ridePreset);
  } else {
    toast('Seção Passeios não disponível', { kind: 'error' });
  }
}

/* ── Salvar / limpar rota ─────────────────────────────────────────────── */
function salvarRota() {
  if (!_currentRoute) return;
  const routes = Storage.getRoutes();
  if (routes.length >= 10) {
    toast('Limite de 10 rotas. Exclua uma para continuar.', { kind: 'error' });
    return;
  }
  const step    = Math.max(1, Math.floor(_currentRoute.waypoints.length / 200));
  const sampled = _currentRoute.waypoints.filter((_, i) => i % step === 0);
  Storage.addRoute({ nome: _currentRoute.nome || 'Rota sem nome', waypoints: sampled, stats: _currentRoute.stats });
  renderSavedRoutes();
  toast('Rota salva');
}

function limparRota() {
  _currentRoute = null;
  document.getElementById('routes-upload')  ?.classList.remove('hidden');
  document.getElementById('routes-analysis')?.classList.add('hidden');
  if (_leafletMap && _leafletPolyline) { _leafletMap.removeLayer(_leafletPolyline); _leafletPolyline = null; }
  _kmMarkers.forEach(m => _leafletMap?.removeLayer(m));
  _kmMarkers = [];
  _endpointMarkers.forEach(m => _leafletMap?.removeLayer(m));
  _endpointMarkers = [];
  if (_elevationChart) { _elevationChart.destroy(); _elevationChart = null; }
}

/* ── Selector de rotas salvas ─────────────────────────────────────────── */
function renderSavedRoutes() {
  const container = document.getElementById('routes-saved-controls');
  if (!container) return;
  const routes = Storage.getRoutes();
  if (routes.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <select id="saved-routes-select" class="field-select" style="min-width:160px;">
        <option value="">Rotas salvas…</option>
        ${routes.map(r => `<option value="${escAttr(r.id)}">${esc(r.nome)}</option>`).join('')}
      </select>
      <button id="btn-load-gpx-new"  class="btn btn-ghost btn-sm" type="button" title="Subir novo GPX">
        <i class="fa-solid fa-file-import"></i> Novo GPX
      </button>
      <button id="btn-delete-saved" class="btn btn-danger btn-sm" type="button" title="Excluir rota selecionada">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `;

  // Auto-carrega ao selecionar no combo
  document.getElementById('saved-routes-select')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    const r = Storage.getRoutes().find(x => x.id === id);
    if (r) { _currentRoute = { waypoints: r.waypoints, stats: r.stats, nome: r.nome }; showAnalysis(_currentRoute); }
  });

  // Botão "Novo GPX" dispara o file input existente
  document.getElementById('btn-load-gpx-new')?.addEventListener('click', () => {
    document.getElementById('gpx-file-input')?.click();
  });

  document.getElementById('btn-delete-saved')?.addEventListener('click', () => {
    const id = document.getElementById('saved-routes-select').value;
    if (!id) return;
    const r = Storage.getRoutes().find(x => x.id === id);
    if (!r) return;
    Modals.open({
      tag: 'Confirmação',
      title: 'Excluir rota?',
      bodyHTML: `<p style="color:var(--muted2);font-size:14px;line-height:1.6;">
        A rota <strong style="color:var(--text)">"${esc(r.nome)}"</strong> será removida permanentemente.
      </p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost',  onClick: () => Modals.close() },
        { label: 'Excluir',  kind: 'danger', onClick: () => {
          Storage.deleteRoute(id);
          Modals.close();
          renderSavedRoutes();
          toast('Rota excluída');
        }},
      ],
    });
  });
}

window.Routes = { init: initRoutes };
