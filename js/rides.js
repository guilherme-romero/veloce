/* ═══════════════════════════════════════════════════════════════════════
   RIDES — calendário de passeios planejados
   Duas vistas: 'month' (grid mensal) e 'list' (cronológica)
═══════════════════════════════════════════════════════════════════════ */

let ridesView = 'month';     // 'month' | 'list'
let monthCursor = null;      // { y, m } — m é 0-indexed

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril',
  'Maio', 'Junho', 'Julho', 'Agosto',
  'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function initRides() {
  const today = new Date();
  monthCursor = { y: today.getFullYear(), m: today.getMonth() };

  // Wire dos botões da seção
  document.getElementById('btn-add-ride')?.addEventListener('click', () => openRideModal(null));
  document.getElementById('btn-view-month')?.addEventListener('click', () => switchView('month'));
  document.getElementById('btn-view-list')?.addEventListener('click', () => switchView('list'));
  document.getElementById('btn-prev-month')?.addEventListener('click', () => navMonth(-1));
  document.getElementById('btn-next-month')?.addEventListener('click', () => navMonth(1));

  renderRides();
}

function switchView(v) {
  ridesView = v;
  document.getElementById('btn-view-month')?.classList.toggle('active', v === 'month');
  document.getElementById('btn-view-list')?.classList.toggle('active', v === 'list');
  renderRides();
}

function navMonth(delta) {
  monthCursor.m += delta;
  if (monthCursor.m > 11) { monthCursor.m = 0; monthCursor.y++; }
  if (monthCursor.m < 0)  { monthCursor.m = 11; monthCursor.y--; }
  renderRides();
}

function renderRides() {
  // Chamado antes do init (ex: via renderAll)? Sai silenciosamente.
  if (!monthCursor) return;

  const monthBox = document.getElementById('rides-month');
  const listBox  = document.getElementById('rides-list');
  const navBox   = document.getElementById('rides-month-nav');
  if (!monthBox || !listBox) return;

  if (ridesView === 'month') {
    monthBox.classList.remove('hidden');
    listBox.classList.add('hidden');
    if (navBox) navBox.classList.remove('hidden');
    renderMonth();
  } else {
    monthBox.classList.add('hidden');
    listBox.classList.remove('hidden');
    if (navBox) navBox.classList.add('hidden');
    renderList();
  }
}

/* ── Vista mensal (grid 7×N) ────────────────────────────────────────── */
function renderMonth() {
  const { y, m } = monthCursor;
  const titleEl = document.getElementById('rides-month-title');
  if (titleEl) titleEl.textContent = `${MONTH_NAMES[m]} ${y}`;

  const grid = document.getElementById('rides-month-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Header com nomes dos dias da semana
  WEEKDAY_LABELS.forEach(d => {
    const head = document.createElement('div');
    head.className = 'month-head';
    head.textContent = d;
    grid.appendChild(head);
  });

  const firstDay = new Date(y, m, 1);
  const startWeekday = firstDay.getDay();              // 0 = dom
  const daysInMonth  = new Date(y, m + 1, 0).getDate();

  // Espaçamento até o primeiro dia
  for (let i = 0; i < startWeekday; i++) {
    const blank = document.createElement('div');
    blank.className = 'month-cell month-cell-empty';
    grid.appendChild(blank);
  }

  const todayStr = tbToday();
  const rides = Storage.getRides();

  // Index de passeios por data
  const ridesByDate = {};
  rides.forEach(r => {
    if (!ridesByDate[r.data]) ridesByDate[r.data] = [];
    ridesByDate[r.data].push(r);
  });

  // Cells dos dias
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'month-cell';
    if (iso === todayStr) cell.classList.add('today');
    if (ridesByDate[iso]) cell.classList.add('has-ride');

    const dayRides = ridesByDate[iso] || [];
    cell.innerHTML = `
      <div class="month-cell-day">${day}</div>
      ${dayRides.slice(0, 2).map(r => `
        <div class="month-cell-ride" data-ride-id="${r.id}" title="${esc(r.nome)}">
          <i class="fa-solid fa-bicycle"></i>
          <span>${esc(r.nome)}</span>
        </div>
      `).join('')}
      ${dayRides.length > 2
        ? `<div class="month-cell-more">+${dayRides.length - 2} mais</div>`
        : ''}
    `;

    // Clicar no dia abre cadastro novo (se vazio) ou abre o passeio (se já tem 1)
    cell.addEventListener('click', e => {
      const rideEl = e.target.closest('[data-ride-id]');
      if (rideEl) {
        showRideDetail(rideEl.dataset.rideId);
      } else if (dayRides.length === 1) {
        showRideDetail(dayRides[0].id);
      } else if (dayRides.length === 0) {
        openRideModal(null, iso);
      } else {
        // múltiplos: abre o primeiro (lista mostra todos)
        showRideDetail(dayRides[0].id);
      }
    });

    grid.appendChild(cell);
  }
}

/* ── Vista lista (cronológica) ──────────────────────────────────────── */
function renderList() {
  const list = document.getElementById('rides-list-grid');
  if (!list) return;

  const rides = Storage.getRides();
  const todayStr = tbToday();

  if (rides.length === 0) {
    list.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 24px;color:var(--muted);">
        <i class="fa-solid fa-route" style="font-size:32px;display:block;margin-bottom:12px"></i>
        Nenhum passeio cadastrado ainda.<br>
        Clique em <strong style="color:var(--teal)">Novo passeio</strong> para começar.
      </div>
    `;
    return;
  }

  // Separa em "futuros" e "passados"
  const future = rides.filter(r => r.data >= todayStr);
  const past   = rides.filter(r => r.data < todayStr);

  let html = '';
  if (future.length > 0) {
    html += `<div class="rides-group-label">Próximos</div>`;
    html += future.map(r => rideCardHTML(r, false)).join('');
  }
  if (past.length > 0) {
    html += `<div class="rides-group-label" style="margin-top:24px;">Anteriores</div>`;
    html += past.map(r => rideCardHTML(r, true)).join('');
  }

  list.innerHTML = html;
  list.querySelectorAll('[data-ride-id]').forEach(el => {
    el.onclick = () => showRideDetail(el.dataset.rideId);
  });
}

function rideCardHTML(r, isPast) {
  const d = new Date(r.data + 'T00:00:00');
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = MONTH_NAMES[d.getMonth()].slice(0, 3).toUpperCase();
  const ano = d.getFullYear();

  return `
    <div class="ride-card ${isPast ? 'ride-past' : ''}" data-ride-id="${r.id}">
      <div class="ride-date">
        <div class="ride-date-day">${dia}</div>
        <div class="ride-date-mes">${mes}</div>
        <div class="ride-date-ano">${ano}</div>
      </div>
      <div class="ride-info">
        <div class="ride-name">${esc(r.nome)}</div>
        <div class="ride-meta">
          ${r.distanciaKm ? `<span><i class="fa-solid fa-route"></i> ${esc(r.distanciaKm)} km</span>` : ''}
          ${r.local       ? `<span><i class="fa-solid fa-location-dot"></i> ${esc(r.local)}</span>` : ''}
        </div>
        ${r.notas ? `<div class="ride-notes">${esc(r.notas)}</div>` : ''}
      </div>
      <div class="ride-arrow"><i class="fa-solid fa-chevron-right"></i></div>
    </div>
  `;
}

/* ── Detalhe → modal de visualização com botões editar/excluir ──────── */
function showRideDetail(rideId) {
  const r = Storage.getRides().find(x => x.id === rideId);
  if (!r) return;

  const d = new Date(r.data + 'T00:00:00');
  const dataFmt = d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  Modals.open({
    tag: 'Passeio planejado',
    title: esc(r.nome),
    bodyHTML: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="metric-box" style="padding:14px 18px;">
          <div class="metric-icon" style="background:var(--teal-dim);color:var(--teal)"><i class="fa-solid fa-calendar-day"></i></div>
          <div>
            <div class="metric-label">Data</div>
            <div style="font-size:14px;font-weight:600;text-transform:capitalize;">${esc(dataFmt)}</div>
          </div>
        </div>
        ${r.distanciaKm ? `
        <div class="metric-box" style="padding:14px 18px;">
          <div class="metric-icon" style="background:var(--blue-dim);color:var(--blue)"><i class="fa-solid fa-route"></i></div>
          <div>
            <div class="metric-label">Distância prevista</div>
            <div style="font-size:14px;font-weight:600;">${esc(r.distanciaKm)} km</div>
          </div>
        </div>
        ` : ''}
        ${r.local ? `
        <div class="metric-box" style="padding:14px 18px;">
          <div class="metric-icon" style="background:var(--amber-dim);color:var(--amber)"><i class="fa-solid fa-location-dot"></i></div>
          <div>
            <div class="metric-label">Local / Rota</div>
            <div style="font-size:14px;font-weight:600;">${esc(r.local)}</div>
          </div>
        </div>
        ` : ''}
        ${r.notas ? `
        <div class="focus-box">
          <div class="focus-box-label"><i class="fa-solid fa-note-sticky"></i> Observações</div>
          <p style="font-size:14px;color:var(--muted2);line-height:1.6;">${esc(r.notas)}</p>
        </div>
        ` : ''}
      </div>
    `,
    actions: [
      { label: 'Excluir', kind: 'danger', onClick: () => confirmDeleteRide(r) },
      { label: 'Editar',  kind: 'ghost',  onClick: () => { Modals.close(); openRideModal(r.id); } },
      { label: 'Fechar',  kind: 'primary', onClick: () => Modals.close() },
    ],
  });
}

/* ── Modal: novo / editar passeio ───────────────────────────────────── */
function openRideModal(rideId, prefilledDate) {
  const isEdit = !!rideId;
  const r = isEdit
    ? Storage.getRides().find(x => x.id === rideId)
    : { data: prefilledDate || tbToday(), nome: '', distanciaKm: '', local: '', notas: '' };
  if (isEdit && !r) return;

  Modals.open({
    tag: isEdit ? 'Editar passeio' : 'Novo passeio',
    title: isEdit ? esc(r.nome) : 'Cadastrar passeio planejado',
    bodyHTML: `
      <div class="field">
        <label class="field-label" for="r-nome">Nome do passeio</label>
        <input id="r-nome" class="field-input" type="text" value="${esc(r.nome)}" placeholder="Ex.: Volta no Parque, Subida do Jaraguá" />
      </div>
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="r-data">Data</label>
          <input id="r-data" class="field-input" type="date" value="${esc(r.data)}" />
        </div>
        <div class="field">
          <label class="field-label" for="r-dist">Distância (km)</label>
          <input id="r-dist" class="field-input" type="number" min="0" step="1" value="${esc(r.distanciaKm)}" placeholder="60" />
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="r-local">Local / Rota</label>
        <input id="r-local" class="field-input" type="text" value="${esc(r.local)}" placeholder="Bairro, cidade ou nome da trilha" />
      </div>
      <div class="field">
        <label class="field-label" for="r-notas">Observações</label>
        <textarea id="r-notas" class="field-textarea" placeholder="Companhia, ponto de encontro, recomendações…">${esc(r.notas)}</textarea>
      </div>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: isEdit ? 'Salvar' : 'Cadastrar', kind: 'primary', onClick: (modal) => saveRide(modal, rideId) },
    ],
    onMount: (modal) => modal.querySelector('#r-nome').focus(),
  });
}

function saveRide(modal, rideId) {
  const v = (id) => modal.querySelector('#' + id).value.trim();

  const data = {
    nome:         v('r-nome'),
    data:         v('r-data'),
    distanciaKm:  v('r-dist'),
    local:        v('r-local'),
    notas:        v('r-notas'),
  };

  if (!data.nome) { toast('Informe o nome', { kind: 'error' }); return; }
  if (!data.data) { toast('Informe a data', { kind: 'error' }); return; }

  if (rideId) {
    Storage.updateRide(rideId, data);
    toast('Passeio atualizado');
  } else {
    Storage.addRide(data);
    toast('Passeio cadastrado');
  }
  renderRides();
  Modals.close();
}

function confirmDeleteRide(r) {
  Modals.open({
    tag: 'Confirmação',
    title: `Excluir "${esc(r.nome)}"?`,
    bodyHTML: `
      <p style="color:var(--muted2);font-size:14px;line-height:1.6;">
        O passeio será removido permanentemente. Essa ação não pode ser desfeita.
      </p>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Excluir', kind: 'danger', onClick: () => {
        Storage.deleteRide(r.id);
        renderRides();
        Modals.close();
        toast('Passeio excluído');
      }},
    ],
  });
}

/* ── Helpers ─────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

/* expor */
window.Rides = {
  init: initRides,
  render: renderRides,
  switchView,
  navMonth,
};
