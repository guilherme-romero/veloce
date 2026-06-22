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
    const totalAct = Number(status.totalActivities || 0);
    const sync = fmtSyncParts(status.lastSyncAt);
    const syncLabel = sync.hora ? `${esc(sync.hora)} · último sync` : 'último sync';

    bodyEl.innerHTML =
      '<div class="strava-stats">' +
        `<div class="strava-stat"><div class="strava-stat-val">${totalAct}</div><div class="strava-stat-label">atividades</div></div>` +
        `<div class="strava-stat"><div class="strava-stat-val">${esc(sync.data)}</div><div class="strava-stat-label">${syncLabel}</div></div>` +
      '</div>' +
      `<div class="conn-athlete">Atleta: <strong>${name}</strong></div>` +
      '<div class="strava-actions">' +
        '<button type="button" id="btn-strava-sync" class="btn btn-primary">' +
          '<i class="fa-solid fa-rotate"></i> Sincronizar' +
        '</button>' +
      '</div>';

    const btn = $('btn-strava-sync');
    if (btn) btn.addEventListener('click', sync);
  }

  // Modal explicativo (i) — como funciona a conexão Strava (Fase 17.4)
  function openInfo() {
    if (!window.Modals) return;
    Modals.open({
      tag: 'Conexões',
      title: 'Como funciona o Strava',
      bodyHTML: `
        <div class="conn-info-body">
          <p><strong>Autorização oficial (OAuth).</strong> A conexão usa a API oficial do Strava
          com um <code>refresh_token</code> guardado no servidor (<code>server/.env</code>).
          Os tokens nunca saem do seu servidor.</p>
          <p><strong>O que importa:</strong> atividades de bike dos últimos 90 dias
          (distância, tempo, elevação, FC, potência) e marca os dias treinados no calendário.</p>
          <p><strong>De-duplicação:</strong> quando a mesma pedalada também vem da Garmin,
          o app vincula as duas e conta só uma vez no km da bike.</p>
          <p><strong>Reconexão:</strong> a conexão é fixa via <code>.env</code> — se o token
          expirar ou for revogado, atualize as credenciais no servidor e reinicie o backend.</p>
        </div>`,
      actions: [{ label: 'Entendi', kind: 'primary', onClick: () => Modals.close() }],
    });
  }

  async function load() {
    const stateEl = $('strava-state');
    if (!stateEl) return;
    $('strava-info') && ($('strava-info').onclick = openInfo);
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
        if (window.Rides && Rides.render) Rides.render();
        if (window.renderMiniReport) renderMiniReport();
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

  window.Strava = { load, sync, openInfo };
})();
