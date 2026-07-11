/* ═══════════════════════════════════════════════════════════════════════
   GARMIN — UI da integracao (Fase 4.5c)
   - Carrega /api/garmin/status e popula o card #garmin-card
   - Botao Sincronizar dispara POST /api/garmin/sync
   - Login inicial: se status diz no_session, mostra botao Conectar
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  // Data + hora do último sync para o mini-card (ex.: { data: "20 jun", hora: "17:01" })
  function fmtSyncParts(iso) {
    if (!iso) return { data: 'nunca', hora: '' };
    try {
      const d = new Date(iso);
      return {
        data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace(' de ', ' ').replace('.', ''),
        hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
    } catch { return { data: '—', hora: '' }; }
  }
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
    // syncMeta (não `sync`): evita sombrear a função sync() do módulo, senão o
    // addEventListener abaixo liga um objeto no lugar da função e o botão não faz nada.
    const syncMeta = fmtSyncParts(status.lastSyncAt);
    const syncLabel = syncMeta.hora ? `${esc(syncMeta.hora)} · último sync` : 'último sync';

    bodyEl.innerHTML =
      '<div class="strava-stats">' +
        `<div class="strava-stat"><div class="strava-stat-val">${totalAct}</div><div class="strava-stat-label">atividades</div></div>` +
        `<div class="strava-stat"><div class="strava-stat-val">${esc(syncMeta.data)}</div><div class="strava-stat-label">${syncLabel}</div></div>` +
      '</div>' +
      '<div class="conn-athlete">Sincroniza atividades, peso, sono, HRV e readiness. Auto-sync a cada 30 min.</div>' +
      '<div class="strava-actions">' +
        '<button type="button" id="btn-garmin-sync" class="btn btn-primary">' +
          '<i class="fa-solid fa-rotate"></i> Sincronizar' +
        '</button>' +
        '<button type="button" id="btn-garmin-logout" class="btn btn-ghost">' +
          '<i class="fa-solid fa-right-from-bracket"></i> Desconectar' +
        '</button>' +
      '</div>';

    $('btn-garmin-sync')?.addEventListener('click', sync);
    $('btn-garmin-logout')?.addEventListener('click', doLogout);

    // Carrega Training Status sob demanda (não bloqueia render)
    loadTrainingStatus();
  }

  async function loadTrainingStatus() {
    const badge = $('garmin-training-badge');
    if (!badge) return;
    try {
      const items = await window.Api.get('/garmin/training-status?days=7');
      if (!Array.isArray(items) || items.length === 0) return;
      // Pega o item mais recente com status válido
      const latest = items.find(i => i.status_label && i.status_label !== 'NO_STATUS');
      if (!latest) return;

      const STATUS_LABELS = {
        PRODUCTIVE: { txt: 'Produtivo', icon: '↑', color: 'var(--green)' },
        MAINTAINING: { txt: 'Mantendo', icon: '→', color: 'var(--teal)' },
        RECOVERY: { txt: 'Recuperação', icon: '↓', color: 'var(--blue)' },
        DETRAINING: { txt: 'Destreino', icon: '↓', color: 'var(--muted2)' },
        PEAKING: { txt: 'Picando', icon: '↑↑', color: 'var(--amber)' },
        OVERREACHING: { txt: 'Sobrecarga', icon: '⚠', color: 'var(--red)' },
        UNPRODUCTIVE: { txt: 'Improdutivo', icon: '↓', color: 'var(--red)' },
        STRAINED: { txt: 'Tensionado', icon: '⚠', color: 'var(--red)' },
        NO_STATUS: { txt: 'Sem dados', icon: '', color: 'var(--muted2)' },
      };
      const info = STATUS_LABELS[latest.status_label] || { txt: latest.status_label, icon: '', color: 'var(--muted2)' };
      const trendIcon = latest.fitness_trend > 0 ? ' ↑' : latest.fitness_trend < 0 ? ' ↓' : '';
      badge.innerHTML =
        `<div class="garmin-status-badge" style="border-color:${info.color}; color:${info.color}; background:${info.color}20;">` +
          `<span class="garmin-status-label">Status:</span> ` +
          `<strong>${info.txt}${trendIcon}</strong>` +
        `</div>`;
    } catch (e) {
      console.warn('[garmin training-status]', e);
    }
  }

  // Modal explicativo (i) — como funciona a conexão Garmin (Fase 17.4)
  function openInfo() {
    if (!window.Modals) return;
    Modals.open({
      tag: 'Conexões',
      title: 'Como funciona o Garmin Connect',
      bodyHTML: `
        <div class="conn-info-body">
          <p><strong>Login não-oficial.</strong> A conexão usa a biblioteca
          <code>python-garminconnect</code> fazendo login com seu e-mail e senha
          (definidos em <code>server/.env</code>). A sessão SSO fica salva em
          <code>data/garmin_session/</code> no servidor.</p>
          <p><strong>MFA:</strong> se a sua conta tem verificação em duas etapas,
          o app pede o código no momento de <em>Conectar</em>.</p>
          <p><strong>O que importa:</strong> atividades, pesagens da balança,
          dados de saúde (sono, HRV, stress, Body Battery), Training Readiness,
          recordes pessoais e scores.</p>
          <p><strong>Atenção:</strong> por ser um login não-oficial, muitos
          acessos em sequência podem levar a bloqueio temporário de IP pela Garmin.
          A sincronização automática roda a cada 30 min para manter os dados frescos.</p>
        </div>`,
      actions: [{ label: 'Entendi', kind: 'primary', onClick: () => Modals.close() }],
    });
  }

  async function load() {
    const stateEl = $('garmin-state');
    if (!stateEl) return;
    $('garmin-info') && ($('garmin-info').onclick = openInfo);
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
      if (window.toast) window.toast('Conectado à Garmin', { kind: 'success' });
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
          if (window.toast) window.toast('Conectado à Garmin', { kind: 'success' });
          await load();
        } catch (e2) {
          if (window.toast) window.toast('Falha no login: ' + (e2.message || e2), { kind: 'error' });
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plug"></i> Conectar'; }
        }
        return;
      }
      if (window.toast) window.toast('Falha no login: ' + (err.message || err), { kind: 'error' });
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plug"></i> Conectar'; }
    }
  }

  async function doLogout() {
    const ok = await window.Modals.confirm({
      title: 'Desconectar a sessão Garmin?',
      message: 'Será necessário reconectar para sincronizar novas atividades e dados de saúde.',
      confirmLabel: 'Desconectar',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.Api.post('/garmin/logout', {});
      if (window.toast) window.toast('Sessão Garmin removida');
      await load();
    } catch (err) {
      if (window.toast) window.toast('Falha: ' + (err.message || err), { kind: 'error' });
    }
  }

  async function sync() {
    const btn = $('btn-garmin-sync');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando…'; }
    try {
      const [actRes, weiRes, healthRes, extrasRes] = await Promise.all([
        window.Api.post('/garmin/sync', { days: 90 }),
        window.Api.post('/garmin/sync-weights', { days: 365 }).catch(e => ({ error: e })),
        window.Api.post('/garmin/sync-health', { days: 30 }).catch(e => ({ error: e })),
        window.Api.post('/garmin/sync-extras', { days: 14 }).catch(e => ({ error: e })),
      ]);
      const parts = [
        `${actRes.imported} ativ.`,
        `${actRes.daysMarked} dias marcados`,
      ];
      if (!weiRes.error && weiRes.imported) parts.push(`${weiRes.imported} pesagens`);
      if (!healthRes.error && healthRes.synced) parts.push(`${healthRes.synced} dias de saúde`);
      if (!extrasRes.error) {
        const extras = [];
        if (extrasRes.readiness) extras.push(`${extrasRes.readiness} readiness`);
        if (extrasRes.prs) extras.push(`${extrasRes.prs} PBs`);
        if (extrasRes.scores) extras.push(`${extrasRes.scores} scores`);
        if (extras.length) parts.push(extras.join(' + '));
      }
      if (window.toast) window.toast(parts.join(' · '), { kind: 'success' });
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
      if (window.toast) window.toast('Falha ao sincronizar: ' + (err.message || err), { kind: 'error' });
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sincronizar'; }
    }
  }

  window.Garmin = { load, sync, doLogin, doLogout, openInfo };
})();
