/* ═══════════════════════════════════════════════════════════════════════
   APP — bootstrap, navegação, handlers globais
═══════════════════════════════════════════════════════════════════════ */

const NAV_SECTIONS = ['home', 'profile', 'rides', 'routes', 'activities', 'insights', 'integrations'];

function setActiveNav(id) {
  NAV_SECTIONS.forEach(sec => {
    const btn = document.getElementById('nav-' + sec);
    if (btn) btn.classList.toggle('active', sec === id);
  });
}
// DEPRECATED: window.scrollToSection é sobrescrito por router.js (alias de
// navigate(), ver linha ~339 ali) assim que o Router inicializa no boot —
// a versão abaixo só roda em código que chame scrollToSection() antes disso.
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
  setActiveNav(id);
}
window.scrollToSection = scrollToSection;

// CSP (issue #19): nav-links usava onclick="scrollToSection(...)" inline.
// NÃO precisa de wiring novo aqui — Router.rebindNav() (chamado no boot,
// abaixo) já liga btn.onclick em cada botão de nav (procura pelo id listado
// em ROUTES), substituindo o antigo onclick inline por navigate() de
// verdade (SPA routing). Um listener delegado aqui também chamaria
// scrollToSection, que o próprio router.js sobrescreve como alias de
// navigate() — ligar os dois gerava clique duplo (scroll concorrente +
// setActiveNav incompleto, achado em revisão).

/* ═══════════════════════════════════════════════════════════════════════
   RENDER GLOBAL
═══════════════════════════════════════════════════════════════════════ */
function renderAll() {
  const user = Storage.getUser();
  const weights = Storage.getWeights();

  // Cada bloco é independente — falha em um não impede os outros
  try { Profile.render(user); }                                                            catch (e) { console.error('[render] Profile:', e); }
  try { Charts.renderWeight(user, weights); }                                             catch (e) { console.error('[render] Charts:', e); }
  // Argumento ignorado por Charts.renderIntensity (fonte real: hr_zones do
  // Garmin, agregado no backend) — mantido sem args após a remoção de
  // Workouts (issue #36).
  try { Charts.renderIntensity(); }                                                       catch (e) { console.error('[render] Charts.renderIntensity:', e); }
  try { Rides.render(); }                                                                  catch (e) { console.error('[render] Rides:', e); }
  try { if (typeof renderMiniReport === 'function') renderMiniReport(); }                 catch (e) { console.error('[render] MiniReport:', e); }
  try { if (typeof renderWeightAnalysis === 'function') renderWeightAnalysis(); }         catch (e) { console.error('[render] WeightAnalysis:', e); }
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
      <div class="field avatar-upload-field">
        <label class="field-label">Foto do perfil</label>
        <div class="avatar-upload-row">
          <div class="avatar-upload-preview" id="avatar-preview">
            ${window.Avatar.html({ src: u.hasAvatar ? '/api/user/avatar?ts=' + (u.avatarUpdatedAt || '') : null, name: u.nome, size: 'lg' })}
          </div>
          <div class="avatar-upload-actions">
            <input id="f-avatar-file" type="file" accept="image/jpeg,image/png" hidden />
            <button type="button" id="btn-avatar-pick" class="btn btn-sm btn-primary">
              <i class="fa-solid fa-upload"></i> Enviar
            </button>
            <button type="button" id="btn-avatar-del" class="btn btn-sm btn-ghost" ${u.hasAvatar ? '' : 'hidden'}>
              <i class="fa-solid fa-trash"></i> Remover
            </button>
            <span class="field-hint">JPG ou PNG · até 3 MB · proporção quadrada recomendada</span>
          </div>
        </div>
      </div>

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
          <input id="f-altura" class="field-input" type="number" min="100" max="230" step="1" value="${escAttr(u.altura || '')}" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="f-sexo">Sexo</label>
          <select id="f-sexo" class="field-select">
            <option value="m"${u.sexo !== 'f' ? ' selected' : ''}>Masculino</option>
            <option value="f"${u.sexo === 'f' ? ' selected' : ''}>Feminino</option>
          </select>
          <span class="field-hint">Usado no guia do Endurance Score (tabela de referência Garmin).</span>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="f-meta">Peso meta (kg)</label>
          <input id="f-meta" class="field-input" type="number" min="30" max="250" step="0.1" value="${escAttr(u.pesoMeta || '')}" />
          <span class="field-hint">O peso atual vem automaticamente da balança Garmin.</span>
        </div>
        <div class="field">
          <label class="field-label" for="f-inicio">Data de início do plano</label>
          <input id="f-inicio" class="field-input" type="date" value="${esc(u.dataInicioPlano)}" />
          <span class="field-hint">A projeção das 12 semanas começa nesta data.</span>
        </div>
      </div>

      <div class="field-row" style="border-top:1px solid var(--border); padding-top:16px; margin-top:8px;">
        <div class="field">
          <label class="field-label" for="f-bmodelo">Modelo da bike</label>
          <input id="f-bmodelo" class="field-input" type="text" value="${esc(u.bikeModelo)}" placeholder="Gravel / MTB / Road" />
        </div>
        <div class="field">
          <label class="field-label" for="f-bpeso">Peso da bike (kg)</label>
          <input id="f-bpeso" class="field-input" type="number" min="3" max="30" step="0.1" value="${escAttr(u.bikePeso || '')}" />
        </div>
      </div>

      ${profileTreinoIaFieldsHTML(u)}
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Salvar',   kind: 'primary', onClick: (modal) => saveProfile(modal) },
    ],
    onMount: (modal) => {
      window.Avatar.wireFallbacks(modal);
      wireAvatarUpload(modal);
      modal.querySelector('#f-nome').focus();
    },
  });
}

// Treino IA (IDEIA-7) — intake de perfil usado por js/weekly-training-plan.js
// para montar os insumos do plano. Bloco dentro do mesmo modal de perfil
// (mantém o perfil como fonte única da verdade), mesmo padrão visual do
// bloco "bike" acima (field-row com border-top).
const TREINO_IA_OBJETIVOS = [
  { v: 'condicionamento', label: 'Condicionamento geral' },
  { v: 'performance',     label: 'Performance/velocidade' },
  { v: 'perdaPeso',       label: 'Perda de peso' },
];
const TREINO_IA_DIAS = [
  { v: 'segunda', label: 'Seg' }, { v: 'terca', label: 'Ter' }, { v: 'quarta', label: 'Qua' },
  { v: 'quinta', label: 'Qui' }, { v: 'sexta', label: 'Sex' }, { v: 'sabado', label: 'Sáb' }, { v: 'domingo', label: 'Dom' },
];
const TREINO_IA_NIVEIS = [
  { v: 'iniciante', label: 'Iniciante' }, { v: 'intermediario', label: 'Intermediário' }, { v: 'avancado', label: 'Avançado' },
];

function profileTreinoIaFieldsHTML(u) {
  const objetivos = u.objetivosPrioridade || [];
  const diasSet = new Set(u.diasDisponiveis || []);

  const selectObjetivo = (idx) => {
    const opts = ['<option value="">— selecione —</option>']
      .concat(TREINO_IA_OBJETIVOS.map((o) => `<option value="${o.v}"${objetivos[idx] === o.v ? ' selected' : ''}>${o.label}</option>`));
    return `<select id="f-tia-objetivo-${idx}" class="field-select">${opts.join('')}</select>`;
  };

  const diasCheckboxes = TREINO_IA_DIAS.map((d) => `
    <label style="display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;color:var(--muted);">
      <input type="checkbox" id="f-tia-dia-${d.v}" ${diasSet.has(d.v) ? 'checked' : ''} />
      ${d.label}
    </label>
  `).join('');

  const selectDiaLongao = ['<option value="">— selecione —</option>']
    .concat(TREINO_IA_DIAS.map((d) => `<option value="${d.v}"${u.diaLongao === d.v ? ' selected' : ''}>${d.label}</option>`))
    .join('');

  const selectNivel = ['<option value="">— selecione —</option>']
    .concat(TREINO_IA_NIVEIS.map((n) => `<option value="${n.v}"${u.nivelExperiencia === n.v ? ' selected' : ''}>${n.label}</option>`))
    .join('');

  return `
    <div style="border-top:1px solid var(--border); padding-top:16px; margin-top:8px;">
      <label class="field-label" style="display:block;margin-bottom:8px;">Treino IA — preferências</label>

      <div class="field-row">
        <div class="field"><label class="field-label" for="f-tia-objetivo-0">1º objetivo</label>${selectObjetivo(0)}</div>
        <div class="field"><label class="field-label" for="f-tia-objetivo-1">2º objetivo</label>${selectObjetivo(1)}</div>
        <div class="field"><label class="field-label" for="f-tia-objetivo-2">3º objetivo (opcional)</label>${selectObjetivo(2)}</div>
      </div>

      <div class="field" style="margin-top:12px;">
        <label class="field-label">Dias disponíveis para treinar</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">${diasCheckboxes}</div>
      </div>

      <div class="field-row" style="margin-top:12px;">
        <div class="field">
          <label class="field-label" for="f-tia-duracao">Duração por sessão (min)</label>
          <input id="f-tia-duracao" class="field-input" type="number" min="15" max="300" step="5" value="${escAttr(u.duracaoSessaoMin || '')}" />
        </div>
        <div class="field">
          <label class="field-label" for="f-tia-longao">Dia do treino longão</label>
          <select id="f-tia-longao" class="field-select">${selectDiaLongao}</select>
        </div>
        <div class="field">
          <label class="field-label" for="f-tia-nivel">Nível de experiência</label>
          <select id="f-tia-nivel" class="field-select">${selectNivel}</select>
        </div>
      </div>
    </div>
  `;
}

function wireAvatarUpload(modal) {
  const fileInput = modal.querySelector('#f-avatar-file');
  const pickBtn   = modal.querySelector('#btn-avatar-pick');
  const delBtn    = modal.querySelector('#btn-avatar-del');
  const preview   = modal.querySelector('#avatar-preview');
  if (!fileInput || !pickBtn) return;

  const refreshPreview = (src) => {
    const u = Storage.getUser();
    preview.innerHTML = window.Avatar.html({ src, name: u.nome, size: 'lg' });
    window.Avatar.wireFallbacks(preview);
  };

  pickBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast('Use JPG ou PNG', { kind: 'error' }); return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast('Arquivo maior que 3 MB', { kind: 'error' }); return;
    }
    pickBtn.disabled = true;
    pickBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…';
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => {
          const parts = String(reader.result).split(',');
          if (parts.length !== 2 || !parts[1]) {
            rej(new Error('Arquivo não gerou data URI válido'));
            return;
          }
          res(parts[1]);
        };
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const resp = await window.Api.post('/user/avatar', { data: base64, mime: file.type });
      const u = Storage.getUser();
      Storage.setUser({ ...u, hasAvatar: true, avatarUpdatedAt: resp.updatedAt });
      refreshPreview('/api/user/avatar?ts=' + encodeURIComponent(resp.updatedAt));
      delBtn.hidden = false;
      toast('Foto atualizada');
      // re-renderiza ID card no fundo
      try { renderAll(); } catch (_) {}
    } catch (err) {
      toast('Falha no upload: ' + (err.message || err), { kind: 'error' });
    } finally {
      pickBtn.disabled = false;
      pickBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Enviar';
      fileInput.value = '';
    }
  });

  delBtn?.addEventListener('click', async () => {
    const ok = await window.Modals.confirm({
      title: 'Remover a foto do perfil?',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.Api.del('/user/avatar');
      const u = Storage.getUser();
      Storage.setUser({ ...u, hasAvatar: false, avatarUpdatedAt: null });
      refreshPreview(null);
      delBtn.hidden = true;
      toast('Foto removida');
      try { renderAll(); } catch (_) {}
    } catch (err) {
      toast('Falha ao remover: ' + (err.message || err), { kind: 'error' });
    }
  });
}

function saveProfile(modal) {
  const get = (id) => modal.querySelector('#' + id).value.trim();
  const num = (id) => {
    const v = parseFloat(get(id));
    return isNaN(v) ? 0 : v;
  };

  // Treino IA — objetivos em ordem (descarta vazios, sem reindexar seleção
  // do usuário: se pular o 2º e preencher o 3º, perde o 3º — UX aceitável
  // pra v1, já que o form já mostra os 3 selects sequenciais). O mesmo
  // objetivo em duas posições é rejeitado aqui — a whitelist do backend
  // (arrEnum) já descarta o campo inteiro nesse caso, mas só loga um
  // warning, sem avisar o usuário; melhor bloquear antes de enviar.
  const objetivosBrutos = [0, 1, 2]
    .map((i) => modal.querySelector('#f-tia-objetivo-' + i)?.value)
    .filter(Boolean);
  const objetivosPrioridade = [...new Set(objetivosBrutos)];
  if (objetivosPrioridade.length !== objetivosBrutos.length) {
    toast('Não repita o mesmo objetivo em posições diferentes', { kind: 'error' });
    return;
  }
  const diasDisponiveis = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo']
    .filter((d) => modal.querySelector('#f-tia-dia-' + d)?.checked);

  const current = Storage.getUser();
  const updated = {
    ...current,
    nome:            get('f-nome'),
    dataNascimento:  get('f-nasc'),
    sexo:            get('f-sexo') || 'm',
    altura:          num('f-altura'),
    // pesoAtual NÃO é editável aqui — vem do sync da balança Garmin
    pesoMeta:        num('f-meta'),
    dataInicioPlano: get('f-inicio') || tbToday(),
    bikeModelo:      get('f-bmodelo'),
    bikePeso:        num('f-bpeso'),
    objetivosPrioridade,
    diasDisponiveis,
    duracaoSessaoMin: num('f-tia-duracao'),
    diaLongao:        get('f-tia-longao'),
    nivelExperiencia: get('f-tia-nivel'),
  };

  if (!updated.nome)                          { toast('Informe seu nome', { kind: 'error' }); return; }
  if (!updated.altura || updated.altura < 100) { toast('Altura inválida', { kind: 'error' }); return; }

  Storage.setUser(updated);
  renderAll();
  Modals.close();
  toast('Perfil atualizado');
}

/* ═══════════════════════════════════════════════════════════════════════
   ONBOARDING — abre automaticamente no primeiro acesso (sem nome)
═══════════════════════════════════════════════════════════════════════ */
function openOnboardingModal() {
  Modals.open({
    tag: 'Bem-vindo',
    title: 'Bem-vindo ao VELOCE LABS',
    bodyHTML: `
      <p style="color:var(--muted2);font-size:13px;line-height:1.6;margin-bottom:20px;">
        Vamos configurar seu perfil para personalizar as zonas de treino e a projeção de peso.
      </p>
      <div class="field">
        <label class="field-label" for="ob-nome">Nome *</label>
        <input id="ob-nome" class="field-input" type="text" placeholder="Seu nome" />
      </div>
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="ob-nasc">Data de nascimento</label>
          <input id="ob-nasc" class="field-input" type="date" />
        </div>
        <div class="field">
          <label class="field-label" for="ob-altura">Altura (cm)</label>
          <input id="ob-altura" class="field-input" type="number" min="100" max="230" step="1" placeholder="170" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="ob-sexo">Sexo</label>
          <select id="ob-sexo" class="field-select">
            <option value="m" selected>Masculino</option>
            <option value="f">Feminino</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label" for="ob-peso">Peso atual (kg)</label>
          <input id="ob-peso" class="field-input" type="number" min="30" max="250" step="0.1" placeholder="80,0" />
        </div>
        <div class="field">
          <label class="field-label" for="ob-meta">Peso meta (kg)</label>
          <input id="ob-meta" class="field-input" type="number" min="30" max="250" step="0.1" placeholder="70,0" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="ob-bmodelo">Modelo da bike</label>
          <input id="ob-bmodelo" class="field-input" type="text" placeholder="Gravel / MTB / Road" />
        </div>
        <div class="field">
          <label class="field-label" for="ob-bpeso">Peso da bike (kg)</label>
          <input id="ob-bpeso" class="field-input" type="number" min="3" max="30" step="0.1" placeholder="11,0" />
        </div>
      </div>
    `,
    actions: [
      { label: 'Começar!', kind: 'primary', onClick: (modal) => saveOnboarding(modal) },
    ],
    onMount: (modal) => modal.querySelector('#ob-nome').focus(),
  });
}

function saveOnboarding(modal) {
  const get = (id) => modal.querySelector('#' + id).value.trim();
  const num = (id) => { const v = parseFloat(get(id)); return isNaN(v) ? 0 : v; };

  const nome = get('ob-nome');
  if (!nome) { toast('Informe seu nome', { kind: 'error' }); return; }

  const u = Storage.getUser();
  Storage.setUser({
    ...u,
    nome,
    dataNascimento:  get('ob-nasc'),
    sexo:            get('ob-sexo') || 'm',
    altura:          num('ob-altura') || 170,
    pesoAtual:       num('ob-peso')   || 80,
    pesoMeta:        num('ob-meta')   || 70,
    bikeModelo:      get('ob-bmodelo') || 'Gravel',
    bikePeso:        num('ob-bpeso')  || 11,
    dataInicioPlano: u.dataInicioPlano || tbToday(),
  });

  renderAll();
  Modals.close();
  toast(`Bem-vindo, ${esc(nome)}! Perfil configurado.`);
}

/* ═══════════════════════════════════════════════════════════════════════
   MINI-RELATÓRIO 90 DIAS
═══════════════════════════════════════════════════════════════════════ */
function renderMiniReport() {
  if (window.Heatmap) Heatmap.render();
  const el = document.getElementById('report-90d');
  if (!el || typeof TrainingLog === 'undefined') return;

  const stats = TrainingLog.get90DayStats();

  if (stats.diasTreinados === 0) {
    el.style.display = 'none';
    return;
  }

  el.style.display = '';
  document.getElementById('r90-dias').textContent = stats.diasTreinados;
  document.getElementById('r90-tipo').textContent =
    stats.tipoMaisFreq ? (TrainingLog.TL_TYPES[stats.tipoMaisFreq]?.label || stats.tipoMaisFreq) : '—';
  document.getElementById('r90-peso').textContent =
    stats.mediaPeso ? stats.mediaPeso.toString().replace('.', ',') + ' kg' : '—';
}
window.renderMiniReport = renderMiniReport;

/* ═══════════════════════════════════════════════════════════════════════
   ANÁLISE DE PESO — taxa semanal por regressão linear + previsão da meta
   (Fase 5b)
═══════════════════════════════════════════════════════════════════════ */
function renderWeightAnalysis() {
  const card = document.getElementById('weight-analysis');
  if (!card) return;

  // Todo o cálculo (consolidação por dia, janela da regressão, previsão)
  // vive em js/core/weight-stats.js, compartilhado com a tela Perfil mobile.
  const a = WeightStats.weightAnalysis(Storage.getUser(), Storage.getWeights());
  if (!a.ok) { card.style.display = 'none'; return; }

  card.style.display = '';

  // Sinal reflete o número literal (kg/semana); a cor reflete se a tendência
  // bate com o objetivo (taxaPositiva já normaliza isso pros dois sentidos).
  const sign = a.taxaKgSem > 0 ? '+' : '';
  const taxaEl = document.getElementById('wa-taxa');
  taxaEl.textContent = `${sign}${a.taxaKgSem.toString().replace('.', ',')}`;
  taxaEl.style.color = a.taxaPositiva ? 'var(--lime)' : 'var(--magenta)';

  const faltamEl = document.getElementById('wa-faltam');
  const faltamAbs = Math.abs(a.faltam).toString().replace('.', ',');
  faltamEl.textContent = a.metaAtingida
    ? '✓ Meta atingida'
    : a.objetivoGanho ? `${faltamAbs} kg para ganhar` : `${faltamAbs} kg`;
  // Ainda ter peso a perder/ganhar é "negativo" → magenta; meta atingida → lime.
  faltamEl.style.color = a.metaAtingida ? 'var(--lime)' : 'var(--magenta)';

  document.getElementById('wa-previsao').textContent = a.previsao;
  document.getElementById('wa-semanas').textContent  = a.semanas;
  const msgEl = document.getElementById('wa-msg');
  if (msgEl) { msgEl.textContent = a.msg; msgEl.style.display = a.msg ? '' : 'none'; }
}
window.renderWeightAnalysis = renderWeightAnalysis;

/* ═══════════════════════════════════════════════════════════════════════
   MODO DE EDIÇÃO — toggle global que exibe botões de edit/delete
═══════════════════════════════════════════════════════════════════════ */
function toggleEditMode() {
  const on = document.body.classList.toggle('edit-mode');
  document.getElementById('btn-edit-profile')?.classList.toggle('active', on);
}

/* ═══════════════════════════════════════════════════════════════════════
   AUTH — gate de boot e logout. Lógica em js/core/session.js (issue #13),
   compartilhada com js/mobile/boot.js + js/mobile/more-mobile.js.
═══════════════════════════════════════════════════════════════════════ */
const { ensureAuthenticated, doLogout } = window.Session;

/* ═══════════════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════════════ */
async function boot() {
  console.log(`%c[VELOCE LABS] Boot v${window.APP_VERSION || '?'}`, 'color:#14d9b8;font-weight:bold');

  // 0. Gate de autenticação — redireciona pra /login.html se não há sessão
  const authed = await ensureAuthenticated();
  if (!authed) return;

  // Helper: roda passo do boot capturando erro mas não interrompendo
  const safe = async (label, fn) => {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') await r;
      console.log(`  ✓ ${label}`);
    } catch (e) {
      console.error(`  ✗ ${label}:`, e);
    }
  };

  // 1. Carrega todas as entidades do backend para os caches em memoria
  await safe('Storage.loadAll()', () => Storage.loadAll());

  // 1.1 Sinaliza falhas de carga (BUG-015) — evita o usuário pensar que
  // o banco sumiu e tentar recadastrar dados.
  if (Array.isArray(window.LOAD_ERRORS) && window.LOAD_ERRORS.length) {
    const labels = window.LOAD_ERRORS.map(f => f.label).join(', ');
    console.error('[boot] Falhas ao carregar dados:', window.LOAD_ERRORS);
    const msg = `Falha ao carregar: ${labels}. Recarregue a página antes de modificar dados.`;
    try {
      // Erro crítico — toast de erro com duração longa (não some rápido);
      // modal do sistema como fallback. Sem alert() nativo.
      if (typeof window.toast === 'function') {
        window.toast(msg, { kind: 'error', duration: 8000 });
      } else if (window.Modals && Modals.open) {
        Modals.open({ tag: 'Erro', title: 'Falha ao carregar',
          bodyHTML: `<p class="modal-confirm-text">${esc(msg)}</p>` });
      }
    } catch (_) {}
  }

  // 1.5. Migracao legada (1a execucao): se backend vazio, le dados_usuario.txt
  await safe('Migração legada', () => tbMigrate());

  // 2. Charts — inicia estrutura vazia antes de renderizar
  await safe('Charts.init()', () => Charts && Charts.init && Charts.init());

  // 3. Rides — init ANTES de renderAll (registra addEventListener nos botões)
  await safe('Rides.init()', () => Rides && Rides.init && Rides.init());

  // 3.5 Bikes — init listeners (load só quando navegar para a seção)
  await safe('Bikes.init()', () => window.Bikes && window.Bikes.init && window.Bikes.init());

  // 4. TrainingLog.init
  await safe('TrainingLog.init()', () => TrainingLog && TrainingLog.init && TrainingLog.init());

  // 6. Routes.init
  await safe('Routes.init()', () => Routes && Routes.init && Routes.init());

  // 6.5 Strava — carrega status (fire-and-forget; nao bloqueia boot)
  await safe('Strava.load()', () => window.Strava && window.Strava.load && window.Strava.load());

  // 6.55 Garmin — carrega status
  await safe('Garmin.load()', () => window.Garmin && window.Garmin.load && window.Garmin.load());

  // 6.6 Activities dashboard
  await safe('Activities.load()', () => window.Activities && window.Activities.load && window.Activities.load());

  // 6.7 Insights (Fase 7) — relatórios derivados dos dados Garmin
  await safe('Insights.load()', () => window.Insights && window.Insights.load && window.Insights.load());

  // 6.8 Home (Fase 8.2) — landing page com resumo executivo
  await safe('Home.load()', () => window.Home && window.Home.load && window.Home.load());

  // 7. Render global
  await safe('renderAll()', () => renderAll());

  // 8. Wire dos botões fixos da nav
  await safe('Wire dos botões da nav', () => {
    document.getElementById('btn-edit-profile')?.addEventListener('click', toggleEditMode);
    document.getElementById('btn-edit-profile-2')?.addEventListener('click', openProfileModal);
    document.getElementById('btn-backup')?.addEventListener('click', () => Backup && Backup.open && Backup.open());
    document.getElementById('btn-logout')?.addEventListener('click', doLogout);
    document.getElementById('btn-notif')?.addEventListener('click', () => window.Notifications && Notifications.open());
  });

  // 9. Footer — versão e ano
  await safe('Footer', () => {
    const fv = document.getElementById('footer-version');
    const fy = document.getElementById('footer-year');
    if (fv) fv.textContent = 'v' + (window.APP_VERSION || '?');
    if (fy) fy.textContent = new Date().getFullYear();
  });

  // 10. Router SPA — substitui o IntersectionObserver de scroll por hash routing
  await safe('Router.init()', () => {
    if (window.Router) {
      Router.rebindNav();
      Router.init();
    }
  });

  // 11. Onboarding — abre se não há nome cadastrado (primeiro acesso)
  await safe('Onboarding', () => {
    const u = Storage.getUser();
    if (!u.nome) setTimeout(() => openOnboardingModal(), 400);
  });

  // 12. Notificações (sino) — computa em background, não bloqueia o boot.
  window.Notifications?.load();

  console.log('[VELOCE LABS] Boot concluído');
}

document.addEventListener('DOMContentLoaded', boot);
