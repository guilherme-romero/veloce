/* ═══════════════════════════════════════════════════════════════════════
   HOME WORKOUT — CRUD do circuito de fortalecimento em casa
═══════════════════════════════════════════════════════════════════════ */

const HW_ICONS = [
  { id: 'fa-shield-halved',              label: 'Prancha' },
  { id: 'fa-arrows-up-down',             label: 'Agachamento' },
  { id: 'fa-repeat',                     label: 'Escalador' },
  { id: 'fa-person-walking-arrow-right', label: 'Afundo' },
  { id: 'fa-dumbbell',                   label: 'Peso livre' },
  { id: 'fa-rotate',                     label: 'Rotação' },
  { id: 'fa-person-walking',             label: 'Caminhada' },
  { id: 'fa-heart-pulse',                label: 'Cardio' },
  { id: 'fa-person-running',             label: 'Corrida' },
  { id: 'fa-fire',                       label: 'Intenso' },
];

/* ── Init ─────────────────────────────────────────────────────────────── */
function initHomeWorkout() {
  document.getElementById('btn-add-home-exercise')?.addEventListener('click', () => openHomeExerciseModal(null));
  document.getElementById('btn-export-home')?.addEventListener('click', exportHomeExercises);
  document.getElementById('home-import-file')?.addEventListener('change', (e) => {
    importHomeExercises(e.target.files[0]);
    e.target.value = '';
  });
}

/* ── Render ──────────────────────────────────────────────────────────── */
function renderHomeExercises() {
  const grid = document.getElementById('home-exercises-grid');
  if (!grid) return;

  const exercises = Storage.getHomeExercises();

  if (exercises.length === 0) {
    grid.innerHTML = `
      <div class="rides-empty-state" style="grid-column:1/-1;">
        <i class="fa-solid fa-dumbbell"></i>
        <p>Nenhum exercício cadastrado.</p>
        <button class="btn btn-primary" type="button" onclick="document.getElementById('btn-add-home-exercise').click()">
          <i class="fa-solid fa-plus"></i> Adicionar exercício
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = exercises.map(ex => `
    <div class="exercise-card" data-hw-id="${escAttr(ex.id)}">
      <div class="exercise-thumb"><i class="fa-solid ${esc(ex.icon || 'fa-dumbbell')}"></i></div>
      <div class="exercise-body">
        <div class="exercise-name">${esc(ex.name)}</div>
        <div class="exercise-sets">${esc(ex.sets)}</div>
        <div class="exercise-desc">${esc(ex.desc)}</div>
      </div>
      <div class="exercise-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-hw-edit="${escAttr(ex.id)}" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-sm btn-danger" type="button" data-hw-delete="${escAttr(ex.id)}" title="Excluir">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-hw-edit]').forEach(btn => {
    btn.onclick = () => {
      const ex = Storage.getHomeExercises().find(x => x.id === btn.dataset.hwEdit);
      if (ex) openHomeExerciseModal(ex);
    };
  });
  grid.querySelectorAll('[data-hw-delete]').forEach(btn => {
    btn.onclick = () => confirmDeleteHomeExercise(btn.dataset.hwDelete);
  });
}

/* ── Modal: novo / editar ────────────────────────────────────────────── */
function openHomeExerciseModal(ex) {
  const isEdit = !!ex;
  const e = ex || { icon: 'fa-dumbbell', name: '', sets: '', desc: '' };

  Modals.open({
    tag: isEdit ? 'Editar' : 'Novo exercício',
    title: isEdit ? (e.name || 'Exercício') : 'Adicionar exercício',
    bodyHTML: `
      <div class="field">
        <label class="field-label" for="hw-icon">Ícone</label>
        <select id="hw-icon" class="field-select">
          ${HW_ICONS.map(ic =>
            `<option value="${escAttr(ic.id)}" ${e.icon === ic.id ? 'selected' : ''}>${esc(ic.label)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field-label" for="hw-name">Nome *</label>
        <input id="hw-name" class="field-input" type="text" value="${escAttr(e.name)}" placeholder="Ex.: Prancha frontal" />
      </div>
      <div class="field">
        <label class="field-label" for="hw-sets">Séries / Repetições</label>
        <input id="hw-sets" class="field-input" type="text" value="${escAttr(e.sets)}" placeholder="Ex.: 3 séries × 45 s" />
      </div>
      <div class="field">
        <label class="field-label" for="hw-desc">Descrição</label>
        <textarea id="hw-desc" class="field-textarea" placeholder="Orientação do exercício…">${esc(e.desc)}</textarea>
      </div>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: isEdit ? 'Salvar' : 'Adicionar', kind: 'primary',
        onClick: (modal) => saveHomeExercise(modal, ex?.id) },
    ],
    onMount: (modal) => modal.querySelector('#hw-name').focus(),
  });
}

function saveHomeExercise(modal, exId) {
  const v = (id) => modal.querySelector('#' + id).value.trim();
  const name = v('hw-name');
  if (!name) { toast('Informe o nome do exercício', { kind: 'error' }); return; }

  const data = { icon: v('hw-icon'), name, sets: v('hw-sets'), desc: v('hw-desc') };

  if (exId) {
    Storage.updateHomeExercise(exId, data);
    toast('Exercício atualizado');
  } else {
    Storage.addHomeExercise(data);
    toast('Exercício adicionado');
  }

  renderHomeExercises();
  Modals.close();
}

function confirmDeleteHomeExercise(id) {
  const ex = Storage.getHomeExercises().find(x => x.id === id);
  if (!ex) return;

  Modals.open({
    tag: 'Confirmação',
    title: 'Excluir exercício?',
    bodyHTML: `
      <p style="color:var(--muted2);font-size:14px;line-height:1.6;">
        O exercício <strong style="color:var(--text)">"${esc(ex.name)}"</strong> será removido permanentemente.
      </p>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost',  onClick: () => Modals.close() },
      { label: 'Excluir',  kind: 'danger', onClick: () => {
        Storage.deleteHomeExercise(id);
        renderHomeExercises();
        Modals.close();
        toast('Exercício excluído');
      }},
    ],
  });
}

/* ── Export / Import isolado ─────────────────────────────────────────── */
function exportHomeExercises() {
  const json = JSON.stringify({ homeExercises: Storage.getHomeExercises() }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `circuito-em-casa-${tbToday()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Circuito exportado');
}

function importHomeExercises(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') throw new Error('Formato inválido');
      if (!data.homeExercises || !Array.isArray(data.homeExercises)) {
        throw new Error('Arquivo sem dados de circuito');
      }
      if (data.homeExercises.length > 500) throw new Error('Lista de exercícios muito grande');
      if (!data.homeExercises.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
        throw new Error('Estrutura de exercícios inválida');
      }
      Storage.setHomeExercises(data.homeExercises);
      renderHomeExercises();
      toast(`Circuito importado: ${data.homeExercises.length} exercício(s)`);
    } catch (err) {
      toast('Arquivo inválido: ' + err.message, { kind: 'error' });
    }
  };
  reader.readAsText(file);
}

window.HomeWorkout = {
  init:   initHomeWorkout,
  render: renderHomeExercises,
};
