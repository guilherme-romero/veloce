/* ═══════════════════════════════════════════════════════════════════════
   APP — bootstrap, navegação, handlers globais
═══════════════════════════════════════════════════════════════════════ */

const NAV_SECTIONS = ['profile', 'zones', 'home-workout', 'plan', 'rides'];

function setActiveNav(id) {
  NAV_SECTIONS.forEach(sec => {
    const btn = document.getElementById('nav-' + sec);
    if (btn) btn.classList.toggle('active', sec === id);
  });
}
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
  setActiveNav(id);
}
window.scrollToSection = scrollToSection;

/* ═══════════════════════════════════════════════════════════════════════
   RENDER GLOBAL
═══════════════════════════════════════════════════════════════════════ */
function renderAll() {
  const user = Storage.getUser();
  const weights = Storage.getWeights();

  Profile.render(user);
  Charts.renderWeight(user, weights);
  Workouts.renderModes();
  Workouts.renderCalendar();
  Rides.render();
}

/* ═══════════════════════════════════════════════════════════════════════
   MODAL: Editar perfil
═══════════════════════════════════════════════════════════════════════ */
function openProfileModal() {
  const u = Storage.getUser();

  Modals.open({
    tag: 'Perfil',
    title: 'Editar dados pessoais',
    bodyHTML: `
      <div class="field">
        <label class="field-label" for="f-nome">Nome</label>
        <input id="f-nome" class="field-input" type="text" value="${esc(u.nome)}" placeholder="Seu nome" />
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="f-nasc">Data de nascimento</label>
          <input id="f-nasc" class="field-input" type="date" value="${esc(u.dataNascimento)}" />
        </div>
        <div class="field">
          <label class="field-label" for="f-altura">Altura (cm)</label>
          <input id="f-altura" class="field-input" type="number" min="100" max="230" step="1" value="${u.altura || ''}" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="f-peso">Peso atual (kg)</label>
          <input id="f-peso" class="field-input" type="number" min="30" max="250" step="0.1" value="${u.pesoAtual || ''}" />
        </div>
        <div class="field">
          <label class="field-label" for="f-meta">Peso meta (kg)</label>
          <input id="f-meta" class="field-input" type="number" min="30" max="250" step="0.1" value="${u.pesoMeta || ''}" />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="f-inicio">Data de início do plano</label>
        <input id="f-inicio" class="field-input" type="date" value="${esc(u.dataInicioPlano)}" />
        <span class="field-hint">A projeção das 12 semanas começa nesta data.</span>
      </div>

      <div class="field-row" style="border-top:1px solid var(--border); padding-top:16px; margin-top:8px;">
        <div class="field">
          <label class="field-label" for="f-bmodelo">Modelo da bike</label>
          <input id="f-bmodelo" class="field-input" type="text" value="${esc(u.bikeModelo)}" placeholder="Gravel / MTB / Road" />
        </div>
        <div class="field">
          <label class="field-label" for="f-bpeso">Peso da bike (kg)</label>
          <input id="f-bpeso" class="field-input" type="number" min="3" max="30" step="0.1" value="${u.bikePeso || ''}" />
        </div>
      </div>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Salvar',   kind: 'primary', onClick: (modal) => saveProfile(modal) },
    ],
    onMount: (modal) => modal.querySelector('#f-nome').focus(),
  });
}

function saveProfile(modal) {
  const get = (id) => modal.querySelector('#' + id).value.trim();
  const num = (id) => {
    const v = parseFloat(get(id));
    return isNaN(v) ? 0 : v;
  };

  const updated = {
    nome:            get('f-nome'),
    dataNascimento:  get('f-nasc'),
    altura:          num('f-altura'),
    pesoAtual:       num('f-peso'),
    pesoMeta:        num('f-meta'),
    dataInicioPlano: get('f-inicio') || tbToday(),
    bikeModelo:      get('f-bmodelo'),
    bikePeso:        num('f-bpeso'),
  };

  if (!updated.nome)                          { toast('Informe seu nome', { kind: 'error' }); return; }
  if (!updated.altura || updated.altura < 100) { toast('Altura inválida', { kind: 'error' }); return; }
  if (!updated.pesoAtual)                      { toast('Informe o peso atual', { kind: 'error' }); return; }

  Storage.setUser(updated);
  renderAll();
  Modals.close();
  toast('Perfil atualizado');
}

/* ═══════════════════════════════════════════════════════════════════════
   MODAL: Registrar pesagem
═══════════════════════════════════════════════════════════════════════ */
function openWeightModal() {
  const u = Storage.getUser();

  Modals.open({
    tag: 'Pesagem',
    title: 'Registrar peso',
    bodyHTML: `
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="w-data">Data</label>
          <input id="w-data" class="field-input" type="date" value="${tbToday()}" />
        </div>
        <div class="field">
          <label class="field-label" for="w-peso">Peso (kg)</label>
          <input id="w-peso" class="field-input" type="number" min="30" max="250" step="0.1"
                 value="${u.pesoAtual || ''}" />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="w-tipo">Tipo</label>
        <select id="w-tipo" class="field-select">
          <option value="atual">Plano atual (entra na projeção)</option>
          <option value="historico">Histórico anterior</option>
        </select>
        <span class="field-hint">Use "histórico" para registrar pesagens anteriores ao início do plano.</span>
      </div>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Salvar',   kind: 'primary', onClick: (modal) => saveWeight(modal) },
    ],
    onMount: (modal) => modal.querySelector('#w-peso').focus(),
  });
}

function saveWeight(modal) {
  const data = modal.querySelector('#w-data').value;
  const peso = parseFloat(modal.querySelector('#w-peso').value);
  const tipo = modal.querySelector('#w-tipo').value;

  if (!data) { toast('Informe a data', { kind: 'error' }); return; }
  if (!peso) { toast('Informe o peso', { kind: 'error' }); return; }

  Storage.addWeight({ data, peso: +peso.toFixed(1), tipo });

  if (tipo === 'atual') {
    const u = Storage.getUser();
    u.pesoAtual = +peso.toFixed(1);
    Storage.setUser(u);
  }

  renderAll();
  Modals.close();
  toast('Pesagem registrada');
}

/* ── Helpers ─────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

/* ═══════════════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════════════ */
async function boot() {
  // 1. Migração
  await tbMigrate();

  // 2. Charts vazios
  Charts.init();

  // 3. Render inicial
  renderAll();

  // 4. Inicializa rides (tem estado interno: cursor de mês)
  Rides.init();

  // 5. Wire dos botões da nav
  document.getElementById('btn-edit-profile')?.addEventListener('click', openProfileModal);
  document.getElementById('btn-edit-profile-2')?.addEventListener('click', openProfileModal);
  document.getElementById('btn-add-weight')?.addEventListener('click', openWeightModal);
  document.getElementById('btn-backup')?.addEventListener('click', Backup.open);

  // 6. IntersectionObserver para nav ativo
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) setActiveNav(e.target.id);
    });
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
  NAV_SECTIONS.forEach(id => {
    const el = document.getElementById(id);
    if (el) obs.observe(el);
  });
}

document.addEventListener('DOMContentLoaded', boot);
