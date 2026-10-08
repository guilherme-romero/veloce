/* ═══════════════════════════════════════════════════════════════════════
   INSIGHTS (tela 03 do handoff) — alerta de sobrecarga, CTL/ATL/VO₂/HRV,
   curva carga×fadiga de 8 semanas, Índice de Fadiga, Training Readiness,
   rosca de tempo por zona e recordes pessoais.

   Os números vêm de js/core/ — as MESMAS funções que o desktop usa, então
   tudo bate dígito a dígito entre as duas telas: metrics.js (CTL/ATL/TSB),
   fatigue.js (índice de fadiga e readiness) e records.js (recordes).

   Os gráficos são criados no onEnter (um canvas em view escondida nasce
   0×0) e destruídos no onLeave.

   Acessado via seletor segmentado "Desempenho | Insights" dentro da tab
   Desempenho (reforma mobile do handoff) — sem tab própria, mas também
   sem mais passar pelo menu "Mais".
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-insights';
  const { esc, fmtNum, mChart } = MShell;

  let charts = [];
  const ZONA_COR = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
  const ZONA_HEX = ['#3b82f6', '#e5c024', '#22c55e', '#ef4444', '#a855f7'];

  function destroyCharts() {
    charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    charts = [];
  }

  // `sub` é texto puro, escapado aqui dentro — contrato OPOSTO ao `kpi()` de
  // home-mobile.js, que recebe `subHTML` (já escapado pelo chamador). Não
  // confundir os dois ao copiar uma chamada entre módulos (issue #13).
  function kpi(label, value, unit, sub, token) {
    return `<div class="m-kpi">
      <span class="m-eyebrow">${esc(label)}</span>
      <div class="m-kpi-value">
        <span class="m-num"${token ? ` style="color:var(--${esc(token)})"` : ''}>${esc(value)}</span>
        ${unit ? `<span class="m-unit">${esc(unit)}</span>` : ''}
      </div>
      <div class="m-sub">${esc(sub)}</div>
    </div>`;
  }

  function skeleton() {
    return `
      ${MShell.segment('insights')}
      <div id="m-ins-alert"></div>
      <div class="m-kpigrid" id="m-ins-kpis"></div>

      <div class="m-card">
        <div class="m-card-head">
          <span class="m-eyebrow">Carga × fadiga · 8 sem.</span>
          <span class="m-sub">
            <span style="color:var(--lime)">■</span> carga
            <span style="color:var(--magenta);margin-left:8px">■</span> fadiga
          </span>
        </div>
        <div class="m-chart"><canvas id="m-ins-load"></canvas></div>
      </div>

      <div class="m-card" id="m-ins-fadiga"></div>
      <div class="m-card" id="m-ins-readiness"></div>

      <div class="m-card">
        <div class="m-card-head"><span class="m-eyebrow">Tempo por zona · 30 dias</span></div>
        <div id="m-ins-zonas"></div>
      </div>

      <div class="m-card">
        <div class="m-card-head">
          <span class="m-eyebrow">Recordes pessoais</span>
          <span class="m-sub" id="m-ins-prs-count"></span>
        </div>
        <div id="m-ins-prs"></div>
      </div>
    `;
  }

  function renderAlerta(tsb) {
    const el = document.getElementById('m-ins-alert');
    if (!el) return;
    // Só o regime de sobrecarga (TSB ≤ -20) vira superfície colorida cheia —
    // é a única da tela, conforme a regra de cor do handoff.
    if (tsb == null || tsb > -20) { el.innerHTML = ''; return; }
    const { status, msg } = Metrics.tsbStatus(tsb);
    el.innerHTML = `<div class="m-alert">
      <div class="m-alert-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div style="flex:1;min-width:0">
        <div class="m-title">${esc(status.toUpperCase())} — PRIORIZE RECUPERAÇÃO</div>
        <p style="font-size:12px;margin-top:8px">${esc(msg)}</p>
      </div>
      <div style="text-align:right;flex:none">
        <div class="m-num m-num-lg" style="color:var(--bg)">${esc(String(Math.round(tsb)))}</div>
        <div class="m-micro" style="color:var(--bg)">TSB hoje</div>
      </div>
    </div>`;
  }

  function renderKpis({ ctl, atl, tsb, vo2, hrv }) {
    const el = document.getElementById('m-ins-kpis');
    if (!el) return;
    const st = tsb == null ? null : Metrics.tsbStatus(tsb);
    el.innerHTML =
      kpi('Carga (CTL)', ctl == null ? '—' : fmtNum(ctl), '', 'forma de base') +
      kpi('Fadiga (ATL)', atl == null ? '—' : fmtNum(atl), '',
          st ? st.status.toLowerCase() : '—',
          st && st.token === 'red' ? 'magenta' : '') +
      kpi('VO₂ máx',
          vo2 && vo2.latest && vo2.latest.value != null ? fmtNum(vo2.latest.value) : '—',
          'ml/kg',
          vo2 && vo2.latest && vo2.latest.date
            ? `medido em ${MShell.fmtDate(vo2.latest.date)}` : 'sem dado Garmin') +
      kpi('HRV noturno', hrv == null ? '—' : String(Math.round(hrv)), 'ms', 'média 7 dias');
  }

  // Carga (CTL) × fadiga (ATL) por semana, a partir das séries diárias de 60
  // dias que calcTSBMetrics devolve — mesma fonte do gráfico do desktop.
  function renderLoadChart(ctlSerie, atlSerie) {
    const canvas = document.getElementById('m-ins-load');
    if (!canvas || !ctlSerie.length) return;

    const semanas = 8;
    const porSemana = (serie) => {
      const out = [];
      for (let s = semanas - 1; s >= 0; s--) {
        const fim = serie.length - s * 7;
        out.push(fim > 0 ? +serie[fim - 1].toFixed(1) : null);
      }
      return out;
    };
    const labels = Array.from({ length: semanas }, (_, i) => `S${i + 1}`);

    const c = mChart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { data: porSemana(ctlSerie), borderColor: '#c6f135', borderWidth: 2, tension: .35 },
          { data: porSemana(atlSerie), borderColor: '#ec3a8b', borderWidth: 2, tension: .35 },
        ],
      },
      options: {
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8b95a1', font: { size: 9 } } },
          y: { grid: { color: '#1c2128' }, border: { display: false },
               ticks: { color: '#8b95a1', font: { size: 9 }, maxTicksLimit: 4 } },
        },
      },
    });
    if (c) charts.push(c);
  }

  // Legenda em HTML à direita da rosca (handoff): fora do canvas, o texto
  // não briga com o espaço do gráfico em 390px.
  function renderZonas(dist) {
    const el = document.getElementById('m-ins-zonas');
    if (!el) return;
    const seg   = (dist && dist.segundosPorZona) || [];
    const total = (dist && dist.totalSegundos) || 0;

    if (!total) {
      el.innerHTML = `<div class="m-empty">Sem dados de zona de FC nos últimos 30 dias.</div>`;
      return;
    }

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:130px;height:130px;flex:none;position:relative">
          <canvas id="m-ins-zone"></canvas>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:7px">
          ${seg.slice(0, 5).map((s, i) => {
            const pct = Math.round((s / total) * 100);
            return `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
              <span style="width:10px;height:10px;border-radius:3px;background:${ZONA_COR[i]};flex:none"></span>
              <span style="color:var(--muted)">Z${i + 1}</span>
              <b style="margin-left:auto">${pct}%</b>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    const c = mChart(document.getElementById('m-ins-zone'), {
      type: 'doughnut',
      data: {
        labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
        datasets: [{
          data: seg.slice(0, 5),
          backgroundColor: ZONA_HEX,
          borderColor: '#14181d',
          borderWidth: 2,
        }],
      },
      options: {
        cutout: '62%',
        plugins: {
          tooltip: { callbacks: { label: (c2) => {
            const pct = Math.round((c2.parsed / total) * 100);
            return `${c2.label}: ${pct}% · ${Math.round(c2.parsed / 60)} min`;
          } } },
        },
      },
    });
    if (c) charts.push(c);
  }

  /* ── Índice de Fadiga e Training Readiness ───────────────────────── */

  // Medidor 0–100 + linhas de apoio + recado. Os dois cards têm a mesma
  // anatomia, mudam só os rótulos — daí um único construtor.
  function medidorHTML({ titulo, badge, token, score, linhas, msg, vazio }) {
    if (vazio) {
      return `<div class="m-card-head"><span class="m-eyebrow">${esc(titulo)}</span></div>
              <p class="m-sub">${esc(vazio)}</p>`;
    }
    const pct = Math.min(100, Math.max(0, Number(score) || 0));
    return `
      <div class="m-card-head">
        <span class="m-eyebrow">${esc(titulo)}</span>
        <span class="m-badge" data-token="${esc(token)}">${esc(badge)}</span>
      </div>
      <div class="m-gauge">
        <span class="m-num m-num-lg" style="color:var(--${esc(token)})">${esc(score == null ? '—' : score)}</span>
        <div class="m-bar"><span style="width:${pct}%;background:var(--${esc(token)})"></span></div>
      </div>
      <div class="m-break">
        ${linhas.map(([k, v]) => `
          <div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      </div>
      ${msg ? `<p class="m-sub" style="margin-top:10px">${esc(msg)}</p>` : ''}`;
  }

  function renderFadiga(health) {
    const el = document.getElementById('m-ins-fadiga');
    if (!el) return;
    const f = Fatigue.fatigueIndex(health);
    el.innerHTML = medidorHTML(f.ok ? {
      titulo: 'Índice de fadiga', badge: f.status, token: f.token, score: f.score,
      linhas: [['Body Battery', f.bb], ['HRV (tendência)', f.hrv], ['Stress médio', f.stress]],
      msg: f.msg,
    } : {
      titulo: 'Índice de fadiga',
      vazio: 'Precisa de Body Battery e stress do Garmin — sincronize para calcular.',
    });
  }

  function renderReadiness(items) {
    const el = document.getElementById('m-ins-readiness');
    if (!el) return;
    const r = Fatigue.readiness(items);
    el.innerHTML = medidorHTML(r.ok ? {
      titulo: 'Training readiness', badge: r.label, token: r.token, score: r.score,
      linhas: [['Sono', r.sleep], ['Recuperação', r.recoveryH], ['HRV', r.hrv]],
      msg: r.msg,
    } : {
      titulo: 'Training readiness',
      vazio: 'Sem leitura de prontidão do Garmin nos últimos 14 dias.',
    });
  }

  /* ── Recordes pessoais ───────────────────────────────────────────── */

  function renderPRs(prs, vo2, weeklyRec) {
    const el    = document.getElementById('m-ins-prs');
    const count = document.getElementById('m-ins-prs-count');
    if (!el) return;

    const r = Records.personalRecords(prs, vo2, weeklyRec);
    if (!r.ok) {
      el.innerHTML = '<div class="m-empty">Nenhum recorde registrado ainda.</div>';
      if (count) count.textContent = '';
      return;
    }

    if (count) count.textContent = `${r.total}${r.temNovo ? ' · novo!' : ''}`;
    el.innerHTML = r.linhas.map(l => `
      <div class="m-pr">
        <div style="min-width:0">
          <div class="m-pr-label">${esc(l.label)}${
            l.isNew ? '<span class="m-pr-new">Novo!</span>' : ''}</div>
          <div class="m-micro">${esc(l.meta)}${l.sport ? ` · ${esc(l.sport)}` : ''}</div>
        </div>
        <div class="m-pr-val">${esc(l.valor)}</div>
      </div>`).join('');
  }

  // BUG-078: token de geracao. destroyCharts() roda ANTES do await, e os
  // graficos nascem depois — se o usuario sair da aba durante a busca, as
  // instancias eram criadas num canvas 0x0 com listener de resize pendurado.
  // O onLeave TAMBEM incrementa: sem isso, sair e NAO voltar deixaria a carga
  // em voo renderizar na view escondida.
  let _gen = 0;

  // As 7 chamadas da tela, isoladas para poderem ser memoizadas. O RENDER
  // continua rodando sempre — ver o comentario em load().
  async function buscarDados() {
    const [acts, health, vo2, dist, readiness, prs, weeklyRec] = await Promise.all([
      // 90d (não 180): calcTSBMetrics só consome uma janela fixa dos
      // últimos 60 dias (EMA com warm-up interno a partir de zero, sem
      // precisar de histórico extra antes da janela) — 90 dá margem sem
      // buscar o dobro do necessário (achado #14).
      window.UnifiedActivities.get(90).catch(() => ({ items: [] })),
      Api.get('/garmin/health?days=60').catch(() => []),
      Api.get('/garmin/vo2max').catch(() => null),
      Api.get('/garmin/zone-distribution?days=30').catch(() => null),
      Api.get('/garmin/training-readiness?days=14').catch(() => []),
      Api.get('/garmin/personal-records').catch(() => []),
      Api.get('/activities/weekly-records').catch(() => null),
    ]);
    return { acts, health, vo2, dist, readiness, prs, weeklyRec };
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const gen = ++_gen;
    view.innerHTML = skeleton();
    MShell.wireSegment(view);
    destroyCharts();

    const user = (window.Storage && Storage.getUser && Storage.getUser()) || {};
    const fcMax = Metrics.calcFCMax(user);

    // Dispara em paralelo com a busca de dados (#14) — só precisa estar
    // pronto antes dos renderXxxChart() lá embaixo.
    const chartReady = MShell.ensureChart().catch(e => console.error('[insights-mobile] chart.js', e));

    // BUG-073: so a BUSCA e memoizada (TTL de 5 min). O render nao pode ser
    // pulado — o onLeave destroi os graficos, entao uma re-entrada que nao
    // renderizasse deixaria os canvas vazios.
    const { acts, health, vo2, dist, readiness, prs, weeklyRec } =
      await MShell.cached('insights', MShell.TTL_DADOS, buscarDados);
    await chartReady;
    if (gen !== _gen) return;   // saiu da aba durante a busca

    const items = (acts && acts.items) || [];
    let ctl = null, atl = null, tsb = null, ctlSerie = [], atlSerie = [];
    if (items.length && fcMax) {
      ({ ctl, atl, tsb, ctlSerie, atlSerie } = Metrics.calcTSBMetrics(items, fcMax));
    }

    // HRV: média dos últimos 7 registros noturnos disponíveis.
    let hrv = null;
    if (Array.isArray(health) && health.length) {
      const vals = health.map(h => h.hrv_noite_avg).filter(v => v != null && isFinite(v)).slice(-7);
      if (vals.length) hrv = vals.reduce((s, v) => s + v, 0) / vals.length;
    }

    renderAlerta(tsb);
    renderKpis({ ctl, atl, tsb, vo2, hrv });
    renderLoadChart(ctlSerie, atlSerie);
    renderFadiga(health);
    renderReadiness(readiness);
    renderZonas(dist);
    renderPRs(prs, vo2, weeklyRec);
  }

  MRouter.register({
    slug: 'insights',
    // Sem tab própria desde a Fase 3 da evolução Desempenho — hoje acessado
    // por dentro da tab Desempenho (seletor segmentado) ou por deep link
    // direto; saiu do menu "Mais" na reforma mobile do handoff Desempenho.
    tab: 'desempenho',
    viewId: VIEW_ID,
    label: 'Insights',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Análise de carga', title: 'INSIGHTS DE TREINO' });
      load();
    },
    onLeave: () => { _gen++; destroyCharts(); },
  });
})();
