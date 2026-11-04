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

  // Botão de sync manual — continua disponível com o toggle desligado, porque
  // o toggle só gateia o sync automático do scheduler (#135).
  const BTN_SYNC_HTML =
    '<div class="strava-actions">' +
      '<button type="button" id="btn-strava-sync" class="btn btn-primary">' +
        '<i class="fa-solid fa-rotate"></i> Sincronizar' +
      '</button>' +
    '</div>';

  // Escreve estado + corpo e pendura o toggle no fim (#135). Centralizar aqui
  // garante que o toggle apareça em TODOS os estados do card — inclusive no de
  // erro, que é justamente o que ele existe para calar.
  // O sync automático do Strava está desligado POR AMBIENTE desde 2026-08-30
  // (403 Application Inactive). Sem dizer isso, o toggle marcado prometeria um
  // sync a cada 30 min que o servidor não executa — o backend informa o estado
  // real em `autoSyncServidor` e a nota abaixo evita a promessa falsa.
  function notaServidor() {
    if (_ultimoStatus.autoSyncServidor !== false) return '';
    return '<p class="conn-auto-nota">O servidor está com o sync automático do Strava desativado ' +
      '(a API respondia <code>403 Application Inactive</code>). Enquanto estiver assim, só o ' +
      'sync manual tem efeito.</p>';
  }

  function pintar(stateTxt, stateCls, bodyHtml, { comToggle = true } = {}) {
    const stateEl = $('strava-state');
    const bodyEl  = $('strava-body');
    stateEl.textContent = stateTxt;
    stateEl.className = 'strava-state ' + stateCls;
    bodyEl.innerHTML = bodyHtml +
      (comToggle ? window.ConnAuto.html('strava-auto', 'stravaSyncAuto') + notaServidor() : '');
    const btn = $('btn-strava-sync');
    if (btn) btn.addEventListener('click', sync);
    if (comToggle) window.ConnAuto.wire('strava-auto', 'stravaSyncAuto', aoAlternar);
  }

  // Religar pede o estado real ao backend; desligar pode reusar o cache, já que
  // o card desligado não mostra estado de conexão nenhum (o comentário antigo
  // dizia que religar "traz o estado real", e com cache isso não era verdade).
  function aoAlternar(ligado) {
    if (ligado) load(); else render(_ultimoStatus);
  }

  let _ultimoStatus = {};

  function render(status) {
    const stateEl = $('strava-state');
    const bodyEl  = $('strava-body');
    if (!stateEl || !bodyEl) return;
    const esc = window.esc || ((s) => String(s || ''));
    _ultimoStatus = status || {};

    if (!status.configured) {
      // Sem credenciais não há o que ligar ou desligar: o toggle só confundiria.
      pintar('não configurado', 'disconnected',
        '<div class="strava-msg">Defina <code>STRAVA_CLIENT_ID</code>, ' +
        '<code>STRAVA_CLIENT_SECRET</code> e <code>STRAVA_REFRESH_TOKEN</code> ' +
        'no <code>server/.env</code> e reinicie o backend.</div>', { comToggle: false });
      return;
    }

    // #135 — com o sync automático desligado, o card não insiste no erro de
    // conexão: era esse alarme recorrente (403 Application Inactive) que o
    // toggle veio resolver. O sync manual segue ali para quando for útil.
    if (!window.ConnAuto.ligado('stravaSyncAuto')) {
      pintar('sync automático desativado', 'muted',
        '<div class="strava-msg">O sync a cada 30 minutos está desligado para o Strava. ' +
        'Você ainda pode sincronizar manualmente quando quiser.</div>' + BTN_SYNC_HTML);
      return;
    }

    if (!status.connected) {
      pintar('erro', 'disconnected',
        `<div class="strava-msg">Não consegui conectar ao Strava: ${esc(status.error || 'sem detalhes')}</div>`);
      return;
    }

    stateEl.textContent = 'conectado';
    stateEl.className = 'strava-state connected';

    const a = status.athlete || {};
    const name = esc(`${a.firstname || ''} ${a.lastname || ''}`.trim() || a.username || 'Atleta');
    const totalAct = Number(status.totalActivities || 0);
    const syncMeta = fmtSyncParts(status.lastSyncAt);
    const syncLabel = syncMeta.hora ? `${esc(syncMeta.hora)} · último sync` : 'último sync';

    bodyEl.innerHTML =
      '<div class="strava-stats">' +
        `<div class="strava-stat"><div class="strava-stat-val">${totalAct}</div><div class="strava-stat-label">atividades</div></div>` +
        `<div class="strava-stat"><div class="strava-stat-val">${esc(syncMeta.data)}</div><div class="strava-stat-label">${syncLabel}</div></div>` +
      '</div>' +
      `<div class="conn-athlete">Atleta: <strong>${name}</strong></div>` +
      BTN_SYNC_HTML +
      window.ConnAuto.html('strava-auto', 'stravaSyncAuto') + notaServidor();

    const btn = $('btn-strava-sync');
    if (btn) btn.addEventListener('click', sync);
    window.ConnAuto.wire('strava-auto', 'stravaSyncAuto', aoAlternar);
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
      // Via `pintar`, para o toggle continuar na tela: sem isso, um /status que
      // falha deixaria o card em vermelho sem nenhuma forma de silenciá-lo —
      // exatamente o incômodo que a #135 veio resolver.
      pintar('offline', 'disconnected', '<div class="strava-msg">Falha ao consultar o backend.</div>');
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
      window.UnifiedActivities?.invalidate();   // #52 — sync pode ter trazido atividade nova
      const msg = `${res.imported} importadas · ${res.updated} atualizadas · ${res.daysMarked} dias marcados`;
      if (window.toast) window.toast(msg, { kind: 'success' });
      // Recarrega training_log no cache local p/ refletir badges no calendario
      try {
        if (window.Storage && Storage.loadAll) await Storage.loadAll();
        if (window.Rides && Rides.render) Rides.render();
        if (window.renderMiniReport) renderMiniReport();
      } catch (e) { console.warn('[strava] refresh local falhou', e); }
      await load();
      window.Notifications?.load();  // atualiza o sino sem recarregar a página
    } catch (err) {
      console.error('[strava] sync', err);
      if (window.toast) window.toast('Falha ao sincronizar: ' + (err.message || err), { kind: 'error' });
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sincronizar últimos 90 dias';
      }
    }
  }

  window.Strava = { load, sync, openInfo };
})();
