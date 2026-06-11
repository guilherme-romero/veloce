/* ═══════════════════════════════════════════════════════════════════════
   HOME — landing page com resumo executivo (Fase 8.2)
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  function fmtKm(v)   { return (v == null || !isFinite(v)) ? '—' : v.toFixed(0); }
  function fmtKg(v)   { return (v == null || !isFinite(v)) ? '—' : v.toFixed(1).replace('.', ','); }
  function fmtDate(iso) {
    try { return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }); }
    catch { return iso; }
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 6)  return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function calcWeekKm() {
    if (!window.Storage) return 0;
    const log = Storage.getTrainingLog ? Storage.getTrainingLog() : [];
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = (today.getDay() + 6) % 7; // segunda como início
    const start = new Date(today); start.setDate(today.getDate() - dow);
    let km = 0;
    log.forEach(e => {
      const d = new Date(e.data + 'T12:00:00');
      if (d >= start && d <= today) {
        const b = e.payload?.bike;
        if (b && isFinite(b.km) && b.km > 0) km += b.km;
      }
    });
    return km;
  }

  function calcStreak() {
    if (!window.Storage) return 0;
    const log = Storage.getTrainingLog ? Storage.getTrainingLog() : [];
    const datesAtivas = new Set(log.map(e => e.data));
    let streak = 0;
    const d = new Date(); d.setHours(0,0,0,0);
    while (true) {
      const iso = d.toISOString().slice(0, 10);
      if (datesAtivas.has(iso)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    return streak;
  }

  async function loadLastActivities() {
    const list = $('home-recent-list');
    if (!list) return;
    try {
      const resp = await window.Api.get('/activities/unified?days=30');
      const items = (resp && resp.items) || [];
      if (items.length === 0) {
        list.innerHTML = '<div style="color:var(--muted2);font-size:13px;">Nenhuma atividade recente. Sincronize Strava ou Garmin.</div>';
        return;
      }
      const esc = window.esc || (s => String(s || ''));
      list.innerHTML = items.slice(0, 5).map(a => {
        const km   = isFinite(a.distanciaKm) ? a.distanciaKm.toFixed(1).replace('.', ',') + ' km' : '';
        const tempo = a.tempoMovS ? Math.floor(a.tempoMovS/3600) + 'h' + String(Math.floor((a.tempoMovS%3600)/60)).padStart(2,'0') : '';
        const fonte = a.fonte ? `<span class="source-badge source-${esc(a.fonte)}">${esc(a.fonte)}</span>` : '';
        return `
          <div class="home-recent-item">
            <div class="home-recent-icon"><i class="fa-solid fa-bicycle"></i></div>
            <div class="home-recent-info">
              <div class="home-recent-title">${esc(a.nome || 'Atividade')} ${fonte}</div>
              <div class="home-recent-meta">${esc(fmtDate(a.inicio || a.data))} · ${km}${tempo ? ' · ' + tempo : ''}</div>
            </div>
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
    $('home-subline').textContent  = 'Resumo dos seus últimos dados e ações rápidas.';

    // KPI 1 — Meta de peso
    if (user.pesoAtual && user.pesoMeta) {
      const restante = user.pesoAtual - user.pesoMeta;
      $('home-meta-val').textContent = fmtKg(user.pesoMeta) + ' kg';
      $('home-meta-sub').textContent = restante > 0 ? `Faltam ${fmtKg(restante)} kg` : '✓ Meta atingida';
    } else {
      $('home-meta-val').textContent = '—';
      $('home-meta-sub').textContent = 'Configure no Perfil';
    }

    // KPI 2 — KM esta semana
    const weekKm = calcWeekKm();
    $('home-week-km').textContent = fmtKm(weekKm) + ' km';

    // KPI 3 — Sequência
    const streak = calcStreak();
    $('home-streak').textContent = streak;
    $('home-streak-sub').textContent = streak === 1 ? 'dia ativo' : 'dias ativos';

    // KPI 4 — Fadiga / Training Readiness (prioriza Readiness Garmin se disponível)
    // Busca async — não bloqueia o load síncrono dos outros KPIs
    (async () => {
      try {
        const readiness = await window.Api.get('/garmin/training-readiness?days=1');
        if (Array.isArray(readiness) && readiness.length > 0 && readiness[0].score != null) {
          const r = readiness[0];
          $('home-fadiga').textContent = r.score;
          $('home-fadiga-sub').textContent = (r.level || '—').toLowerCase();
          // Label do card vira "Readiness" pra deixar claro
          const labelEl = document.querySelector('#home .home-kpi:nth-child(4) .home-kpi-label');
          if (labelEl) labelEl.textContent = 'Readiness';
          return;
        }
      } catch (_) { /* fallback abaixo */ }
      // Fallback: usa score do Insights (fadiga manual)
      const fadigaEl = document.getElementById('fadiga-score');
      if (fadigaEl && fadigaEl.textContent && fadigaEl.textContent !== '—') {
        $('home-fadiga').textContent = fadigaEl.textContent;
      } else {
        $('home-fadiga').textContent = '—';
        $('home-fadiga-sub').textContent = 'sincronize Garmin';
      }
    })();

    // Ações rápidas
    $('home-btn-weight')?.addEventListener('click', () => {
      if (window.openWeightModal) openWeightModal();
    });
    $('home-btn-training')?.addEventListener('click', () => {
      if (window.TrainingLog && TrainingLog.openMarkTrainingModal) {
        TrainingLog.openMarkTrainingModal(new Date().toISOString().slice(0,10));
      }
    });
    $('home-btn-sync')?.addEventListener('click', () => {
      if (window.Garmin && Garmin.sync) Garmin.sync();
    });

    loadLastActivities();
  }

  window.Home = { load };
})();
