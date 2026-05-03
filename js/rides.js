/* ═══════════════════════════════════════════════════════════════════════
   RIDES — calendário e lista de passeios planejados
   Integrado ao Storage e ao sistema genérico de Modals do app.
═══════════════════════════════════════════════════════════════════════ */

let _ridesViewMode  = 'month';                  // 'month' | 'list'
let _ridesMonthCursor = new Date();             // mês exibido na vista calendário

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

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const today        = new Date();
  const allRides     = Storage.getRides();
  const monthRides   = allRides.filter(r => {
    const d = new Date(r.data + 'T00:00:00');
    return d.getFullYear() === year && d.getMonth() === month;
  });

  let html = '';

  // Cabeçalho dos dias da semana
  WEEKDAY_SHORT.forEach(d => {
    html += `<div class="month-head">${d}</div>`;
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
    html += `<div class="month-cell-day">${day}</div>`;

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

  // Estrelas (só renderiza se nota > 0)
  let starsHTML = '';
  if (r.nota > 0) {
    starsHTML = '<div class="ride-stars" title="Nota">';
    for (let i = 1; i <= 5; i++) {
      starsHTML += `<i class="fa-${i <= r.nota ? 'solid' : 'regular'} fa-star"></i>`;
    }
    starsHTML += '</div>';
  }

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
          <span><i class="fa-solid fa-clock"></i>${esc(r.duracao || '—')}</span>
          <span class="ride-dif" style="color:${dif.color}">
            <i class="fa-solid fa-signal"></i>${dif.label}
          </span>
        </div>
        ${r.notas ? `<div class="ride-notes">${esc(r.notas)}</div>` : ''}
        ${starsHTML}
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
                <span><i class="fa-solid fa-clock"></i>${esc(r.duracao || '—')}</span>
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
    data:        presetDate || tbToday(),
    destino:     '',
    distancia:   '',
    altitude:    '',
    duracao:     '',
    dificuldade: 'media',
    nota:        0,
    notas:       '',
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
          <label class="field-label" for="r-duracao">Tempo de pedal</label>
          <input id="r-duracao" class="field-input" type="text" value="${escAttr(r.duracao)}"
                 placeholder="Ex.: 2h 30min" />
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
          <label class="field-label">Nota (0–5)</label>
          <div class="ride-rating-input" id="r-rating">
            ${[1,2,3,4,5].map(i => `
              <button type="button" class="ride-star ${i <= r.nota ? 'active' : ''}" data-value="${i}" aria-label="${i} estrela${i > 1 ? 's' : ''}">
                <i class="fa-solid fa-star"></i>
              </button>
            `).join('')}
            <button type="button" class="ride-star-clear" data-value="0" title="Limpar">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <input type="hidden" id="r-nota" value="${r.nota || 0}" />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="r-notas">Observações (opcional)</label>
        <textarea id="r-notas" class="field-textarea"
                  placeholder="Roteiro, parada para água, parceiros…">${esc(r.notas)}</textarea>
      </div>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: isEdit ? 'Salvar alterações' : 'Adicionar', kind: 'primary',
        onClick: (modal) => saveRide(modal, ride?.id) },
    ],
    onMount: (modal) => {
      modal.querySelector('#r-destino').focus();

      // Wire das estrelas
      const ratingEl = modal.querySelector('#r-rating');
      const ratingHidden = modal.querySelector('#r-nota');
      ratingEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-value]');
        if (!btn) return;
        const v = parseInt(btn.dataset.value, 10);
        ratingHidden.value = v;
        ratingEl.querySelectorAll('.ride-star').forEach((s, i) => {
          s.classList.toggle('active', i < v);
        });
      });
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
    data:        v('r-data'),
    destino:     v('r-destino'),
    distancia:   num('r-distancia'),
    altitude:    Math.round(num('r-altitude')),
    duracao:     v('r-duracao'),
    dificuldade: v('r-dificuldade'),
    nota:        parseInt(modal.querySelector('#r-nota').value, 10) || 0,
    notas:       v('r-notas'),
  };

  if (!data.destino) { toast('Informe o destino', { kind: 'error' }); return; }
  if (!data.data)    { toast('Informe a data',    { kind: 'error' }); return; }

  if (rideId) {
    Storage.updateRide(rideId, data);
    toast('Passeio atualizado');
  } else {
    Storage.addRide(data);
    toast('Passeio adicionado');
  }

  renderRides();
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
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function escAttr(s) { return esc(s); }

function isoFromYMD(year, month1based, day) {
  return `${year}-${String(month1based).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth() &&
         a.getDate()     === b.getDate();
}

function formatDateBR(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* expor */
window.Rides = {
  init:   initRides,
  render: renderRides,
};
