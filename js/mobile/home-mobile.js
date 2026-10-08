/* ═══════════════════════════════════════════════════════════════════════
   INÍCIO (tela 01 do handoff) — hero de saudação + 4 KPIs em 2×2 +
   últimas atividades.

   Mesmos dados da Home desktop (js/home.js): /activities/unified,
   Storage.getUser(), Utils.calcTrainingStreak e o Training Readiness do
   Garmin. O que muda é só o layout.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-inicio';
  const { esc, fmtDateHora, fmtDuracao, fmtNum } = MShell;

  function greeting() {
    const h = new Date().getHours();
    if (h < 6)  return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function kpi({ label, icon, value, unit, sub, accent = '' }) {
    return `<div class="m-kpi">
      <div class="m-kpi-head">
        <span class="m-eyebrow">${esc(label)}</span>
        <i class="fa-solid ${esc(icon)}"></i>
      </div>
      <div class="m-kpi-value">
        <span class="m-num"${accent ? ` style="color:var(--${esc(accent)})"` : ''}>${esc(value)}</span>
        ${unit ? `<span class="m-unit">${esc(unit)}</span>` : ''}
      </div>
      <div class="m-sub">${sub || ''}</div>
    </div>`;
  }

  function skeleton(user) {
    const nome = (user.nome || '').split(' ')[0];
    return `
      <div class="m-hero">
        <span class="m-eyebrow" style="color:var(--lime)">— Início</span>
        <h1 class="m-title" style="font-size:40px;line-height:.88;margin:10px 0 8px">
          ${esc(greeting())}${nome ? ',' : ''}<br>${esc(nome ? nome + '!' : '')}
        </h1>
        <p class="m-sub" id="m-home-subline">Carregando seu resumo…</p>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="m-btn m-btn-primary" type="button" id="m-home-registrar" style="flex:1">
            <i class="fa-solid fa-bicycle"></i> Registrar
          </button>
          <button class="m-btn m-btn-icon" type="button" id="m-home-sync" aria-label="Sincronizar">
            <i class="fa-solid fa-rotate"></i>
          </button>
        </div>
      </div>

      <div class="m-kpigrid" id="m-home-kpis"></div>

      <div class="m-section-head">
        <span class="m-eyebrow">Últimas atividades</span>
        <button class="m-link" type="button" id="m-home-vertudo">Ver tudo <i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div id="m-home-recent"><div class="m-empty">Carregando…</div></div>
    `;
  }

  function renderKpis({ week, streak, readiness, user }) {
    const el = document.getElementById('m-home-kpis');
    if (!el) return;

    let weekSub = 'pedalados';
    if (week && week.pct != null && Math.round(week.pct) !== 0) {
      const up = week.pct > 0;
      const cor = up ? 'lime' : 'magenta';
      weekSub = `<b style="color:var(--${cor})">${up ? '↑' : '↓'}${Math.abs(week.pct).toFixed(0)}%</b> vs. anterior`;
    }

    // Meta de peso: mesmos campos do desktop (pesoAtual/pesoMeta).
    let metaVal = '—', metaSub = 'Configure no Perfil';
    if (user.pesoAtual && user.pesoMeta) {
      metaVal = fmtNum(user.pesoMeta, 1);
      const restante = user.pesoAtual - user.pesoMeta;
      metaSub = restante > 0
        ? `faltam <b style="color:var(--magenta)">${esc(fmtNum(restante, 1))} kg</b>`
        : '✓ Meta atingida';
    }

    // Mesmos cortes do desktop: > 65 bom, 35–65 atenção, < 35 ruim.
    let readVal = '—', readSub = 'sincronize Garmin', readAccent = 'lime';
    if (readiness && readiness.score != null) {
      readVal = readiness.score;
      readAccent = readiness.score > 65 ? 'lime' : readiness.score >= 35 ? 'amber' : 'magenta';
      readSub = readiness.level
        ? `prontidão <b style="color:var(--${readAccent})">${esc(readiness.level)}</b>` : '';
    }

    el.innerHTML =
      kpi({ label: 'Esta semana', icon: 'fa-road', value: week ? fmtNum(week.atual) : '—',
            unit: 'km', sub: weekSub }) +
      kpi({ label: 'Sequência', icon: 'fa-fire', value: streak.current, unit: 'sem',
            sub: `recorde: ${streak.record} sem.` }) +
      kpi({ label: 'Readiness', icon: 'fa-heart-pulse', value: readVal, sub: readSub,
            accent: readAccent }) +
      kpi({ label: 'Meta de peso', icon: 'fa-weight-scale', value: metaVal, unit: 'kg',
            sub: metaSub });
  }

  function actividadeHTML(a) {
    const km    = isFinite(a.distanciaKm)  ? fmtNum(a.distanciaKm, 1)        : '—';
    const vel   = isFinite(a.velMediaKmh)  ? fmtNum(a.velMediaKmh, 1)        : '—';
    const elev  = isFinite(a.elevacaoM)    ? String(Math.round(a.elevacaoM)) : '—';
    return `<div class="m-act" data-src="${esc(a.fonte || '')}">
      <div class="m-act-head">
        <div class="m-act-icon"><i class="fa-solid fa-bicycle"></i></div>
        <div style="min-width:0">
          <div class="m-act-title">${esc(a.nome || 'Atividade')}</div>
          <div class="m-sub">${esc(fmtDateHora(a.inicio || a.data))}</div>
        </div>
      </div>
      <div class="m-act-metrics">
        <div class="m-act-metric"><span class="m-num">${esc(km)}</span><span class="m-micro">km</span></div>
        <div class="m-act-metric"><span class="m-num">${esc(fmtDuracao(a.tempoMovS))}</span><span class="m-micro">tempo</span></div>
        <div class="m-act-metric" data-accent="lime"><span class="m-num">${esc(vel)}</span><span class="m-micro">km/h</span></div>
        <div class="m-act-metric" data-accent="green"><span class="m-num">${esc(elev)}</span><span class="m-micro">elev m</span></div>
      </div>
    </div>`;
  }

  function renderRecent(items) {
    const el = document.getElementById('m-home-recent');
    if (!el) return;
    el.innerHTML = items.length
      ? `<div style="display:flex;flex-direction:column;gap:10px">
           ${items.slice(0, 3).map(actividadeHTML).join('')}
         </div>`
      : `<div class="m-empty">Nenhuma atividade recente.<br>Sincronize Strava ou Garmin.</div>`;
  }

  function subline(items) {
    const el = document.getElementById('m-home-subline');
    if (!el) return;
    const ultima = items[0] && ActivityStats.parseLocalDT(items[0].inicio || items[0].data);
    if (!ultima) { el.textContent = 'Nenhuma atividade sincronizada ainda.'; return; }
    const dias = Math.floor((Date.now() - ultima.getTime()) / 86400000);
    el.textContent = dias <= 0 ? 'Sua última pedalada foi hoje.'
      : dias === 1 ? 'Sua última pedalada foi ontem.'
      : `Sua última pedalada foi há ${dias} dias.`;
  }

  function streakStats() {
    if (!window.Storage || !window.Utils) return { current: 0, record: 0 };
    const log = Storage.getTrainingLog ? Storage.getTrainingLog() : [];
    return Utils.calcTrainingStreak(log.map(e => e.data));
  }

  // As duas chamadas da Home, isoladas para poderem ser memoizadas.
  async function buscarDados() {
    const [acts, ready] = await Promise.all([
      // Deixa propagar: falha aqui NAO pode ser cacheada — o load() renderiza
      // o estado de erro e a proxima entrada tenta de novo.
      window.UnifiedActivities.get(30),
      // Garmin ausente e situacao normal, nao erro: cai no estado "—".
      Api.get('/garmin/training-readiness?days=1').catch(() => null),
    ]);
    const r = Array.isArray(ready) && ready.length && ready[0].score != null ? ready[0] : null;
    return { items: (acts && acts.items) || [], readiness: r };
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const user = (window.Storage && Storage.getUser && Storage.getUser()) || {};
    view.innerHTML = skeleton(user);

    document.getElementById('m-home-vertudo')
      ?.addEventListener('click', () => MRouter.navigate('atividades'));
    document.getElementById('m-home-registrar')?.addEventListener('click', () => {
      // O modal de registro vive em training-log.js, que é desktop-only por
      // ora: a UI mobile manda para a seção correspondente lá.
      // BUG-076: sem o ?ui=desktop. Ele gravava vl.ui='desktop' no
      // sessionStorage (variant.js:61) pelo resto da aba, e a partir dai o
      // "voltar" do celular para mobile.html era interceptado e devolvia o
      // usuario a desktop. O destino ja e explicito na URL.
      location.href = 'index.html#/inicio';
    });
    document.getElementById('m-home-sync')?.addEventListener('click', syncAll);

    // KPIs que não dependem de rede aparecem imediatamente.
    renderKpis({ week: null, streak: streakStats(), readiness: null, user });

    // BUG-077: as duas chamadas eram sequenciais e refeitas a cada onEnter.
    // Agora rodam em paralelo e passam pela guarda de 5 min do MShell.
    let items = [], readiness = null;
    try {
      ({ items, readiness } = await MShell.cached('inicio', MShell.TTL_DADOS, buscarDados));
    } catch (e) {
      console.error('[home-mobile] activities', e);
      const el = document.getElementById('m-home-recent');
      if (el) el.innerHTML = `<div class="m-empty">Falha ao carregar atividades.</div>`;
    }

    subline(items);
    renderRecent(items);

    renderKpis({
      week: ActivityStats.weekStatsFromActivities(items),
      streak: streakStats(), readiness, user,
    });
  }

  // Mesma lógica do desktop (js/home.js#syncAll), sem os módulos Strava/
  // Garmin: no mobile o sync é disparado direto nos endpoints.
  async function syncAll() {
    const btn = document.getElementById('m-home-sync');
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

    const [stravaStatus, garminStatus] = await Promise.all([
      Api.get('/strava/status').catch(() => null),
      Api.get('/garmin/status').catch(() => null),
    ]);
    const doStrava = !!(stravaStatus && stravaStatus.configured && stravaStatus.connected);
    const doGarmin = !!(garminStatus && garminStatus.configured && garminStatus.connected);

    if (!doStrava && !doGarmin) {
      if (window.toast) toast('Nenhum serviço conectado. Configure em Conexões.', { kind: 'error' });
    } else {
      const results = await Promise.allSettled([
        doStrava ? Api.post('/strava/sync', {}) : Promise.resolve(),
        doGarmin ? Api.post('/garmin/sync', {}) : Promise.resolve(),
      ]);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (window.toast) {
        if (failed) toast(`Sincronização concluída com erros em ${failed} serviço(s).`, { kind: 'error' });
        else toast('Sincronização concluída', { kind: 'success' });
      }
      // Sem isto o TTL de 5 min viraria bug: apertar sync e ir para Insights
      // mostraria os dados ANTERIORES ao sync.
      if (window.MShell && MShell.invalidate) MShell.invalidate();
      // #52 — syncAll chama /strava/sync e /garmin/sync DIRETO (não passa
      // por js/strava.js/js/garmin.js, que não são carregados no mobile),
      // então a invalidação cabeada lá não cobre este caminho.
      window.UnifiedActivities?.invalidate();
      await load();
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i>'; }
  }

  MRouter.register({
    slug: 'inicio',
    aliases: ['', 'home'],
    viewId: VIEW_ID,
    label: 'Início',
    onEnter: () => {
      const user = (window.Storage && Storage.getUser && Storage.getUser()) || {};
      MShell.setHeader({
        brand: true,
        actions: `<div class="m-iconbtn" data-variant="lime">${esc(MShell.initials(user.nome))}</div>`,
      });
      load();
    },
  });
})();
