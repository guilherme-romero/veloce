/* ═══════════════════════════════════════════════════════════════════════
   HOME — landing page com resumo executivo (Fase 8.2)
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  // Escapa HTML para uso seguro em innerHTML. Usa window.esc se disponível
  // (utils.js carrega antes), com fallback que de fato escapa — nunca a
  // identidade. Dados como r.level vêm de API externa (Garmin).
  const esc = window.esc || (s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  function fmtKm(v)   { return (v == null || !isFinite(v)) ? '—' : v.toFixed(0); }
  function fmtKg(v)   { return (v == null || !isFinite(v)) ? '—' : v.toFixed(1).replace('.', ','); }
  function parseLocalDT(iso) {
    if (!iso) return null;
    // Garmin: "YYYY-MM-DD HH:MM:SS" (espaço) → normaliza para ISO
    // Strava:  "YYYY-MM-DDTHH:MM:SSZ" (Z é na verdade hora local) → tira Z
    const s = iso.replace(' ', 'T').replace(/Z$/, '');
    const d = new Date(s.includes('T') ? s : s + 'T12:00:00');
    return isNaN(d) ? null : d;
  }


  function fmtDate(iso) {
    try {
      const d = parseLocalDT(iso);
      if (!d) return iso;
      return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
    } catch { return iso; }
  }

  function fmtDuracao(s) {
    if (!s || !isFinite(s)) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + 'h' + String(m).padStart(2, '0') : m + 'min';
  }

  function fmtDateHora(iso) {
    try {
      const d = parseLocalDT(iso);
      if (!d) return fmtDate(iso);
      const data = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
      const hora = d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
      return `${data} às ${hora}`;
    } catch { return fmtDate(iso); }
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 6)  return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  // Km desta semana vs. semana passada (ambas inteiras), com DOMINGO como
  // início da semana. Fonte: atividades unificadas (Garmin/Strava), que é o
  // que reflete de fato o que foi pedalado.
  function weekStatsFromActivities(items) {
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = today.getDay(); // 0 = domingo (início da semana)

    const startThis = new Date(today);  startThis.setDate(today.getDate() - dow);
    const startLast = new Date(startThis); startLast.setDate(startThis.getDate() - 7);
    const endThis   = new Date(startThis); endThis.setDate(startThis.getDate() + 7); // exclusivo

    let atual = 0, anterior = 0;
    (items || []).forEach(a => {
      if (!isFinite(a.distanciaKm)) return;
      const d = parseLocalDT(a.inicio || a.data);
      if (!d) return;
      const day = new Date(d); day.setHours(0,0,0,0);
      if (day >= startThis && day < endThis)         atual    += a.distanciaKm;
      else if (day >= startLast && day < startThis)  anterior += a.distanciaKm;
    });

    // Só há % quando existe base de comparação (> 0) na semana passada.
    const pct = anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;
    return { atual, pct };
  }

  function renderWeekKpi(stats) {
    $('home-week-km').textContent = fmtKm(stats.atual);
    if (stats.pct != null && Math.round(stats.pct) !== 0) {
      const up = stats.pct > 0;
      const arrow = up ? '↑' : '↓';
      const cls = up ? 'kpi-hl-lime' : 'kpi-hl-magenta';
      $('home-week-sub').innerHTML =
        `<b class="${cls}">${arrow} ${Math.abs(stats.pct).toFixed(0)}%</b> vs. semana passada`;
    } else {
      $('home-week-sub').textContent = 'pedalados';
    }
  }

  // Sequência por SEMANAS treinando (fonte única em Utils.calcTrainingStreak):
  // uma semana "vale" com ≥ 2 dias ativos; a semana atual em andamento não
  // quebra a sequência enquanto ainda não atinge o critério.
  function calcStreak() {
    if (!window.Storage || !window.Utils) return { current: 0, record: 0 };
    const log = Storage.getTrainingLog ? Storage.getTrainingLog() : [];
    // Fonte única do cálculo (compartilhada com heatmap.js): Utils.calcTrainingStreak.
    return Utils.calcTrainingStreak(log.map(e => e.data));
  }

  async function loadLastActivities() {
    const list = $('home-recent-list');
    if (!list) return;
    try {
      const resp = await window.Api.get('/activities/unified?days=30');
      const items = (resp && resp.items) || [];
      // KPI "Esta semana" (+ variação) usa as mesmas atividades unificadas.
      renderWeekKpi(weekStatsFromActivities(items));
      if (items.length === 0) {
        list.innerHTML = '<div style="color:var(--muted2);font-size:13px;">Nenhuma atividade recente. Sincronize Strava ou Garmin.</div>';
        return;
      }
      list.innerHTML = items.slice(0, 5).map(a => {
        const km    = isFinite(a.distanciaKm) ? a.distanciaKm.toFixed(1).replace('.', ',') : '—';
        const tempo = fmtDuracao(a.tempoMovS);
        const vel   = isFinite(a.velMediaKmh) ? a.velMediaKmh.toFixed(1).replace('.', ',') : '—';
        const elev  = isFinite(a.elevacaoM) ? Math.round(a.elevacaoM) : '—';
        const fonte = a.fonte ? `<span class="source-badge source-${esc(a.fonte)}">${esc(a.fonte)}</span>` : '';
        return `
          <div class="home-recent-item">
            <div class="home-recent-icon"><i class="fa-solid fa-bicycle"></i></div>
            <div class="home-recent-info">
              <div class="home-recent-title">${esc(a.nome || 'Atividade')} ${fonte}</div>
              <div class="home-recent-meta">${esc(fmtDateHora(a.inicio || a.data))}</div>
            </div>
            <div class="home-recent-stats">
              <div class="hr-stat"><div class="hr-stat-val">${esc(km)}</div><div class="hr-stat-lbl">km</div></div>
              <div class="hr-stat"><div class="hr-stat-val">${esc(tempo)}</div><div class="hr-stat-lbl">tempo</div></div>
              <div class="hr-stat"><div class="hr-stat-val hr-speed">${esc(vel)}</div><div class="hr-stat-lbl">km/h</div></div>
              <div class="hr-stat"><div class="hr-stat-val hr-elev">${esc(elev)}</div><div class="hr-stat-lbl"><i class="fa-solid fa-arrow-trend-up"></i> elev m</div></div>
            </div>
            <button class="home-recent-del" data-id="${esc(String(a.id))}" data-fonte="${esc(a.fonte || '')}" title="Excluir atividade">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>`;
      }).join('');

    } catch (e) {
      console.error('[home] activities', e);
      list.innerHTML = '<div style="color:var(--muted2);font-size:13px;">Falha ao carregar atividades.</div>';
    }
  }

  function load() {
    if (!$('home-greeting')) return;
    const user = window.Storage ? Storage.getUser() : {};

    // Greeting
    $('home-greeting').textContent = `${greeting()}${user.nome ? ', ' + user.nome.split(' ')[0] : ''}!`;
    $('home-subline').textContent  = 'Resumo dos seus últimos dados sincronizados e ações rápidas para hoje.';

    // KPI 1 — Meta de peso
    if (user.pesoAtual && user.pesoMeta) {
      const restante = user.pesoAtual - user.pesoMeta;
      $('home-meta-val').textContent = fmtKg(user.pesoMeta);
      $('home-meta-sub').innerHTML = restante > 0
        ? `faltam <b class="kpi-hl-magenta">${esc(fmtKg(restante))} kg</b>`
        : '✓ Meta atingida';
    } else {
      $('home-meta-val').textContent = '—';
      $('home-meta-sub').textContent = 'Configure no Perfil';
    }

    // KPI 2 — KM desta semana (+ variação): preenchido por loadLastActivities,
    // que busca as atividades unificadas (mesma fonte da lista abaixo).

    // KPI 3 — Sequência (semanas treinando, ≥ 2 dias ativos/semana)
    const { current: streak, record: streakRecord } = calcStreak();
    $('home-streak').textContent = streak;
    $('home-streak-sub').textContent =
      'recorde: ' + streakRecord + (streakRecord === 1 ? ' semana' : ' semanas');

    // KPI 4 — Fadiga / Training Readiness (prioriza Readiness Garmin se disponível)
    // Busca async — não bloqueia o load síncrono dos outros KPIs
    (async () => {
      function readinessClass(score) {
        if (score == null) return 'kpi-hl-lime';
        if (score > 65) return 'kpi-hl-lime';
        if (score >= 35) return 'kpi-hl-amber';
        return 'kpi-hl-magenta';
      }
      try {
        const readiness = await window.Api.get('/garmin/training-readiness?days=1');
        if (Array.isArray(readiness) && readiness.length > 0 && readiness[0].score != null) {
          const r = readiness[0];
          const cls = readinessClass(r.score);
          const fadigaEl = $('home-fadiga');
          fadigaEl.textContent = r.score;
          fadigaEl.className = fadigaEl.className.replace(/kpi-hl-\w+/g, '').trim();
          fadigaEl.classList.add(cls);
          $('home-fadiga-sub').innerHTML = r.level
            ? `prontidão <b class="${cls}">${esc(r.level)}</b>`
            : '—';
          // Label do card vira "Readiness" pra deixar claro
          const labelEl = document.querySelector('#home .home-kpi:nth-child(3) .home-kpi-label');
          if (labelEl) labelEl.textContent = 'Readiness';
          return;
        }
      } catch (_) { /* fallback abaixo */ }
      // Fallback: sem Readiness Garmin disponível
      $('home-fadiga').textContent = '—';
      $('home-fadiga-sub').textContent = 'sincronize Garmin';
    })();

    // Delegação de delete em atividades recentes — vincula só uma vez
    const recentList = $('home-recent-list');
    if (recentList && !recentList._delWired) {
      recentList._delWired = true;
      recentList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.home-recent-del');
        if (!btn) return;
        const ok = await window.Modals.confirm({
          title: 'Excluir esta atividade?',
          message: 'O próximo sync a restaurará se ainda existir no Garmin/Strava.',
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        const { id, fonte } = btn.dataset;
        try {
          await window.Api.del(`/activities/${fonte}/${id}`);
          if (window.toast) window.toast('Atividade excluída', { kind: 'success' });
          loadLastActivities();
        } catch (err) {
          console.error('[home] delete activity', err);
          if (window.toast) window.toast('Falha ao excluir atividade', { kind: 'error' });
        }
      });
    }

    // Ações rápidas — vincula só uma vez (load() pode ser re-chamado p/ refresh)
    const actions = $('home-btn-training');
    if (actions && !actions._wiredHome) {
      actions._wiredHome = true;
      $('home-btn-training')?.addEventListener('click', () => {
        if (window.TrainingLog && TrainingLog.openMarkTrainingModal) {
          TrainingLog.openMarkTrainingModal(new Date().toISOString().slice(0,10));
        }
      });
      $('home-btn-sync')?.addEventListener('click', syncAll);
    }

    loadLastActivities();
  }

  // Sincroniza Strava + Garmin em paralelo, cada um condicionado ao seu
  // /status (pula o que não estiver configurado/conectado). Falha de um
  // serviço não aborta o outro. (Fase 17.1)
  async function syncAll() {
    const btn = $('home-btn-sync');
    if (btn && btn.disabled) return;
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando…'; }

    // Descobre quais serviços estão prontos
    const [stravaStatus, garminStatus] = await Promise.all([
      window.Api.get('/strava/status').catch(() => null),
      window.Api.get('/garmin/status').catch(() => null),
    ]);
    const doStrava = !!(stravaStatus && stravaStatus.configured && stravaStatus.connected && window.Strava && Strava.sync);
    const doGarmin = !!(garminStatus && garminStatus.configured && garminStatus.connected && window.Garmin && Garmin.sync);

    if (!doStrava && !doGarmin) {
      if (window.toast) window.toast('Nenhum serviço conectado. Configure em Conexões.', { kind: 'error' });
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
      return;
    }

    const results = await Promise.allSettled([
      doStrava ? Strava.sync() : Promise.resolve(),
      doGarmin ? Garmin.sync() : Promise.resolve(),
    ]);
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed && window.toast) window.toast('Sincronização concluída com erros em ' + failed + ' serviço(s).', { kind: 'error' });

    // Atualiza KPIs/atividades da Home após o sync
    try { load(); } catch (_) {}
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }

  window.Home = { load };
})();
