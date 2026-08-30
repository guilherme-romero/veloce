/* ═══════════════════════════════════════════════════════════════════════
   RIDES — calendário e lista de passeios planejados
   Integrado ao Storage e ao sistema genérico de Modals do app.
═══════════════════════════════════════════════════════════════════════ */

let _ridesViewMode  = 'month';                  // 'month' | 'list'
let _ridesMonthCursor = new Date();             // mês exibido na vista calendário
let _ridesActivities = null;                    // cache das atividades unificadas (Garmin/Strava)

const DIFFICULTY = {
  baixa: { label: 'Baixa', color: 'var(--green)' },
  media: { label: 'Média', color: 'var(--amber)' },
  alta:  { label: 'Alta',  color: 'var(--red)'   },
};

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Velocidade de planejamento (km/h) por dificuldade, p/ estimar o tempo de pedal.
const PLAN_SPEED = { baixa: 22, media: 25, alta: 20 };

// Tempo estimado formatado (ex.: "2h 39min" / "45min") de dist + altimetria +
// dificuldade. Reusa o modelo compartilhado Utils.estimateRideTimeMin.
function computeRideEstimate(distKm, elevM, dificuldade) {
  if (!distKm || distKm <= 0) return '';
  const speed = PLAN_SPEED[dificuldade] || 25;
  const { movTimeMin } = window.Utils.estimateRideTimeMin({ dist: distKm, speed, elev: elevM });
  const total = Math.round(movTimeMin);
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`;
}

// Limita o nº de semanas de recorrência a [1, 52].
function clampWeeks(v) {
  const n = parseInt(v, 10);
  return Math.max(1, Math.min(52, isFinite(n) ? n : 1));
}

// Datas ISO (YYYY-MM-DD) das N semanas seguintes a partir de baseISO (exclui a
// base). Usa meio-dia local para não rolar o dia ao converter fuso.
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

// "DD/MM" a partir de ISO local.
function fmtDayMonth(iso) {
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d.getTime()) ? iso
    : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   INIT — chamado uma vez no boot do app
═══════════════════════════════════════════════════════════════════════ */
function initRides() {
  // Reseta cursor para mês atual a cada init
  _ridesMonthCursor = new Date();
  _ridesMonthCursor.setDate(1);

  // Toggle de vista
  document.getElementById('btn-view-month')?.addEventListener('click', () => switchView('month'));
  document.getElementById('btn-view-list') ?.addEventListener('click', () => switchView('list'));

  // Navegação de mês
  document.getElementById('btn-prev-month')?.addEventListener('click', () => changeMonth(-1));
  document.getElementById('btn-next-month')?.addEventListener('click', () => changeMonth(1));

  // Adicionar passeio
  document.getElementById('btn-add-ride')?.addEventListener('click', () => openRideModal(null));

  // Delegação de cliques no calendário e lista
  document.getElementById('rides-month-grid')?.addEventListener('click', handleMonthGridClick);
  document.getElementById('rides-list-grid') ?.addEventListener('click', handleListGridClick);

  // Pré-carrega clima no boot (dados ficam em cache 30 min; a faixa só
  // fica visível quando a seção é mostrada via loadWeather/showSection).
  fetchRidesWeather();
  // Pré-carrega atividades sincronizadas p/ os badges do calendário.
  fetchRidesActivities();
}

/* ═══════════════════════════════════════════════════════════════════════
   RENDER — chamado em renderAll() do app
═══════════════════════════════════════════════════════════════════════ */
function renderRides() {
  if (_ridesViewMode === 'month') renderMonthView();
  else renderListView();
}

/* ── Toggle de vista ─────────────────────────────────────────────────── */
function switchView(mode) {
  _ridesViewMode = mode;
  const monthEl = document.getElementById('rides-month');
  const listEl  = document.getElementById('rides-list');
  const btnM    = document.getElementById('btn-view-month');
  const btnL    = document.getElementById('btn-view-list');

  if (mode === 'month') {
    monthEl?.classList.remove('hidden');
    listEl ?.classList.add('hidden');
    btnM?.classList.add('active');
    btnL?.classList.remove('active');
  } else {
    monthEl?.classList.add('hidden');
    listEl ?.classList.remove('hidden');
    btnM?.classList.remove('active');
    btnL?.classList.add('active');
  }
  renderRides();
}

function changeMonth(delta) {
  _ridesMonthCursor.setMonth(_ridesMonthCursor.getMonth() + delta);
  renderMonthView();
}

/* ═══════════════════════════════════════════════════════════════════════
   MONTH VIEW
═══════════════════════════════════════════════════════════════════════ */
function renderMonthView() {
  const year  = _ridesMonthCursor.getFullYear();
  const month = _ridesMonthCursor.getMonth();

  const titleEl = document.getElementById('rides-month-title');
  if (titleEl) titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;

  const grid = document.getElementById('rides-month-grid');
  if (!grid) return;

  // Segunda como primeira coluna (igual ao mock): converte o getDay() (0=Dom).
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const today        = new Date();
  const allRides     = Storage.getRides();
  const monthRides   = allRides.filter(r => {
    const d = new Date(r.data + 'T00:00:00');
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const weatherMap = weatherByDate();
  const actByDate  = activitiesByDate();

  let html = '';

  // Cabeçalho dos dias da semana (segunda → domingo, igual ao mock)
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  WEEK_ORDER.forEach(idx => {
    html += `<div class="month-head">${WEEKDAY_SHORT[idx]}</div>`;
  });

  // Células vazias antes do dia 1
  for (let i = 0; i < firstWeekday; i++) {
    html += '<div class="month-cell month-cell-empty"></div>';
  }

  // Dias do mês
  for (let day = 1; day <= daysInMonth; day++) {
    const dateISO = isoFromYMD(year, month + 1, day);
    const isToday = isSameDay(new Date(year, month, day), today);
    const dayRides = monthRides.filter(r => r.data === dateISO);
    const has = dayRides.length > 0;

    const classes = ['month-cell'];
    if (isToday) classes.push('today');
    if (has)     classes.push('has-ride');

    html += `<div class="${classes.join(' ')}" data-date="${dateISO}">`;
    const wx = weatherMap[dateISO];
    const wxChip = wx
      ? `<span class="month-cell-wx" title="${escAttr((wx.tMax != null ? wx.tMax + '°C' : '') + ' · chuva ' + wx.chuva + '%')}">` +
        `<i class="fa-solid ${esc(wx.icon)}"></i>` +
        (wx.tMax != null ? `<span class="month-cell-wx-temp">${wx.tMax}°</span>` : '') +
        `</span>`
      : '';
    const moon = moonPhase(dateISO);
    const moonChip = `<span class="month-cell-moon" title="${escAttr(moon.nome)}">${moon.emoji}</span>`;
    html += `<div class="month-cell-day"><span class="mc-day-left">${day} ${moonChip}</span>${wxChip}</div>`;

    // Atividades sincronizadas (Garmin/Strava) — badge suave com km
    const dayActs = actByDate[dateISO] || [];
    dayActs.slice(0, 2).forEach(a => {
      const km  = isFinite(a.distanciaKm) ? a.distanciaKm.toFixed(1).replace('.', ',') + ' km' : '';
      const tip = `${a.nome || 'Atividade'}${km ? ' — ' + km : ''} (${a.fonte})`;
      html += `<span class="cal-act cal-act-${esc(a.fonte)}" title="${escAttr(tip)}">` +
              `<i class="fa-solid fa-bicycle"></i>` +
              (km ? `<span class="cal-act-km">${esc(km)}</span>` : '') +
              `</span>`;
    });

    // Mostra até 2 passeios no card; resto vira "+N"
    const visible = dayRides.slice(0, 2);
    visible.forEach(r => {
      html += `
        <div class="month-cell-ride" data-difficulty="${escAttr(r.dificuldade)}" title="${escAttr(r.destino)} — ${escAttr(r.distancia)} km">
          <i class="fa-solid fa-bicycle"></i>
          <span>${esc(r.destino)}</span>
        </div>`;
    });
    if (dayRides.length > 2) {
      html += `<div class="month-cell-more">+${dayRides.length - 2} passeio(s)</div>`;
    }
    html += '</div>';
  }

  grid.innerHTML = html;
}

function handleMonthGridClick(e) {
  const cell = e.target.closest('.month-cell:not(.month-cell-empty)');
  if (!cell || !cell.dataset.date) return;

  const dateISO = cell.dataset.date;
  const dayRides = Storage.getRides().filter(r => r.data === dateISO);

  if (dayRides.length === 0) {
    openRideModal(null, dateISO);
  } else {
    openDayRidesModal(dateISO, dayRides);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   LIST VIEW (cronológica, agrupada em "Próximos" e "Anteriores")
═══════════════════════════════════════════════════════════════════════ */
function renderListView() {
  const grid = document.getElementById('rides-list-grid');
  if (!grid) return;

  const all = Storage.getRides();
  if (all.length === 0) {
    grid.innerHTML = `
      <div class="rides-empty-state">
        <i class="fa-solid fa-bicycle"></i>
        <p>Nenhum passeio planejado.</p>
        <button class="btn btn-primary" type="button" data-action="add">
          <i class="fa-solid fa-plus"></i> Adicionar primeiro passeio
        </button>
      </div>
    `;
    return;
  }

  const todayISO = tbToday();
  const futuros  = all.filter(r => r.data >= todayISO).sort((a, b) => a.data.localeCompare(b.data));
  const passados = all.filter(r => r.data <  todayISO).sort((a, b) => b.data.localeCompare(a.data));

  let html = '';
  if (futuros.length > 0) {
    html += `<div class="rides-group-label">Próximos · ${futuros.length}</div>`;
    futuros.forEach(r => html += buildRideCard(r, false));
  }
  if (passados.length > 0) {
    html += `<div class="rides-group-label" style="margin-top:24px;">Anteriores · ${passados.length}</div>`;
    passados.forEach(r => html += buildRideCard(r, true));
  }
  grid.innerHTML = html;
}

function buildRideCard(r, isPast) {
  const d   = new Date(r.data + 'T00:00:00');
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase();
  const ano = d.getFullYear();
  const dif = DIFFICULTY[r.dificuldade] || DIFFICULTY.media;
  const tempo = r.tempoEstimado || r.duracao || '';   // duracao = legado

  return `
    <div class="ride-card ${isPast ? 'ride-past' : ''}" data-ride-id="${escAttr(r.id)}" data-action="edit">
      <div class="ride-date">
        <div class="ride-date-day">${dia}</div>
        <div class="ride-date-mes">${mes}</div>
        <div class="ride-date-ano">${ano}</div>
      </div>
      <div class="ride-info">
        <div class="ride-name">${esc(r.destino || '(sem destino)')}</div>
        <div class="ride-meta">
          <span><i class="fa-solid fa-route"></i>${r.distancia ? r.distancia.toString().replace('.', ',') : '—'} km</span>
          <span><i class="fa-solid fa-mountain"></i>${r.altitude || '—'} m</span>
          ${r.horaInicio ? `<span><i class="fa-solid fa-flag-checkered"></i>${esc(r.horaInicio)}</span>` : ''}
          <span><i class="fa-solid fa-clock"></i>${esc(tempo || '—')}</span>
          <span class="ride-dif" style="color:${dif.color}">
            <i class="fa-solid fa-signal"></i>${dif.label}
          </span>
        </div>
        ${r.notas ? `<div class="ride-notes">${esc(r.notas)}</div>` : ''}
      </div>
      <div class="ride-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-action="edit" data-ride-id="${escAttr(r.id)}" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-sm btn-danger" type="button" data-action="delete" data-ride-id="${escAttr(r.id)}" title="Excluir">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `;
}

function handleListGridClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id     = btn.dataset.rideId;

  if (action === 'add') {
    openRideModal(null);
    return;
  }
  if (!id) return;

  // Evita que o clique no card "edit" e nos botões internos disparem juntos
  e.stopPropagation();

  const ride = Storage.getRides().find(r => r.id === id);
  if (!ride) return;

  if (action === 'edit')   openRideModal(ride);
  if (action === 'delete') confirmDeleteRide(ride);
}

/* ═══════════════════════════════════════════════════════════════════════
   MODAL: Lista de passeios de um dia (vista mês)
═══════════════════════════════════════════════════════════════════════ */
function openDayRidesModal(dateISO, dayRides) {
  const d = new Date(dateISO + 'T00:00:00');
  const titulo = d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  Modals.open({
    tag: 'Passeios do dia',
    title: capitalize(titulo),
    bodyHTML: `
      <div class="day-rides-list">
        ${dayRides.map(r => {
          const dif = DIFFICULTY[r.dificuldade] || DIFFICULTY.media;
          return `
            <div class="day-ride-item" data-ride-id="${escAttr(r.id)}">
              <div class="day-ride-head">
                <h4>${esc(r.destino || '(sem destino)')}</h4>
                <span class="ride-dif" style="color:${dif.color}">
                  <i class="fa-solid fa-signal"></i>${dif.label}
                </span>
              </div>
              <div class="day-ride-stats">
                <span><i class="fa-solid fa-route"></i>${r.distancia ? r.distancia.toString().replace('.', ',') : '—'} km</span>
                <span><i class="fa-solid fa-mountain"></i>${r.altitude || '—'} m</span>
                ${r.horaInicio ? `<span><i class="fa-solid fa-flag-checkered"></i>${esc(r.horaInicio)}</span>` : ''}
                <span><i class="fa-solid fa-clock"></i>${esc(r.tempoEstimado || r.duracao || '—')}</span>
              </div>
              ${r.notas ? `<p class="day-ride-notes">${esc(r.notas)}</p>` : ''}
              <div class="day-ride-actions">
                <button class="btn btn-sm btn-ghost" type="button" data-day-edit="${escAttr(r.id)}">
                  <i class="fa-solid fa-pen"></i> Editar
                </button>
                <button class="btn btn-sm btn-danger" type="button" data-day-delete="${escAttr(r.id)}">
                  <i class="fa-solid fa-trash"></i> Excluir
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `,
    actions: [
      { label: 'Adicionar passeio neste dia', kind: 'primary', onClick: () => {
        Modals.close();
        openRideModal(null, dateISO);
      }},
      { label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() },
    ],
    onMount: (modal) => {
      modal.querySelectorAll('[data-day-edit]').forEach(b => {
        b.onclick = () => {
          const r = Storage.getRides().find(x => x.id === b.dataset.dayEdit);
          if (r) {
            Modals.close();
            setTimeout(() => openRideModal(r), 100);
          }
        };
      });
      modal.querySelectorAll('[data-day-delete]').forEach(b => {
        b.onclick = () => {
          const r = Storage.getRides().find(x => x.id === b.dataset.dayDelete);
          if (r) {
            Modals.close();
            setTimeout(() => confirmDeleteRide(r), 100);
          }
        };
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MODAL: Novo / Editar passeio
═══════════════════════════════════════════════════════════════════════ */
function openRideModal(ride, presetDate) {
  const isEdit = !!ride;
  const r = ride || {
    data:         presetDate || tbToday(),
    destino:      '',
    distancia:    '',
    altitude:     '',
    horaInicio:   '',
    tempoEstimado:'',
    dificuldade:  'media',
    notas:        '',
  };

  Modals.open({
    tag: isEdit ? 'Editar passeio' : 'Novo passeio',
    title: isEdit ? esc(r.destino || 'Sem destino') : 'Adicionar passeio',
    bodyHTML: `
      <div class="field">
        <label class="field-label" for="r-destino">Destino</label>
        <input id="r-destino" class="field-input" type="text" value="${escAttr(r.destino)}"
               placeholder="Ex.: Serra da Mantiqueira" />
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="r-data">Data</label>
          <input id="r-data" class="field-input" type="date" value="${escAttr(r.data)}" />
        </div>
        <div class="field">
          <label class="field-label" for="r-hora">Hora início</label>
          <input id="r-hora" class="field-input" type="time" value="${escAttr(r.horaInicio)}" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="r-distancia">Distância (km)</label>
          <input id="r-distancia" class="field-input" type="number" min="0" step="0.1"
                 value="${escAttr(r.distancia)}" placeholder="0,0" />
        </div>
        <div class="field">
          <label class="field-label" for="r-altitude">Altimetria (m)</label>
          <input id="r-altitude" class="field-input" type="number" min="0" step="1"
                 value="${escAttr(r.altitude)}" placeholder="0" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="r-dificuldade">Dificuldade</label>
          <select id="r-dificuldade" class="field-select">
            <option value="baixa" ${r.dificuldade === 'baixa' ? 'selected' : ''}>Baixa</option>
            <option value="media" ${r.dificuldade === 'media' ? 'selected' : ''}>Média</option>
            <option value="alta"  ${r.dificuldade === 'alta'  ? 'selected' : ''}>Alta</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label" for="r-tempo-est">Tempo estimado</label>
          <input id="r-tempo-est" class="field-input" type="text" readonly
                 value="${escAttr(r.tempoEstimado)}" placeholder="—"
                 title="Calculado de distância + altimetria + dificuldade" />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="r-notas">Observações (opcional)</label>
        <textarea id="r-notas" class="field-textarea"
                  placeholder="Roteiro, parada para água, parceiros…">${esc(r.notas)}</textarea>
      </div>
      ${isEdit ? '' : `
      <div class="field">
        <label class="ride-recur-check">
          <input type="checkbox" id="r-recur" />
          <span>Repetir semanalmente</span>
        </label>
        <div id="r-recur-weeks" class="ride-recur-weeks" hidden>
          <label class="field-label" for="r-recur-n">Por quantas semanas</label>
          <input id="r-recur-n" class="field-input" type="number" min="1" max="52" value="4" />
          <p class="ride-recur-info" id="r-recur-info"></p>
        </div>
      </div>`}
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: isEdit ? 'Salvar alterações' : 'Adicionar', kind: 'primary',
        onClick: (modal) => saveRide(modal, ride?.id) },
    ],
    onMount: (modal) => {
      modal.querySelector('#r-destino').focus();

      // Tempo estimado (auto): recalcula de distância + altimetria + dificuldade.
      const estEl  = modal.querySelector('#r-tempo-est');
      const distEl = modal.querySelector('#r-distancia');
      const altEl  = modal.querySelector('#r-altitude');
      const difEl  = modal.querySelector('#r-dificuldade');
      const recalcEstimate = () => {
        estEl.value = computeRideEstimate(
          parseFloat(distEl.value) || 0,
          parseFloat(altEl.value) || 0,
          difEl.value
        );
      };
      [distEl, altEl, difEl].forEach(el => el.addEventListener('input', recalcEstimate));
      recalcEstimate();

      // Recorrência (só no modo criar).
      const recur     = modal.querySelector('#r-recur');
      const weeksWrap = modal.querySelector('#r-recur-weeks');
      if (recur) {
        const nEl   = modal.querySelector('#r-recur-n');
        const info  = modal.querySelector('#r-recur-info');
        const dataEl = modal.querySelector('#r-data');
        const updateInfo = () => {
          const n = clampWeeks(nEl.value);
          const dates = weeklyDates(dataEl.value, n).slice(0, 6)
            .map(iso => fmtDayMonth(iso));
          info.textContent = dates.length
            ? `Cria ${n} cópia${n > 1 ? 's' : ''}: ${dates.join(', ')}${n > 6 ? '…' : ''} — cada uma editável sozinha.`
            : '';
        };
        recur.addEventListener('change', () => {
          weeksWrap.hidden = !recur.checked;
          if (recur.checked) updateInfo();
        });
        nEl.addEventListener('input', updateInfo);
        dataEl.addEventListener('input', () => { if (recur.checked) updateInfo(); });
      }
    },
  });
}

function saveRide(modal, rideId) {
  const v   = (id) => modal.querySelector('#' + id).value.trim();
  const num = (id) => {
    const x = parseFloat(modal.querySelector('#' + id).value);
    return isFinite(x) ? x : 0;
  };

  const data = {
    data:          v('r-data'),
    destino:       v('r-destino'),
    distancia:     num('r-distancia'),
    altitude:      Math.round(num('r-altitude')),
    horaInicio:    v('r-hora'),
    tempoEstimado: v('r-tempo-est'),
    dificuldade:   v('r-dificuldade'),
    notas:         v('r-notas'),
  };

  if (!data.destino) { toast('Informe o destino', { kind: 'error' }); return; }
  if (!data.data)    { toast('Informe a data',    { kind: 'error' }); return; }
  if (isNaN(new Date(data.data).getTime())) { toast('Data inválida', { kind: 'error' }); return; }

  if (rideId) {
    Storage.updateRide(rideId, data);
    toast('Passeio atualizado');
  } else {
    Storage.addRide(data);
    // Recorrência semanal: cópias independentes nas semanas seguintes.
    const recur = modal.querySelector('#r-recur');
    if (recur && recur.checked) {
      const n = clampWeeks(modal.querySelector('#r-recur-n').value);
      const extras = weeklyDates(data.data, n);
      extras.forEach(iso => Storage.addRide({ ...data, data: iso }));
      toast(`Passeio + ${extras.length} recorrência${extras.length > 1 ? 's' : ''} adicionados`);
    } else {
      toast('Passeio adicionado');
    }
  }

  renderRides();
  window.Notifications?.load();  // "próximo passeio" pode ter mudado
  Modals.close();
}

function confirmDeleteRide(ride) {
  Modals.open({
    tag: 'Confirmação',
    title: 'Excluir passeio?',
    bodyHTML: `
      <p style="color:var(--muted2);font-size:14px;line-height:1.6;">
        O passeio <strong style="color:var(--text)">"${esc(ride.destino || 'sem destino')}"</strong>
        em <strong>${esc(formatDateBR(ride.data))}</strong> será removido permanentemente.
      </p>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Excluir', kind: 'danger', onClick: () => {
        Storage.deleteRide(ride.id);
        renderRides();
        Modals.close();
        toast('Passeio excluído');
      }},
    ],
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════ */
function isoFromYMD(year, month1based, day) {
  return `${year}-${String(month1based).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth() &&
         a.getDate()     === b.getDate();
}

/* ── Fase da lua (cálculo astronômico, sem API) ─────────────────────────
   8 fases a partir do mês sinódico e de uma lua nova de referência. */
const MOON_PHASES = [
  { emoji: '🌑', nome: 'Lua Nova' },
  { emoji: '🌒', nome: 'Crescente côncava' },
  { emoji: '🌓', nome: 'Quarto crescente' },
  { emoji: '🌔', nome: 'Crescente gibosa' },
  { emoji: '🌕', nome: 'Lua cheia' },
  { emoji: '🌖', nome: 'Minguante gibosa' },
  { emoji: '🌗', nome: 'Quarto minguante' },
  { emoji: '🌘', nome: 'Minguante côncava' },
];
function moonPhase(dateISO) {
  const SYN = 29.53058867;                    // mês sinódico (dias)
  const ref = Date.UTC(2000, 0, 6, 18, 14);   // lua nova de referência (UTC)
  const t   = new Date(dateISO + 'T12:00:00').getTime();
  const days = (t - ref) / 86400000;
  const frac = (((days % SYN) + SYN) % SYN) / SYN;  // 0..1 dentro do ciclo
  return MOON_PHASES[Math.round(frac * 8) % 8];
}

function formatDateBR(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ═══════════════════════════════════════════════════════════════════════
   PREVISÃO DO TEMPO — São Paulo (Open-Meteo, 7 dias) — Fase 12.3
   Cache de 1h; alertas específicos para ciclismo.
═══════════════════════════════════════════════════════════════════════ */
let _weatherCache    = null;
let _weatherCacheTs  = 0;
let _weatherPage     = 0;   // página atual da faixa (7 dias por página)
const WEATHER_TTL_MS = 60 * 60 * 1000; // 1 hora (dados diários mudam pouco após 06h)

function wmoIcon(code) {
  return window.Utils.wmoIcon(code);
}

// Mapa dateISO → previsão (a partir do cache do strip), usado para colocar
// símbolos de previsão nos dias do calendário dentro da janela disponível.
function weatherByDate() {
  const map = {};
  const daily = _weatherCache;
  if (!daily || !daily.time) return map;
  daily.time.forEach((dateStr, i) => {
    map[dateStr] = {
      wmo:   daily.weathercode?.[i],
      icon:  wmoIcon(daily.weathercode?.[i]),
      tMax:  daily.temperature_2m_max?.[i] != null ? Math.round(daily.temperature_2m_max[i]) : null,
      chuva: daily.precipitation_probability_max?.[i] ?? 0,
    };
  });
  return map;
}

// Mapa dateISO → atividades sincronizadas (Garmin/Strava). Deduplica por dia:
// se houver atividades de fontes diferentes com distância ~igual E horário
// ~igual, mantém a do Garmin (preferência quando duplicado entre serviços).
// O horário é obrigatório na comparação: só a distância fazia o 2º pedal do
// dia sumir do badge quando tinha quilometragem parecida (BUG-060). Tolerância
// espelha o matcher do servidor (server/utils/activity-matcher.js: ±300 s).
function activitiesByDate() {
  const map = {};
  (_ridesActivities || []).forEach(a => {
    const d = (a.inicio || a.data || '').slice(0, 10);
    if (!d || !isFinite(a.distanciaKm)) return;
    (map[d] = map[d] || []).push(a);
  });
  Object.keys(map).forEach(d => {
    const dedup = [];
    const TIME_TOL_S = 300;
    // Mesma normalização do parseLocal do servidor (activity-matcher.js): o
    // `inicio` do Strava é `start_date_local` rotulado com "Z" (não é UTC) e o
    // da Garmin vem com espaço. Sem tirar o Z, os dois lados ficariam
    // deslocados pelo fuso e a dedup entre serviços nunca casaria.
    const ts = (x) => {
      const raw = x && x.inicio ? String(x.inicio).replace('Z', '').replace(' ', 'T') : '';
      const t = Date.parse(raw);
      return isFinite(t) ? t / 1000 : null;
    };
    map[d].forEach(a => {
      const ta = ts(a);
      const dup = dedup.find(b => {
        if (Math.abs((b.distanciaKm || 0) - (a.distanciaKm || 0)) >= 0.5) return false;
        const tb = ts(b);
        // Sem horário em algum dos lados, não dá para afirmar que é a mesma
        // atividade — mantém as duas (erra para o lado de exibir a mais).
        if (ta === null || tb === null) return false;
        return Math.abs(ta - tb) <= TIME_TOL_S;
      });
      if (!dup) { dedup.push(a); return; }
      if (a.fonte === 'garmin' && dup.fonte !== 'garmin') dedup[dedup.indexOf(dup)] = a;
    });
    map[d] = dedup;
  });
  return map;
}

async function fetchRidesActivities() {
  if (!window.Api) return;
  try {
    const resp = await window.Api.get('/activities/unified?days=1825');
    _ridesActivities = (resp && resp.items) || [];
    if (_ridesViewMode === 'month') renderMonthView();
  } catch (err) {
    console.warn('[Rides] Atividades:', err);
  }
}

// Avalia condições e devolve label + cor + alerta para ciclismo.
function ridesEsforco(day) {
  const tMax    = day.tMax;
  const tSens   = day.tSens ?? day.tMax;
  const vento   = day.vento;
  const rajada  = day.rajada ?? day.vento;
  const chuva   = day.chuva;
  const chuvaMm = day.chuvaMm ?? 0;
  const uv      = day.uv ?? 0;

  // Alertas críticos (alta prioridade — sobrescrevem o esforço)
  if (rajada > 50)   return { label: '⚠ Vento perigoso', color: 'var(--red)', alert: `Rajadas de ${Math.round(rajada)} km/h — pedalar não recomendado` };
  if (chuvaMm > 10)  return { label: '🌧 Chuva forte',    color: 'var(--red)', alert: `${chuvaMm.toFixed(1)} mm de chuva previstos — considere adiar` };
  if (tSens > 40)    return { label: '🌡 Calor extremo',  color: 'var(--red)', alert: `Sensação térmica ${Math.round(tSens)}°C — risco de golpe de calor` };

  // Esforço regular
  if (tMax > 38 || chuva > 60 || vento > 40) return { label: 'Alto',       color: 'var(--red)',   alert: uv >= 9 ? `UV ${Math.round(uv)} — protetor solar obrigatório` : '' };
  if (tMax > 35 || (chuva > 30 && vento > 20)) return { label: 'Médio-Alto', color: '#f5923a',     alert: uv >= 8 ? `UV ${Math.round(uv)} — proteção solar necessária` : '' };
  if (tMax > 30 || vento > 25 || chuva > 20)   return { label: 'Médio',      color: 'var(--amber)', alert: uv >= 8 ? `UV ${Math.round(uv)} — proteção solar necessária` : '' };
  if (tMax > 25 || vento > 15)                  return { label: 'Baixo-Médio',color: 'var(--teal)',  alert: '' };
  return                                               { label: '✅ Ideal',   color: 'var(--green)', alert: '' };
}

// Avaliação de ciclismo para uma data (usada pelo sino de Notificações).
// Reusa o cache de previsão + buildWeatherDay + ridesEsforco; busca a previsão
// se o cache estiver frio. Devolve { label, color, alert, tMax, chuva } ou null.
async function dayRating(dateISO) {
  if (!window.Api) return null;
  if (!_weatherCache || (Date.now() - _weatherCacheTs) >= WEATHER_TTL_MS) {
    try {
      const daily = await window.Api.get('/weather/forecast');
      if (daily && daily.time) { _weatherCache = daily; _weatherCacheTs = Date.now(); }
    } catch (_) { /* mantém cache anterior, se houver */ }
  }
  const daily = _weatherCache;
  if (!daily || !daily.time) return null;
  const i = daily.time.indexOf(dateISO);
  if (i < 0) return null;
  const day = buildWeatherDay(daily, i);
  const esf = ridesEsforco(day);
  return { label: esf.label, color: esf.color, alert: esf.alert, tMax: day.tMax, chuva: day.chuva };
}

const WEEKDAY_PT = ['dom','seg','ter','qua','qui','sex','sáb'];
const MONTH_SHORT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

async function fetchRidesWeather() {
  const strip = document.getElementById('rides-weather-strip');
  if (!strip) return;

  // Cache válido
  if (_weatherCache && (Date.now() - _weatherCacheTs) < WEATHER_TTL_MS) {
    renderWeatherStrip(strip, _weatherCache);
    return;
  }

  strip.classList.remove('hidden');
  strip.innerHTML = '<div class="rws-loading"><i class="fa-solid fa-spinner fa-spin"></i> Consultando previsão…</div>';

  try {
    // Proxy via backend — evita CORS/CSP do browser ao chamar Open-Meteo
    const daily = await window.Api.get('/weather/forecast');
    if (!daily || !daily.time) throw new Error('Resposta inválida');

    _weatherCache   = daily;
    _weatherCacheTs = Date.now();
    _weatherPage    = 0;
    renderWeatherStrip(strip, _weatherCache);
    // Símbolos de previsão no calendário (dias dentro da janela disponível)
    if (_ridesViewMode === 'month') renderMonthView();
  } catch (err) {
    console.warn('[Rides] Weather:', err);
    strip.classList.remove('hidden');
    strip.innerHTML = '<div class="rws-loading" style="color:var(--muted2);">'
      + '<i class="fa-solid fa-triangle-exclamation"></i> Previsão indisponível no momento.</div>';
  }
}

function buildWeatherDay(daily, i) {
  const dateStr = daily.time[i];
  const d       = new Date(dateStr + 'T12:00:00');
  return {
    dateStr,
    wd:      WEEKDAY_PT[d.getDay()],
    dm:      d.getDate(),
    mon:     MONTH_SHORT[d.getMonth()],
    tMax:    Math.round(daily.temperature_2m_max[i]),
    tMin:    Math.round(daily.temperature_2m_min[i]),
    tSens:   daily.apparent_temperature_max?.[i] != null ? Math.round(daily.apparent_temperature_max[i]) : null,
    tSensMin:daily.apparent_temperature_min?.[i] != null ? Math.round(daily.apparent_temperature_min[i]) : null,
    chuva:   daily.precipitation_probability_max?.[i] ?? 0,
    chuvaMm: daily.precipitation_sum?.[i] ?? 0,
    vento:   daily.wind_speed_10m_max?.[i] ?? 0,
    rajada:  daily.windgusts_10m_max?.[i] ?? null,
    uv:      daily.uv_index_max?.[i] ?? null,
    sunrise: daily.sunrise?.[i] || null,
    sunset:  daily.sunset?.[i] || null,
    wmo:     daily.weathercode[i],
    icon:    wmoIcon(daily.weathercode[i]),
    isToday: i === 0,
  };
}

function renderWeatherStrip(strip, daily) {
  // 7 dias por página; setas paginam por toda a janela (até 16 dias).
  const total = daily.time.length;
  const PAGE  = 7;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  _weatherPage = Math.min(Math.max(_weatherPage, 0), pages - 1);

  const start = _weatherPage * PAGE;
  const end   = Math.min(start + PAGE, total);
  const days  = [];
  for (let i = start; i < end; i++) {
    const day = buildWeatherDay(daily, i);
    day.esf = ridesEsforco(day);
    day.absIdx = i;            // índice absoluto p/ abrir o detalhe correto
    days.push(day);
  }

  const updatedAt = new Date(_weatherCacheTs)
    .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const nav = pages > 1;

  strip.classList.remove('hidden');
  strip.innerHTML = `
    <div class="rws-header">
      <span class="rws-title"><i class="fa-solid fa-location-dot"></i> São Paulo</span>
      <span class="rws-updated"><i class="fa-solid fa-circle-info"></i> previsão de ${total} dias · atualizado ${updatedAt}</span>
    </div>
    <div class="rws-strip-row">
      ${nav ? `<button class="rws-arrow" data-pg="prev" ${_weatherPage === 0 ? 'disabled' : ''} aria-label="Dias anteriores"><i class="fa-solid fa-chevron-left"></i></button>` : ''}
      <div class="rws-days">
        ${days.map(d => `
          <div class="rws-day${d.isToday ? ' rws-today' : ''}" data-day="${d.absIdx}">
            <div class="rws-wd">${d.wd}</div>
            <div class="rws-dm">${d.dm}</div>
            <i class="fa-solid ${d.icon} rws-icon"></i>
            <div class="rws-tmax">${d.tMax}°</div>
            <div class="rws-tmin">${d.tMin}°</div>
            <div class="rws-rain"><i class="fa-solid fa-droplet"></i>${d.chuva}%</div>
            ${d.uv != null ? `<div class="rws-uv">UV ${Math.round(d.uv)}</div>` : ''}
            <div class="rws-esf" style="color:${d.esf.color}">${d.esf.label}</div>
          </div>`).join('')}
      </div>
      ${nav ? `<button class="rws-arrow" data-pg="next" ${_weatherPage >= pages - 1 ? 'disabled' : ''} aria-label="Próximos dias"><i class="fa-solid fa-chevron-right"></i></button>` : ''}
    </div>
    ${nav ? `<div class="rws-pageinfo">página ${_weatherPage + 1} de ${pages}</div>` : ''}`;

  // Detalhes ao clicar num dia (reconstrói pelo índice absoluto)
  strip.querySelectorAll('.rws-day').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.day, 10);
      const day = buildWeatherDay(daily, idx);
      day.esf = ridesEsforco(day);
      openWeatherDetail(day);
    });
  });

  // Setas de paginação
  strip.querySelectorAll('.rws-arrow').forEach(btn => {
    btn.addEventListener('click', () => {
      _weatherPage += (btn.dataset.pg === 'next' ? 1 : -1);
      renderWeatherStrip(strip, daily);
    });
  });
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function openWeatherDetail(day) {
  if (!window.Modals) return;
  const escFn = window.esc || (s => String(s ?? ''));
  const dateLabel = new Date(day.dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });
  const row = (icon, label, value, color) => `
    <div class="rws-detail-row">
      <span class="rws-detail-key"><i class="fa-solid ${icon}"></i> ${escFn(label)}</span>
      <span class="rws-detail-val" ${color ? `style="color:${color}"` : ''}>${escFn(value)}</span>
    </div>`;

  const alertBox = day.esf.alert
    ? `<div class="rws-detail-alert" style="border-left-color:${day.esf.color};color:${day.esf.color};">
         <i class="fa-solid fa-triangle-exclamation"></i> ${escFn(day.esf.alert)}
       </div>`
    : '';

  Modals.open({
    tag: 'Previsão detalhada',
    title: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    bodyHTML: `
      ${alertBox}
      <div class="rws-detail-grid">
        ${row(day.icon, 'Condição', `${day.tMax}° / ${day.tMin}°`)}
        ${day.tSens != null ? row('fa-temperature-half', 'Sensação térmica', `${day.tSens}°${day.tSensMin != null ? ` / ${day.tSensMin}°` : ''}`) : ''}
        ${row('fa-droplet', 'Probabilidade de chuva', `${day.chuva}%`)}
        ${row('fa-cloud-rain', 'Chuva acumulada', `${(day.chuvaMm || 0).toFixed(1)} mm`)}
        ${row('fa-wind', 'Vento máximo', `${Math.round(day.vento)} km/h`)}
        ${day.rajada != null ? row('fa-tornado', 'Rajadas', `${Math.round(day.rajada)} km/h`, day.rajada > 40 ? 'var(--red)' : '') : ''}
        ${day.uv != null ? row('fa-sun', 'Índice UV', `${Math.round(day.uv)}`, day.uv >= 8 ? 'var(--amber)' : '') : ''}
        ${row('fa-sun', 'Nascer do sol', fmtTime(day.sunrise))}
        ${row('fa-moon', 'Pôr do sol', fmtTime(day.sunset))}
        ${row('fa-gauge', 'Esforço estimado', day.esf.label, day.esf.color)}
      </div>`,
    actions: [
      { label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() },
    ],
  });
}

/* expor */
window.Rides = {
  init:          initRides,
  render:        renderRides,
  openRideModal: openRideModal,
  loadWeather:   fetchRidesWeather,
  dayRating:     dayRating,
};
