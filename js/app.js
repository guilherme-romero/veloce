/* ═══════════════════════════════════════════════════════════════════════
   APP — bootstrap, navegação, handlers globais
═══════════════════════════════════════════════════════════════════════ */

const NAV_SECTIONS = ['profile', 'zones', 'home-workout', 'plan', 'rides', 'routes', 'activities'];

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

  // Cada bloco é independente — falha em um não impede os outros
  try { Profile.render(user); }                                                            catch (e) { console.error('[render] Profile:', e); }
  try { Charts.renderWeight(user, weights); }                                             catch (e) { console.error('[render] Charts:', e); }
  try { Workouts.renderModes(); }                                                         catch (e) { console.error('[render] Workouts.renderModes:', e); }
  try { Workouts.renderCalendar(); }                                                      catch (e) { console.error('[render] Workouts.renderCalendar:', e); }
  try { Charts.renderIntensity(Workouts.getCurrentWorkouts()); }                          catch (e) { console.error('[render] Charts.renderIntensity:', e); }
  try { Rides.render(); }                                                                  catch (e) { console.error('[render] Rides:', e); }
  try { if (typeof HomeWorkout !== 'undefined') HomeWorkout.render(); }                  catch (e) { console.error('[render] HomeWorkout:', e); }
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
    onMount: (modal) => {
      wireAvatarUpload(modal);
      modal.querySelector('#f-nome').focus();
    },
  });
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
        reader.onload  = () => res(String(reader.result).split(',')[1]);
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
    if (!confirm('Remover a foto do perfil?')) return;
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

  const current = Storage.getUser();
  const updated = {
    ...current,
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

async function saveWeight(modal) {
  const data = modal.querySelector('#w-data').value;
  const peso = parseFloat(modal.querySelector('#w-peso').value);
  const tipo = modal.querySelector('#w-tipo').value;

  if (!data) { toast('Informe a data', { kind: 'error' }); return; }
  if (!peso) { toast('Informe o peso', { kind: 'error' }); return; }

  try {
    await Storage.addWeight({ data, peso: +peso.toFixed(1), tipo });
  } catch (e) {
    console.error('[saveWeight] falha:', e);
    toast('Falha ao salvar: ' + (e.message || 'erro'), { kind: 'error' });
    return;
  }

  if (tipo === 'atual') {
    const u = Storage.getUser();
    u.pesoAtual = +peso.toFixed(1);
    Storage.setUser(u);
  }

  renderAll();
  Modals.close();
  toast('Pesagem registrada');
}

/* ═══════════════════════════════════════════════════════════════════════
   ONBOARDING — abre automaticamente no primeiro acesso (sem nome)
═══════════════════════════════════════════════════════════════════════ */
function openOnboardingModal() {
  Modals.open({
    tag: 'Bem-vindo',
    title: 'Bem-vindo ao Treino Bike',
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

  const user    = Storage.getUser();
  const weights = Storage.getWeights()
    .filter(w => w.tipo === 'atual')
    .sort((a, b) => a.data.localeCompare(b.data));

  if (weights.length < 2 || !user.pesoMeta) {
    card.style.display = 'none';
    return;
  }

  // Regressão linear simples: y = peso, x = dias desde primeiro registro
  const t0 = new Date(weights[0].data + 'T12:00:00').getTime();
  const pts = weights.map(w => ({
    x: (new Date(w.data + 'T12:00:00').getTime() - t0) / 86400_000,
    y: w.peso,
  }));
  const n  = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxy= pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2= pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sx2 - sx * sx;
  if (denom === 0) { card.style.display = 'none'; return; }
  const slope = (n * sxy - sx * sy) / denom; // kg/dia
  const taxaKgSem = +(slope * 7).toFixed(2);  // negativo = perda

  const pesoAtual = weights[weights.length - 1].peso;
  const faltam    = +(pesoAtual - user.pesoMeta).toFixed(1);

  card.style.display = '';

  const sign = taxaKgSem <= 0 ? '' : '+';
  document.getElementById('wa-taxa').textContent     = `${sign}${taxaKgSem.toString().replace('.', ',')}`;
  document.getElementById('wa-faltam').textContent   = faltam > 0 ? `${faltam.toString().replace('.', ',')} kg` : '✓ Meta atingida';

  let previsao = '—', semanas = '—', msg = '';
  if (faltam <= 0) {
    previsao = 'Meta atingida!';
    semanas  = '0';
    msg      = 'Parabéns! Você atingiu sua meta de peso.';
  } else if (slope < 0) {
    const diasNecessarios = faltam / Math.abs(slope);
    const semsNec = Math.ceil(diasNecessarios / 7);
    const dataEst = new Date(Date.now() + diasNecessarios * 86400_000);
    previsao = dataEst.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
    semanas  = semsNec.toString();
    if (semsNec > 52) msg = 'Taxa atual lenta — considere ajustar plano.';
    else if (semsNec > 26) msg = 'Progresso consistente — mantenha o ritmo!';
    else msg = `Meta em ~${semsNec} semanas no ritmo atual.`;
  } else {
    previsao = 'N/A';
    semanas  = '—';
    msg      = 'Taxa atual indica ganho de peso — revise alimentação e treinos.';
  }
  document.getElementById('wa-previsao').textContent = previsao;
  document.getElementById('wa-semanas').textContent  = semanas;
  const msgEl = document.getElementById('wa-msg');
  if (msgEl) { msgEl.textContent = msg; msgEl.style.display = msg ? '' : 'none'; }
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
   AUTH — gate de boot e logout
═══════════════════════════════════════════════════════════════════════ */
async function ensureAuthenticated() {
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (resp.ok) return true;
  } catch (e) {
    console.warn('[auth] backend indisponível, redirecionando para login');
  }
  window.location.replace('/login.html');
  return false;
}

async function doLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (e) { /* ignore */ }
  window.location.replace('/login.html');
}

/* ═══════════════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════════════ */
async function boot() {
  console.log(`%c[Treino Bike] Boot v${window.APP_VERSION || '?'}`, 'color:#14d9b8;font-weight:bold');

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

  // 1.5. Migracao legada (1a execucao): se backend vazio, le dados_usuario.txt
  await safe('Migração legada', () => tbMigrate());

  // 2. Charts — inicia estrutura vazia antes de renderizar
  await safe('Charts.init()', () => Charts && Charts.init && Charts.init());

  // 3. Rides — init ANTES de renderAll (registra addEventListener nos botões)
  await safe('Rides.init()', () => Rides && Rides.init && Rides.init());

  // 4. TrainingLog.init
  await safe('TrainingLog.init()', () => TrainingLog && TrainingLog.init && TrainingLog.init());

  // 5. HomeWorkout.init
  await safe('HomeWorkout.init()', () => HomeWorkout && HomeWorkout.init && HomeWorkout.init());

  // 6. Routes.init
  await safe('Routes.init()', () => Routes && Routes.init && Routes.init());

  // 6.5 Strava — carrega status (fire-and-forget; nao bloqueia boot)
  await safe('Strava.load()', () => window.Strava && window.Strava.load && window.Strava.load());

  // 6.55 Garmin — carrega status
  await safe('Garmin.load()', () => window.Garmin && window.Garmin.load && window.Garmin.load());

  // 6.6 Activities dashboard
  await safe('Activities.load()', () => window.Activities && window.Activities.load && window.Activities.load());

  // 7. Render global
  await safe('renderAll()', () => renderAll());

  // 8. Wire dos botões fixos da nav
  await safe('Wire dos botões da nav', () => {
    document.getElementById('btn-edit-profile')?.addEventListener('click', toggleEditMode);
    document.getElementById('btn-edit-profile-2')?.addEventListener('click', openProfileModal);
    document.getElementById('btn-add-weight')?.addEventListener('click', openWeightModal);
    document.getElementById('btn-backup')?.addEventListener('click', () => Backup && Backup.open && Backup.open());
    document.getElementById('btn-logout')?.addEventListener('click', doLogout);

    // Plano de treino — export/import isolado
    document.getElementById('btn-export-plan')?.addEventListener('click', () => Workouts.exportPlan());
    document.getElementById('plan-import-file')?.addEventListener('change', (e) => {
      Workouts.importPlan(e.target.files[0]);
      e.target.value = '';
    });
  });

  // 9. Footer — versão e ano
  await safe('Footer', () => {
    const fv = document.getElementById('footer-version');
    const fy = document.getElementById('footer-year');
    if (fv) fv.textContent = 'v' + (window.APP_VERSION || '?');
    if (fy) fy.textContent = new Date().getFullYear();
  });

  // 10. IntersectionObserver para nav ativo no scroll
  await safe('IntersectionObserver nav', () => {
    if (typeof IntersectionObserver !== 'function') return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) setActiveNav(e.target.id);
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    NAV_SECTIONS.forEach(id => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  });

  // 11. Onboarding — abre se não há nome cadastrado (primeiro acesso)
  await safe('Onboarding', () => {
    const u = Storage.getUser();
    if (!u.nome) setTimeout(() => openOnboardingModal(), 400);
  });

  console.log('[Treino Bike] Boot concluído');
}

document.addEventListener('DOMContentLoaded', boot);
