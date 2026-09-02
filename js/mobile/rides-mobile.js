/* ═══════════════════════════════════════════════════════════════════════
   PASSEIOS (mobile) — faixa de previsão de 7 dias + lista cronológica.
   Acessível pela aba "Mais"; não tem tab própria.

   Não é a grade de mês do desktop de propósito: 7 colunas em 390px ficam
   ilegíveis. A lista cobre o mesmo dado com chips "Próximos"/"Anteriores".

   js/rides.js NÃO é carregado aqui — ele é todo amarrado aos ids do
   index.html (rides-month-grid, rides-weather-strip…). O que se reaproveita
   são as regras, não o DOM: PLAN_SPEED + estimateRideTimeMin para o tempo
   estimado, weeklyDates para a recorrência, a mesma rota
   /api/weather/forecast (proxy do Open-Meteo, evita CORS) e
   js/core/weather-rating.js para o dia da previsão e a condição para pedal
   — a mesma cascata de limiares que a faixa de clima do desktop usa.

   A coleção `rides` NÃO entra no boot (ver COLECOES em boot.js): carrega
   na primeira visita.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-passeios';
  const { esc, fmtNum } = MShell;

  // Mesmas velocidades de planejamento do desktop (js/rides.js:24).
  const PLAN_SPEED = { baixa: 22, media: 25, alta: 20 };
  const DIFICULDADE = { baixa: 'Leve', media: 'Moderado', alta: 'Pesado' };
  const WEEKDAY_PT  = WeatherRating.WEEKDAY_PT;

  // Cache da previsão com o mesmo TTL do desktop — dados diários mudam
  // pouco depois das 06h e a tela é revisitada com frequência.
  const WEATHER_TTL_MS = 60 * 60 * 1000;
  let _wx = null, _wxTs = 0;

  let ridesCarregadas = false;
  let filtro = 'proximos';

  /* ── Helpers ─────────────────────────────────────────────────────── */

  function clampWeeks(v) {
    const n = parseInt(v, 10);
    return Math.max(1, Math.min(52, isFinite(n) ? n : 1));
  }

  function weeklyDates(baseISO, n) {
    const base = new Date(baseISO + 'T12:00:00');
    if (isNaN(base.getTime())) return [];
    const out = [];
    for (let k = 1; k <= clampWeeks(n); k++) {
      const d = new Date(base);
      d.setDate(d.getDate() + 7 * k);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function fmtDayMonth(iso) {
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d.getTime()) ? iso
      : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function computeEstimate(distKm, elevM, dificuldade) {
    if (!distKm || distKm <= 0) return '';
    const speed = PLAN_SPEED[dificuldade] || 25;
    const { movTimeMin } = window.Utils.estimateRideTimeMin({ dist: distKm, speed, elev: elevM });
    const total = Math.round(movTimeMin);
    const h = Math.floor(total / 60), m = total % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`;
  }

  /* ── Previsão do tempo ───────────────────────────────────────────── */

  // dateISO → dia completo + condição. Monta o dia inteiro (e não só quatro
  // campos) porque WeatherRating.rating precisa de tSens, rajada, chuvaMm e
  // uv para decidir os alertas críticos.
  function weatherPorData() {
    const map = {};
    if (!_wx || !_wx.time) return map;
    _wx.time.forEach((iso, i) => {
      const day = WeatherRating.buildDay(_wx, i);
      day.esf = WeatherRating.rating(day);
      map[iso] = day;
    });
    return map;
  }

  function renderWeather() {
    const el = document.getElementById('m-passeios-wx');
    if (!el) return;
    if (!_wx || !_wx.time) {
      el.innerHTML = '<div class="m-empty" style="padding:14px">Previsão indisponível.</div>';
      return;
    }
    const mapa = weatherPorData();
    // A barra colorida carrega a condição para pedal. O rótulo por extenso
    // ("Baixo-Médio", "⚠ Vento perigoso") não cabe em ~40px de coluna, então
    // vive no sheet de detalhe que o toque abre.
    el.innerHTML = _wx.time.slice(0, 7).map((iso, i) => {
      const w = mapa[iso] || {};
      const esf = w.esf || {};
      return `<button class="m-wx-day${i === 0 ? ' is-today' : ''}" type="button"
                      data-dia="${escAttr(iso)}"
                      aria-label="${escAttr(`${w.wd || ''} ${w.dm || ''} — ${esf.label || ''}`)}">
        <span class="m-micro">${esc(i === 0 ? 'hoje' : (w.wd || ''))}</span>
        <i class="fa-solid ${esc(w.icon || 'fa-question')}"></i>
        <span class="m-wx-t">${esc(w.tMax == null ? '—' : `${w.tMax}°`)}</span>
        <span class="m-micro">${esc(w.tMin == null ? '' : `${w.tMin}°`)}</span>
        <span class="m-micro m-wx-rain">${esc(w.chuva ? `${w.chuva}%` : '')}</span>
        <span class="m-wx-esf" style="background:var(--${esc(esf.token || 'muted')})"></span>
      </button>`;
    }).join('');

    el.onclick = (e) => {
      const btn = e.target.closest('[data-dia]');
      if (!btn) return;
      const dia = weatherPorData()[btn.dataset.dia];
      if (dia) abrirDetalheClima(dia);
    };
  }

  // Mesmo conteúdo do openWeatherDetail do desktop (js/rides.js), em sheet:
  // css/mobile-sheet.css transforma qualquer Modals.open em bottom sheet.
  function abrirDetalheClima(day) {
    const esf = day.esf || {};
    const data = new Date(day.dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long',
    });
    const linha = (icon, k, v, token) => `
      <div class="m-prow">
        <span class="m-prow-key"><i class="fa-solid ${esc(icon)}"></i> ${esc(k)}</span>
        <span class="m-prow-val" style="font-size:15px${token ? `;color:var(--${esc(token)})` : ''}">${esc(v)}</span>
      </div>`;
    const hora = (iso) => iso
      ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '—';

    Modals.open({
      tag: 'Previsão detalhada',
      title: data.charAt(0).toUpperCase() + data.slice(1),
      bodyHTML: `
        <div class="m-cond" data-token="${escAttr(esf.token || 'muted')}">
          <div class="m-cond-label">${esc(esf.label || '—')}</div>
          ${esf.alert ? `<p class="m-micro" style="text-transform:none;letter-spacing:0;font-size:12px">
            ${esc(esf.alert)}</p>` : ''}
        </div>
        ${linha(day.icon, 'Condição', `${day.tMax}° / ${day.tMin}°`)}
        ${day.tSens != null ? linha('fa-temperature-half', 'Sensação térmica',
          `${day.tSens}°${day.tSensMin != null ? ` / ${day.tSensMin}°` : ''}`) : ''}
        ${linha('fa-droplet', 'Chance de chuva', `${day.chuva}%`)}
        ${linha('fa-cloud-rain', 'Chuva acumulada', `${(day.chuvaMm || 0).toFixed(1)} mm`)}
        ${linha('fa-wind', 'Vento máximo', `${Math.round(day.vento)} km/h`)}
        ${day.rajada != null ? linha('fa-tornado', 'Rajadas', `${Math.round(day.rajada)} km/h`,
          day.rajada > 40 ? 'red' : '') : ''}
        ${day.uv != null ? linha('fa-sun', 'Índice UV', String(Math.round(day.uv)),
          day.uv >= 8 ? 'amber' : '') : ''}
        ${linha('fa-sun', 'Nascer do sol', hora(day.sunrise))}
        ${linha('fa-moon', 'Pôr do sol', hora(day.sunset))}
      `,
      actions: [{ label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() }],
    });
  }

  async function loadWeather() {
    if (_wx && (Date.now() - _wxTs) < WEATHER_TTL_MS) { renderWeather(); return; }
    try {
      const daily = await Api.get('/weather/forecast');
      if (!daily || !daily.time) throw new Error('Resposta inválida');
      _wx = daily; _wxTs = Date.now();
    } catch (e) {
      console.warn('[rides-mobile] weather', e);
      _wx = null;
    }
    renderWeather();
  }

  /* ── Lista ───────────────────────────────────────────────────────── */

  function cardHTML(r, mapa) {
    const d = new Date(r.data + 'T12:00:00');
    const w = mapa[r.data];
    const km = r.distancia ? `${fmtNum(r.distancia, 1)} km` : '';
    const partes = [km, r.altitude ? `${r.altitude} m` : '', DIFICULDADE[r.dificuldade] || '']
      .filter(Boolean).join(' · ');

    return `<div class="m-ride" data-id="${escAttr(r.id)}">
      <div class="m-ride-head">
        <div style="min-width:0">
          <div class="m-micro" style="color:var(--lime)">
            ${esc(WEEKDAY_PT[d.getDay()].toUpperCase())} ${esc(MShell.fmtDate(r.data))}${
              r.horaInicio ? ` · ${esc(r.horaInicio)}` : ''}
          </div>
          <div class="m-act-title">${esc(r.destino || 'Sem destino')}</div>
          <div class="m-sub">${esc(partes || '—')}${
            r.tempoEstimado ? ` · ~${esc(r.tempoEstimado)}` : ''}</div>
        </div>
        ${w ? `<div class="m-ride-wx">
                 <i class="fa-solid ${esc(w.icon || 'fa-question')}"></i>
                 <span class="m-micro">${esc(w.tMax == null ? '' : `${w.tMax}°`)}</span>
                 <span class="m-wx-esf" style="background:var(--${esc((w.esf || {}).token || 'muted')})"></span>
               </div>` : ''}
      </div>
      ${r.notas ? `<p class="m-ride-notas">${esc(r.notas)}</p>` : ''}
      <div class="m-ride-acts">
        <button class="m-link" type="button" data-act="edit">
          <i class="fa-solid fa-pen"></i> Editar</button>
        <button class="m-link" type="button" data-act="del" style="color:var(--red)">
          <i class="fa-solid fa-trash"></i> Excluir</button>
      </div>
    </div>`;
  }

  function renderLista() {
    const el = document.getElementById('m-passeios-lista');
    if (!el) return;

    const hoje  = window.tbToday();
    const todos = Storage.getRides().filter(r => r && r.data);
    const lista = filtro === 'proximos'
      ? todos.filter(r => r.data >= hoje).sort((a, b) => a.data.localeCompare(b.data))
      : todos.filter(r => r.data < hoje).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 20);

    const mapa = weatherPorData();
    el.innerHTML = lista.length
      ? lista.map(r => cardHTML(r, mapa)).join('')
      : `<div class="m-empty">${filtro === 'proximos'
          ? 'Nenhum passeio planejado.<br>Toque em + para adicionar.'
          : 'Nenhum passeio anterior.'}</div>`;
  }

  function onListaClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.m-ride')?.dataset.id;
    const ride = Storage.getRides().find(r => r.id === id);
    if (!ride) return;

    if (btn.dataset.act === 'edit') abrirSheet(ride);
    else confirmarExclusao(ride);
  }

  async function confirmarExclusao(ride) {
    const ok = await Modals.confirm({
      title: 'Excluir passeio?',
      message: `"${ride.destino || 'Sem destino'}" em ${fmtDayMonth(ride.data)} será removido.`,
      confirmLabel: 'Excluir', danger: true,
    });
    if (!ok) return;
    Storage.deleteRide(ride.id);
    if (window.toast) toast('Passeio excluído');
    renderLista();
  }

  /* ── Sheet de criar/editar ───────────────────────────────────────── */

  function abrirSheet(ride) {
    const isEdit = !!ride;
    const r = ride || {
      data: window.tbToday(), destino: '', distancia: '', altitude: '',
      horaInicio: '', tempoEstimado: '', dificuldade: 'media', notas: '',
    };

    Modals.open({
      tag: isEdit ? 'Editar passeio' : 'Novo passeio',
      title: isEdit ? (r.destino || 'Sem destino') : 'Adicionar passeio',
      bodyHTML: `
        <div class="field">
          <label class="field-label" for="mr-destino">Destino</label>
          <input id="mr-destino" class="field-input" type="text"
                 value="${escAttr(r.destino)}" placeholder="Ex.: Serra da Mantiqueira" />
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label" for="mr-data">Data</label>
            <input id="mr-data" class="field-input" type="date" value="${escAttr(r.data)}" />
          </div>
          <div class="field">
            <label class="field-label" for="mr-hora">Hora</label>
            <input id="mr-hora" class="field-input" type="time" value="${escAttr(r.horaInicio)}" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label" for="mr-dist">Distância (km)</label>
            <input id="mr-dist" class="field-input" type="number" inputmode="decimal"
                   min="0" step="0.1" value="${escAttr(r.distancia)}" placeholder="0,0" />
          </div>
          <div class="field">
            <label class="field-label" for="mr-alt">Altimetria (m)</label>
            <input id="mr-alt" class="field-input" type="number" inputmode="numeric"
                   min="0" step="1" value="${escAttr(r.altitude)}" placeholder="0" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label" for="mr-dif">Dificuldade</label>
            <select id="mr-dif" class="field-select">
              <option value="baixa"${r.dificuldade === 'baixa' ? ' selected' : ''}>Baixa</option>
              <option value="media"${r.dificuldade === 'media' ? ' selected' : ''}>Média</option>
              <option value="alta"${r.dificuldade === 'alta' ? ' selected' : ''}>Alta</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="mr-est">Tempo estimado</label>
            <input id="mr-est" class="field-input" type="text" readonly
                   value="${escAttr(r.tempoEstimado)}" placeholder="—" />
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="mr-notas">Observações</label>
          <textarea id="mr-notas" class="field-textarea"
                    placeholder="Roteiro, parada para água, parceiros…">${esc(r.notas)}</textarea>
        </div>
        ${isEdit ? '' : `
        <div class="field">
          <label class="m-check">
            <input type="checkbox" id="mr-recur" />
            <span>Repetir semanalmente</span>
          </label>
          <div id="mr-recur-wrap" hidden style="margin-top:10px">
            <label class="field-label" for="mr-recur-n">Por quantas semanas</label>
            <input id="mr-recur-n" class="field-input" type="number" inputmode="numeric"
                   min="1" max="52" value="4" />
            <p class="m-micro" id="mr-recur-info" style="margin-top:6px"></p>
          </div>
        </div>`}
        <p class="m-sub" id="mr-err" hidden style="color:var(--red)"></p>
      `,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: isEdit ? 'Salvar' : 'Adicionar', kind: 'primary',
          onClick: (modal) => salvar(modal, ride && ride.id) },
      ],
      onMount: (modal) => {
        const est  = modal.querySelector('#mr-est');
        const dist = modal.querySelector('#mr-dist');
        const alt  = modal.querySelector('#mr-alt');
        const dif  = modal.querySelector('#mr-dif');
        const recalc = () => {
          est.value = computeEstimate(parseFloat(dist.value) || 0, parseFloat(alt.value) || 0, dif.value);
        };
        [dist, alt, dif].forEach(el => el.addEventListener('input', recalc));
        recalc();

        const recur = modal.querySelector('#mr-recur');
        if (recur) {
          const wrap = modal.querySelector('#mr-recur-wrap');
          const nEl  = modal.querySelector('#mr-recur-n');
          const info = modal.querySelector('#mr-recur-info');
          const dataEl = modal.querySelector('#mr-data');
          const atualiza = () => {
            const n = clampWeeks(nEl.value);
            const datas = weeklyDates(dataEl.value, n).slice(0, 6).map(fmtDayMonth);
            info.textContent = datas.length
              ? `Cria ${n} cópia${n > 1 ? 's' : ''}: ${datas.join(', ')}${n > 6 ? '…' : ''}`
              : '';
          };
          recur.addEventListener('change', () => {
            wrap.hidden = !recur.checked;
            if (recur.checked) atualiza();
          });
          nEl.addEventListener('input', atualiza);
          dataEl.addEventListener('input', () => { if (recur.checked) atualiza(); });
        }
      },
    });
  }

  function salvar(modal, rideId) {
    const v = (id) => modal.querySelector('#' + id).value.trim();
    const num = (id) => {
      const x = parseFloat(modal.querySelector('#' + id).value);
      return isFinite(x) ? x : 0;
    };

    const dados = {
      data:          v('mr-data'),
      destino:       v('mr-destino'),
      distancia:     num('mr-dist'),
      altitude:      Math.round(num('mr-alt')),
      horaInicio:    v('mr-hora'),
      tempoEstimado: v('mr-est'),
      dificuldade:   v('mr-dif'),
      notas:         v('mr-notas'),
    };

    const err = modal.querySelector('#mr-err');
    const falha = !dados.destino ? 'Informe o destino.'
      : !dados.data ? 'Informe a data.'
      : isNaN(new Date(dados.data).getTime()) ? 'Data inválida.' : null;
    if (falha) { err.textContent = falha; err.hidden = false; return; }

    if (rideId) {
      Storage.updateRide(rideId, dados);
      if (window.toast) toast('Passeio atualizado');
    } else {
      Storage.addRide(dados);
      const recur = modal.querySelector('#mr-recur');
      if (recur && recur.checked) {
        const extras = weeklyDates(dados.data, clampWeeks(modal.querySelector('#mr-recur-n').value));
        extras.forEach(iso => Storage.addRide({ ...dados, data: iso }));
        if (window.toast) toast(`Passeio + ${extras.length} recorrência${extras.length > 1 ? 's' : ''}`);
      } else if (window.toast) {
        toast('Passeio adicionado');
      }
    }

    Modals.close();
    // Criar um passeio futuro pode mudar o filtro relevante.
    if (dados.data >= window.tbToday()) filtro = 'proximos';
    render();
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  function render() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    view.innerHTML = `
      <div class="m-wx" id="m-passeios-wx">
        <div class="m-empty" style="padding:14px;border:0">Consultando previsão…</div>
      </div>

      <div class="m-chiprow" id="m-passeios-filtro">
        <button class="m-chip${filtro === 'proximos' ? ' is-active' : ''}" type="button"
                data-filtro="proximos">Próximos</button>
        <button class="m-chip${filtro === 'anteriores' ? ' is-active' : ''}" type="button"
                data-filtro="anteriores">Anteriores</button>
      </div>

      <div id="m-passeios-lista"></div>
    `;

    document.getElementById('m-passeios-filtro').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filtro]');
      if (!btn || btn.dataset.filtro === filtro) return;
      filtro = btn.dataset.filtro;
      document.querySelectorAll('#m-passeios-filtro .m-chip').forEach(c =>
        c.classList.toggle('is-active', c.dataset.filtro === filtro));
      renderLista();
    });

    document.getElementById('m-passeios-lista').addEventListener('click', onListaClick);

    renderWeather();
    renderLista();
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    if (!ridesCarregadas) {
      view.innerHTML = '<div class="m-empty">Carregando passeios…</div>';
      try {
        await Storage.load(['rides']);
        ridesCarregadas = true;
      } catch (e) {
        console.error('[rides-mobile] rides', e);
      }
    }
    render();
    loadWeather().then(renderLista);   // o ícone do card depende da previsão
  }

  MRouter.register({
    slug: 'passeios',
    viewId: VIEW_ID,
    tab: 'mais',
    label: 'Passeios',
    onEnter: () => {
      MShell.setHeader({
        eyebrow: 'Planejamento', title: 'PASSEIOS', back: 'mais',
        actions: `<button class="m-iconbtn" type="button" id="m-passeios-add"
                     aria-label="Novo passeio"><i class="fa-solid fa-plus"></i></button>`,
      });
      document.getElementById('m-passeios-add')?.addEventListener('click', () => abrirSheet(null));
      load();
    },
  });
})();
