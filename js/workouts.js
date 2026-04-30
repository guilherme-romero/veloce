/* ═══════════════════════════════════════════════════════════════════════
   WORKOUTS — render dos modos (tabs) + day-cards + CRUD de treino e modo
═══════════════════════════════════════════════════════════════════════ */

let currentModeId = null;

const DAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

const TYPES = [
  { id: 'home',  label: 'Em casa',          icon: 'fa-house-user' },
  { id: 'long',  label: 'Longão',           icon: 'fa-bicycle' },
  { id: 'hiit',  label: 'HIIT',             icon: 'fa-bolt' },
  { id: 'climb', label: 'Subida',           icon: 'fa-mountain' },
  { id: 'group', label: 'Grupo',            icon: 'fa-people-group' },
  { id: 'rest',  label: 'Descanso',         icon: 'fa-bed' },
];

/* ── Render das tabs (modos) ────────────────────────────────────────── */
function renderModes() {
  const modes = Storage.getModes();
  const container = document.getElementById('plan-toggle');
  if (!container) return;

  // Garante que currentModeId é válido
  if (!modes.find(m => m.id === currentModeId)) {
    currentModeId = modes[0]?.id;
  }

  container.innerHTML = '';

  modes.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'plan-btn' + (m.id === currentModeId ? ' active' : '');
    btn.type = 'button';
    btn.textContent = m.nome;
    btn.onclick = () => switchPlan(m.id);
    container.appendChild(btn);
  });

  // Botão menu de modo (renomear, excluir, novo)
  const menuBtn = document.createElement('button');
  menuBtn.className = 'plan-btn-menu';
  menuBtn.type = 'button';
  menuBtn.title = 'Gerenciar modos';
  menuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
  menuBtn.onclick = openModeMenu;
  container.appendChild(menuBtn);
}

function switchPlan(modeId) {
  currentModeId = modeId;
  renderModes();
  renderCalendar();
  closeDetail();
}
window.switchPlan = switchPlan;

/* ── Render do calendário (day-cards do modo ativo) ─────────────────── */
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!currentModeId) return;
  const list = Storage.getWorkoutsForMode(currentModeId);

  // Card "+ adicionar"
  const addCard = document.createElement('div');
  addCard.className = 'day-card day-card-add';
  addCard.innerHTML = `
    <i class="fa-solid fa-plus" style="font-size:24px;color:var(--muted);margin:auto"></i>
    <span style="font-size:11px;text-align:center;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Novo treino</span>
  `;
  addCard.onclick = () => openWorkoutModal(null);
  grid.appendChild(addCard);

  // Cards de treino
  list.forEach(w => {
    const card = document.createElement('div');
    card.className = `day-card type-${w.type || 'rest'}` + (w.type === 'rest' ? ' rest' : '');
    card.onclick = () => showDetail(w);
    card.innerHTML = `
      <span class="day-label">${w.day}</span>
      <h4 class="day-title">${esc(w.title)}</h4>
      <div class="day-footer">
        <span class="day-tag">${esc(w.tag || '')}</span>
        <i class="fa-solid ${typeIcon(w.type)}" style="color:${w.type === 'home' ? 'var(--amber)' : 'var(--muted)'};font-size:13px"></i>
      </div>
    `;
    grid.appendChild(card);
  });

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.style.cssText = 'grid-column: 2 / -1; text-align:center; padding:32px 16px; color:var(--muted); font-size:14px;';
    empty.innerHTML = `
      <i class="fa-solid fa-calendar-plus" style="font-size:24px;color:var(--muted);display:block;margin-bottom:10px"></i>
      Nenhum treino neste modo. Clique em <strong style="color:var(--teal)">Novo treino</strong> para começar.
    `;
    grid.appendChild(empty);
  }
}

function typeIcon(type) {
  const t = TYPES.find(x => x.id === type);
  return t ? t.icon : 'fa-circle';
}

/* ── Painel de detalhe (inline) ─────────────────────────────────────── */
function showDetail(w) {
  const d = document.getElementById('workout-detail');
  if (!d) return;

  d.innerHTML = `
    <div class="detail-top">
      <div>
        <div class="detail-tag">${esc(w.tag || '—')}</div>
        <h3 class="detail-title">${esc(w.title)}</h3>
        <div style="margin-top:8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">${esc(w.day)}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm btn-ghost" type="button" data-edit><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="btn btn-sm btn-danger" type="button" data-delete><i class="fa-solid fa-trash"></i></button>
        <button class="close-btn" type="button" onclick="closeDetail()" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>

    <div class="detail-metrics">
      <div class="metric-box">
        <div class="metric-icon" style="background:var(--red-dim);color:var(--red)"><i class="fa-solid fa-heart"></i></div>
        <div>
          <div class="metric-label">Alvo de FC</div>
          <div class="metric-val">${esc(w.bpm || '—')}</div>
        </div>
      </div>
      <div class="metric-box">
        <div class="metric-icon" style="background:var(--teal-dim);color:var(--teal)"><i class="fa-solid fa-rotate"></i></div>
        <div>
          <div class="metric-label">Alvo de RPM</div>
          <div class="metric-val">${esc(w.rpm || '—')}</div>
        </div>
      </div>
      <div class="metric-box">
        <div class="metric-icon" style="background:var(--blue-dim);color:var(--blue)"><i class="fa-solid fa-clock"></i></div>
        <div>
          <div class="metric-label">Duração</div>
          <div class="metric-val">${esc(w.time || '—')}</div>
        </div>
      </div>
    </div>

    <div class="detail-body">
      <div>
        <div class="detail-steps-label">Instruções</div>
        <ul id="detail-steps">
          ${(w.steps || []).map(s => `<li><i class="fa-solid fa-check"></i><span>${esc(s)}</span></li>`).join('')}
        </ul>
      </div>
      <div class="focus-box">
        <div class="focus-box-label"><i class="fa-solid fa-bullseye"></i> Foco Estratégico</div>
        <p style="font-size:14px;color:var(--muted2);line-height:1.7;font-style:italic;">${esc(w.tip || '')}</p>
      </div>
    </div>
  `;

  d.querySelector('[data-edit]').onclick = () => openWorkoutModal(w.id);
  d.querySelector('[data-delete]').onclick = () => confirmDeleteWorkout(w);

  d.classList.remove('hidden');
  d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeDetail() {
  const d = document.getElementById('workout-detail');
  if (d) d.classList.add('hidden');
}
window.closeDetail = closeDetail;

/* ═══════════════════════════════════════════════════════════════════════
   MODAL: Novo / Editar treino
═══════════════════════════════════════════════════════════════════════ */
function openWorkoutModal(workoutId) {
  const list = Storage.getWorkoutsForMode(currentModeId);
  const isEdit = !!workoutId;
  const w = isEdit ? list.find(x => x.id === workoutId) : {
    day: 'SEG', type: 'home', title: '', bpm: '', rpm: '', time: '',
    tag: '', steps: [], tip: ''
  };
  if (isEdit && !w) return;

  const stepsText = (w.steps || []).join('\n');

  Modals.open({
    tag: isEdit ? 'Editar treino' : 'Novo treino',
    title: isEdit ? esc(w.title || 'Sem título') : 'Adicionar treino',
    bodyHTML: `
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="t-day">Dia</label>
          <select id="t-day" class="field-select">
            ${DAYS.map(d => `<option value="${d}" ${w.day === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field-label" for="t-type">Tipo</label>
          <select id="t-type" class="field-select">
            ${TYPES.map(t => `<option value="${t.id}" ${w.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="t-title">Título</label>
        <input id="t-title" class="field-input" type="text" value="${esc(w.title)}" placeholder="Ex.: Longão Endurance" />
      </div>

      <div class="field">
        <label class="field-label" for="t-tag">Tag</label>
        <input id="t-tag" class="field-input" type="text" value="${esc(w.tag)}" placeholder="Ex.: BIKE VOLUME" />
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="t-bpm">Alvo FC</label>
          <input id="t-bpm" class="field-input" type="text" value="${esc(w.bpm)}" placeholder="Z2-Z3" />
        </div>
        <div class="field">
          <label class="field-label" for="t-rpm">Alvo RPM</label>
          <input id="t-rpm" class="field-input" type="text" value="${esc(w.rpm)}" placeholder="85-95" />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="t-time">Duração</label>
        <input id="t-time" class="field-input" type="text" value="${esc(w.time)}" placeholder="3 h ou 30 km" />
      </div>

      <div class="field">
        <label class="field-label" for="t-steps">Instruções (uma por linha)</label>
        <textarea id="t-steps" class="field-textarea" placeholder="Aquecimento: 15 min Z2&#10;8× (1 min máximo / 2 min Z1)&#10;Giro solto: 10 min">${esc(stepsText)}</textarea>
      </div>

      <div class="field">
        <label class="field-label" for="t-tip">Foco estratégico</label>
        <textarea id="t-tip" class="field-textarea" placeholder="Por que esse treino é importante?">${esc(w.tip)}</textarea>
      </div>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: isEdit ? 'Salvar alterações' : 'Adicionar', kind: 'primary', onClick: (modal) => saveWorkout(modal, workoutId) },
    ],
    onMount: (modal) => modal.querySelector('#t-title').focus(),
  });
}

function saveWorkout(modal, workoutId) {
  const v = (id) => modal.querySelector('#' + id).value.trim();

  const data = {
    day:   v('t-day'),
    type:  v('t-type'),
    title: v('t-title'),
    tag:   v('t-tag'),
    bpm:   v('t-bpm'),
    rpm:   v('t-rpm'),
    time:  v('t-time'),
    steps: v('t-steps').split('\n').map(s => s.trim()).filter(Boolean),
    tip:   v('t-tip'),
  };

  if (!data.title) {
    toast('Informe um título', { kind: 'error' });
    return;
  }

  if (workoutId) {
    Storage.updateWorkout(currentModeId, workoutId, data);
    toast('Treino atualizado');
  } else {
    Storage.addWorkout(currentModeId, data);
    toast('Treino adicionado');
  }

  renderCalendar();
  closeDetail();
  Modals.close();
}

function confirmDeleteWorkout(w) {
  Modals.open({
    tag: 'Confirmação',
    title: 'Excluir treino?',
    bodyHTML: `
      <p style="color:var(--muted2);font-size:14px;line-height:1.6;">
        O treino <strong style="color:var(--text)">"${esc(w.title)}"</strong> (${esc(w.day)}) será removido permanentemente. Essa ação não pode ser desfeita.
      </p>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Excluir', kind: 'danger', onClick: () => {
        Storage.deleteWorkout(currentModeId, w.id);
        renderCalendar();
        closeDetail();
        Modals.close();
        toast('Treino excluído');
      }},
    ],
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MODO: gerenciar (criar/renomear/excluir)
═══════════════════════════════════════════════════════════════════════ */
function openModeMenu() {
  const modes = Storage.getModes();
  const current = modes.find(m => m.id === currentModeId);

  Modals.open({
    tag: 'Modos',
    title: 'Gerenciar modos de treino',
    bodyHTML: `
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${modes.map(m => `
          <div class="mode-row" data-mode-id="${m.id}">
            <div style="flex:1;">
              <div style="font-weight:700;font-size:14px;">${esc(m.nome)}</div>
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;">
                ${Storage.getWorkoutsForMode(m.id).length} treinos
              </div>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-ghost" type="button" data-rename="${m.id}" title="Renomear">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn btn-sm btn-danger" type="button" data-delete-mode="${m.id}"
                      ${modes.length === 1 ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}
                      title="${modes.length === 1 ? 'Não é possível excluir o único modo' : 'Excluir modo'}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px;">
        <div class="field">
          <label class="field-label" for="m-novo">Adicionar novo modo</label>
          <div style="display:flex;gap:8px;">
            <input id="m-novo" class="field-input" type="text" placeholder="Ex.: Recuperação, Pré-prova" style="flex:1" />
            <button class="btn btn-primary" type="button" data-add-mode><i class="fa-solid fa-plus"></i> Criar</button>
          </div>
        </div>
      </div>
    `,
    actions: [
      { label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() },
    ],
    onMount: (modal) => {
      // wire dos botões dinâmicos
      modal.querySelectorAll('[data-rename]').forEach(b => {
        b.onclick = () => openRenameModeModal(b.dataset.rename);
      });
      modal.querySelectorAll('[data-delete-mode]').forEach(b => {
        if (b.disabled) return;
        b.onclick = () => confirmDeleteMode(b.dataset.deleteMode);
      });
      modal.querySelector('[data-add-mode]').onclick = () => {
        const input = modal.querySelector('#m-novo');
        const nome = input.value.trim();
        if (!nome) { toast('Informe um nome', { kind: 'error' }); return; }
        const id = Storage.addMode(nome);
        currentModeId = id;
        renderModes();
        renderCalendar();
        Modals.close();
        toast(`Modo "${nome}" criado`);
      };
      modal.querySelector('#m-novo').addEventListener('keydown', e => {
        if (e.key === 'Enter') modal.querySelector('[data-add-mode]').click();
      });
    },
  });
}

function openRenameModeModal(modeId) {
  const m = Storage.getModes().find(x => x.id === modeId);
  if (!m) return;

  Modals.open({
    tag: 'Renomear modo',
    title: esc(m.nome),
    bodyHTML: `
      <div class="field">
        <label class="field-label" for="m-rename">Novo nome</label>
        <input id="m-rename" class="field-input" type="text" value="${esc(m.nome)}" />
      </div>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Salvar', kind: 'primary', onClick: (modal) => {
        const novo = modal.querySelector('#m-rename').value.trim();
        if (!novo) { toast('Informe um nome', { kind: 'error' }); return; }
        Storage.renameMode(modeId, novo);
        renderModes();
        Modals.close();
        toast('Modo renomeado');
      }},
    ],
    onMount: (modal) => {
      const inp = modal.querySelector('#m-rename');
      inp.focus(); inp.select();
    },
  });
}

function confirmDeleteMode(modeId) {
  const m = Storage.getModes().find(x => x.id === modeId);
  if (!m) return;
  const n = Storage.getWorkoutsForMode(modeId).length;

  Modals.open({
    tag: 'Confirmação',
    title: `Excluir modo "${esc(m.nome)}"?`,
    bodyHTML: `
      <p style="color:var(--muted2);font-size:14px;line-height:1.6;">
        ${n > 0
          ? `Este modo tem <strong style="color:var(--red)">${n} treino(s)</strong> que também serão excluídos.`
          : 'Este modo não tem treinos.'}
        <br><br>Essa ação não pode ser desfeita.
      </p>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Excluir modo', kind: 'danger', onClick: () => {
        const ok = Storage.deleteMode(modeId);
        if (!ok) {
          toast('Não é possível excluir o único modo', { kind: 'error' });
          return;
        }
        // Se excluiu o atual, vai para o primeiro disponível
        if (currentModeId === modeId) {
          currentModeId = Storage.getModes()[0]?.id;
        }
        renderModes();
        renderCalendar();
        Modals.close();
        toast(`Modo "${m.nome}" excluído`);
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
window.Workouts = {
  renderModes,
  renderCalendar,
  switchPlan,
  closeDetail,
};
