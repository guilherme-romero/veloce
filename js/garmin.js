/* ═══════════════════════════════════════════════════════════════════════
   GARMIN — UI da integracao (Fase 4.5c)
   - Carrega /api/garmin/status e popula o card #garmin-card
   - Botao Sincronizar dispara POST /api/garmin/sync
   - Login inicial: se status diz no_session, mostra botao Conectar
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return iso; }
  }

  function render(status) {
    const stateEl = $('garmin-state');
    const bodyEl  = $('garmin-body');
    if (!stateEl || !bodyEl) return;
    const esc = window.esc || (s => String(s || ''));

    if (!status.configured) {
      stateEl.textContent = 'não configurado';
      stateEl.className = 'strava-state disconnected';
      bodyEl.innerHTML = '<div class="strava-msg">Defina <code>GARMIN_EMAIL</code> e <code>GARMIN_PASSWORD</code> no <code>server/.env</code> e reinicie o backend.</div>';
      return;
    }

    if (!status.connected) {
      stateEl.textContent = status.reason === 'no_session' ? 'desconectado' : 'erro';
      stateEl.className = 'strava-state disconnected';
      const motivo = status.reason === 'no_session'
        ? 'Sessão Garmin não estabelecida. Clique em "Conectar" para fazer login.'
        : 'Falha ao consultar Garmin: ' + esc(status.reason || 'sem detalhes');
      bodyEl.innerHTML =
        `<div class="strava-msg">${motivo}</div>` +
        '<div class="strava-actions">' +
          '<button type="button" id="btn-garmin-login" class="btn btn-primary">' +
            '<i class="fa-solid fa-plug"></i> Conectar' +
          '</button>' +
        '</div>';
      const btn = $('btn-garmin-login');
      if (btn) btn.addEventListener('click', doLogin);
      return;
    }

    stateEl.textContent = 'conectado';
    stateEl.className = 'strava-state connected';

    const name = esc(status.fullName || status.email || 'Atleta');
    const totalAct = Number(status.totalActivities || 0);
    const lastSync = status.lastSyncAt ? fmtDate(status.lastSyncAt) : 'nunca';
    const avatar = window.Avatar.html({ name, size: 'md', alt: 'avatar Garmin' });

    bodyEl.innerHTML =
      '<div class="strava-row">' +
        avatar +
        '<div class="strava-info">' +
          `<div class="strava-athlete-name">${name}</div>` +
          `<div class="strava-athlete-meta">${esc(status.email || '')}</div>` +
        '</div>' +
      '</div>' +
      '<div class="strava-stats">' +
        `<div class="strava-stat"><div class="strava-stat-val">${totalAct}</div><div class="strava-stat-label">atividades importadas</div></div>` +
        `<div class="strava-stat"><div class="strava-stat-val" style="font-size:13px;">${esc(lastSync)}</div><div class="strava-stat-label">última sincronização</div></div>` +
      '</div>' +
      '<div class="strava-actions">' +
        '<button type="button" id="btn-garmin-sync" class="btn btn-primary">' +
          '<i class="fa-solid fa-rotate"></i> Sincronizar últimos 90 dias' +
        '</button>' +
        '<button type="button" id="btn-garmin-logout" class="btn btn-ghost btn-sm" style="margin-top:6px;">' +
          '<i class="fa-solid fa-right-from-bracket"></i> Desconectar' +
        '</button>' +
      '</div>';

    $('btn-garmin-sync')?.addEventListener('click', sync);
    $('btn-garmin-logout')?.addEventListener('click', doLogout);
  }

  async function load() {
    const stateEl = $('garmin-state');
    if (!stateEl) return;
    stateEl.textContent = 'verificando…';
    stateEl.className = 'strava-state';
    try {
      const status = await window.Api.get('/garmin/status');
      render(status);
    } catch (err) {
      console.error('[garmin]', err);
      stateEl.textContent = 'offline';
      stateEl.className = 'strava-state disconnected';
      const body = $('garmin-body');
      if (body) body.innerHTML = '<div class="strava-msg">Falha ao consultar o backend.</div>';
    }
  }

  async function doLogin() {
    const btn = $('btn-garmin-login');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Conectando…'; }
    try {
      await window.Api.post('/garmin/login', {});
      if (window.toast) window.toast('Conectado à Garmin', 'success');
      await load();
    } catch (err) {
      if (err.status === 409) {
        // MFA — pede o codigo
        const code = prompt('Digite o código de verificação (MFA) enviado pela Garmin:');
        if (!code) {
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plug"></i> Conectar'; }
          return;
        }
        try {
          await window.Api.post('/garmin/login', { mfa: code });
          if (window.toast) window.toast('Conectado à Garmin', 'success');
          await load();
        } catch (e2) {
          if (window.toast) window.toast('Falha no login: ' + (e2.message || e2), 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plug"></i> Conectar'; }
        }
        return;
      }
      if (window.toast) window.toast('Falha no login: ' + (err.message || err), 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plug"></i> Conectar'; }
    }
  }

  async function doLogout() {
    if (!confirm('Desconectar a sessão Garmin?')) return;
    try {
      await window.Api.post('/garmin/logout', {});
      if (window.toast) window.toast('Sessão Garmin removida');
      await load();
    } catch (err) {
      if (window.toast) window.toast('Falha: ' + (err.message || err), 'error');
    }
  }

  async function sync() {
    const btn = $('btn-garmin-sync');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando…'; }
    try {
      const [actRes, weiRes, healthRes] = await Promise.all([
        window.Api.post('/garmin/sync', { days: 90 }),
        window.Api.post('/garmin/sync-weights', { days: 365 }).catch(e => ({ error: e })),
        window.Api.post('/garmin/sync-health', { days: 30 }).catch(e => ({ error: e })),
      ]);
      const parts = [
        `${actRes.imported} ativ.`,
        `${actRes.daysMarked} dias marcados`,
      ];
      if (!weiRes.error && weiRes.imported) parts.push(`${weiRes.imported} pesagens`);
      if (!healthRes.error && healthRes.synced) parts.push(`${healthRes.synced} dias de saúde`);
      if (window.toast) window.toast(parts.join(' · '), 'success');
      try {
        if (window.Storage && Storage.loadAll) await Storage.loadAll();
        if (window.Rides && Rides.render) Rides.render();
        if (window.renderMiniReport) renderMiniReport();
        if (window.renderWeightAnalysis) renderWeightAnalysis();
        if (window.Activities && Activities.load) await Activities.load();
      } catch (e) { console.warn('[garmin] refresh local falhou', e); }
      await load();
    } catch (err) {
      console.error('[garmin] sync', err);
      if (window.toast) window.toast('Falha ao sincronizar: ' + (err.message || err), 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sincronizar últimos 90 dias'; }
    }
  }

  window.Garmin = { load, sync, doLogin, doLogout };
})();
