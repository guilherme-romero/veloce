/* ═══════════════════════════════════════════════════════════════════════
   TRAINING LOG — marcar dias treinados (multi-select de tipos)
   Tipos: bike | fisico | alongamento
═══════════════════════════════════════════════════════════════════════ */

const TL_TYPES = {
  bike:        { label: 'Bike',           icon: 'fa-bicycle',       color: 'var(--teal)'  },
  fisico:      { label: 'Fortalecimento', icon: 'fa-dumbbell',      color: 'var(--amber)' },
  alongamento: { label: 'Alongamento',    icon: 'fa-person-walking', color: 'var(--blue)'  },
};

/* ── Init ─────────────────────────────────────────────────────────────── */
function initTrainingLog() {
  document.getElementById('btn-mark-training')?.addEventListener('click', () => {
    openMarkTrainingModal(tbToday());
  });
}

/* ── Queries ─────────────────────────────────────────────────────────── */
function getForMonth(year, month) {
  return Storage.getTrainingLog().filter(e => {
    const d = new Date(e.data + 'T00:00:00');
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

function getForDate(iso) {
  return Storage.getTrainingLog().filter(e => e.data === iso);
}

/* ── Resumo dos últimos 90 dias ──────────────────────────────────────── */
function get90DayStats() {
  const d90 = new Date();
  d90.setDate(d90.getDate() - 89);
  const d90ISO = d90.toISOString().slice(0, 10);

  const log     = Storage.getTrainingLog().filter(e => e.data >= d90ISO);
  const weights = Storage.getWeights().filter(w => w.data >= d90ISO && w.tipo === 'atual');

  const diasTreinados = new Set(log.map(e => e.data)).size;

  const typeCounts = {};
  log.forEach(e => {
    (e.tipos || []).forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
  });
  const tipoMaisFreq = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const mediaPeso = weights.length > 0
    ? +(weights.reduce((s, w) => s + w.peso, 0) / weights.length).toFixed(1)
    : null;

  return { diasTreinados, tipoMaisFreq, mediaPeso };
}

/* ── Modal: marcar treino ─────────────────────────────────────────────── */
function openMarkTrainingModal(dateISO) {
  const existing = getForDate(dateISO);

  Modals.open({
    tag: 'Treino',
    title: 'Marcar treino',
    bodyHTML: `
      <div class="field">
        <label class="field-label" for="tl-data">Data</label>
        <input id="tl-data" class="field-input" type="date" value="${escAttr(dateISO)}" max="${escAttr(tbToday())}" />
      </div>
      <div class="field">
        <label class="field-label">Tipo(s) *</label>
        <div class="tl-type-btns">
          ${Object.entries(TL_TYPES).map(([k, v]) => `
            <button type="button" class="tl-type-btn" data-tipo="${escAttr(k)}">
              <i class="fa-solid ${esc(v.icon)}"></i> ${esc(v.label)}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="tl-notas">Observações (opcional)</label>
        <textarea id="tl-notas" class="field-textarea" placeholder="Como foi o treino?"></textarea>
      </div>
      ${existing.length > 0 ? `
        <div class="tl-existing-list">
          <div class="field-label" style="margin-bottom:8px;">Registros neste dia:</div>
          ${existing.map(e => `
            <div class="tl-existing-item">
              <span>
                ${(e.tipos || []).map(t =>
                  `<span style="color:${TL_TYPES[t]?.color || 'var(--text)'}">
                    <i class="fa-solid ${esc(TL_TYPES[t]?.icon || 'fa-circle')}"></i>
                    ${esc(TL_TYPES[t]?.label || t)}
                  </span>`
                ).join(' + ')}
              </span>
              ${e.notas ? `<span class="tl-notes-preview">${esc(e.notas)}</span>` : ''}
              <button class="btn btn-sm btn-danger" type="button" data-tl-delete="${escAttr(e.id)}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost',   onClick: () => Modals.close() },
      { label: 'Marcar',   kind: 'primary', onClick: (modal) => saveTrainingEntry(modal) },
    ],
    onMount: (modal) => {
      // Toggle multi-select
      modal.querySelectorAll('.tl-type-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('active'));
      });
      // Delete existing entries
      modal.querySelectorAll('[data-tl-delete]').forEach(btn => {
        btn.onclick = () => {
          Storage.deleteTrainingEntry(btn.dataset.tlDelete);
          Modals.close();
          if (window.Rides?.render) Rides.render();
          if (window.renderMiniReport) renderMiniReport();
          toast('Registro removido');
        };
      });
    },
  });
}

function saveTrainingEntry(modal) {
  const data  = modal.querySelector('#tl-data').value;
  const notas = modal.querySelector('#tl-notas').value.trim();
  const tipos = Array.from(modal.querySelectorAll('.tl-type-btn.active')).map(b => b.dataset.tipo);

  if (!data)               { toast('Informe a data', { kind: 'error' }); return; }
  if (data > tbToday())    { toast('A data não pode ser no futuro', { kind: 'error' }); return; }
  if (!tipos.length)       { toast('Selecione pelo menos um tipo', { kind: 'error' }); return; }

  Storage.addTrainingEntry({ data, tipos, notas });
  Modals.close();
  if (window.Rides?.render) Rides.render();
  if (window.renderMiniReport) renderMiniReport();
  toast('Treino marcado');
}

window.TrainingLog = {
  init:                 initTrainingLog,
  getForDate,
  getForMonth,
  get90DayStats,
  openMarkTrainingModal,
  TL_TYPES,
};
