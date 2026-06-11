/* ═══════════════════════════════════════════════════════════════════════
   STRAVA — UI da integracao (Fase 4)
   - Carrega /api/strava/status e popula o card #strava-card
   - Botao Sincronizar dispara POST /api/strava/sync
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch { return iso; }
  }

  function avatarFor(a) {
    const name = `${a.firstname || ''} ${a.lastname || ''}`.trim() || a.username || '';
    // Foto do Strava removida — usa apenas iniciais (definido pela UX local)
    return window.Avatar.html({ name, size: 'md', alt: 'avatar Strava' });
  }

  function render(status) {
    const stateEl = $('strava-state');
    const bodyEl  = $('strava-body');
    if (!stateEl || !bodyEl) return;
    const esc = window.esc || ((s) => String(s || ''));

    if (!status.configured) {
      stateEl.textContent = 'não configurado';
      stateEl.className = 'strava-state disconnected';
      bodyEl.innerHTML =
        '<div class="strava-msg">Defina <code>STRAVA_CLIENT_ID</code>, ' +
        '<code>STRAVA_CLIENT_SECRET</code> e <code>STRAVA_REFRESH_TOKEN</code> ' +
        'no <code>server/.env</code> e reinicie o backend.</div>';
      return;
    }
    if (!status.connected) {
      stateEl.textContent = 'erro';
      stateEl.className = 'strava-state disconnected';
      bodyEl.innerHTML = `<div class="strava-msg">Não consegui conectar ao Strava: ${esc(status.error || 'sem detalhes')}</div>`;
      return;
    }

    stateEl.textContent = 'conectado';
    stateEl.className = 'strava-state connected';

    const a = status.athlete || {};
    const name = esc(`${a.firstname || ''} ${a.lastname || ''}`.trim() || a.username || 'Atleta');
    const metaParts = [a.city, a.country].filter(Boolean).map(esc).join(', ');
    const totalAct = Number(status.totalActivities || 0);
    const lastSync = status.lastSyncAt ? fmtDate(status.lastSyncAt) : 'nunca';

    bodyEl.innerHTML =
      '<div class="strava-row">' +
        avatarFor(a) +
        '<div class="strava-info">' +
          `<div class="strava-athlete-name">${name}</div>` +
          (metaParts ? `<div class="strava-athlete-meta">${metaParts} · @${esc(a.username || '')}</div>` : `<div class="strava-athlete-meta">@${esc(a.username || '')}</div>`) +
        '</div>' +
      '</div>' +
      '<div class="strava-stats">' +
        `<div class="strava-stat"><div class="strava-stat-val">${totalAct}</div><div class="strava-stat-label">atividades importadas</div></div>` +
        `<div class="strava-stat"><div class="strava-stat-val" style="font-size:13px;">${esc(lastSync)}</div><div class="strava-stat-label">última sincronização</div></div>` +
      '</div>' +
      '<div class="strava-actions">' +
        '<button type="button" id="btn-strava-sync" class="btn btn-primary">' +
          '<i class="fa-solid fa-rotate"></i> Sincronizar últimos 90 dias' +
        '</button>' +
      '</div>';

    const btn = $('btn-strava-sync');
    if (btn) btn.addEventListener('click', sync);
  }

  async function load() {
    const stateEl = $('strava-state');
    if (!stateEl) return;
    stateEl.textContent = 'verificando…';
    stateEl.className = 'strava-state';
    try {
      const status = await window.Api.get('/strava/status');
      render(status);
    } catch (err) {
      console.error('[strava]', err);
      stateEl.textContent = 'offline';
      stateEl.className = 'strava-state disconnected';
      const body = $('strava-body');
      if (body) body.innerHTML = '<div class="strava-msg">Falha ao consultar o backend.</div>';
    }
  }

  async function sync() {
    const btn = $('btn-strava-sync');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando…';
    }
    try {
      const res = await window.Api.post('/strava/sync', { days: 90 });
      const msg = `${res.imported} importadas · ${res.updated} atualizadas · ${res.daysMarked} dias marcados`;
      if (window.toast) window.toast(msg, 'success');
      // Recarrega training_log no cache local p/ refletir badges no calendario
      try {
        if (window.Storage && Storage.loadAll) await Storage.loadAll();
        if (window.Rides && Rides.renderCalendar) Rides.renderCalendar();
        if (window.TrainingLog && TrainingLog.refresh) TrainingLog.refresh();
      } catch (e) { console.warn('[strava] refresh local falhou', e); }
      await load();
    } catch (err) {
      console.error('[strava] sync', err);
      if (window.toast) window.toast('Falha ao sincronizar: ' + (err.message || err), 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sincronizar últimos 90 dias';
      }
    }
  }

  window.Strava = { load, sync };
})();
