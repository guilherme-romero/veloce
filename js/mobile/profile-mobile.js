/* ═══════════════════════════════════════════════════════════════════════
   PERFIL (mobile) — cartão de identidade, meta de peso, curva de 90 dias
   e zonas de FC. Acessível pela aba "Mais"; não tem tab própria.

   Os números vêm dos MESMOS cálculos do desktop:
   - js/profile.js  → calcAge, calcBMI, bmiInfo, calcFCMax, calcZones
   - js/core/weight-stats.js → regressão da meta (extraída de app.js)

   A coleção `weights` NÃO entra no boot (ver COLECOES em boot.js): é
   carregada na primeira visita a esta tela e reaproveitada depois.

   Tela SÓ LEITURA: o peso atual vem da balança Garmin (sync) e editar
   perfil/meta continua na versão desktop. O botão de registrar pesagem que
   existiu na v2.8.0 foi removido a pedido na v2.9.0.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-perfil';
  const { esc, fmtNum } = MShell;

  let chart = null;
  let _everLoaded = false;   // controla só o texto "Carregando…" na 1a visita
  let _gen = 0;

  const ZONAS = [
    { k: 'z1', nome: 'Z1 — Recuperação',       desc: 'Elimina resíduos metabólicos.' },
    { k: 'z2', nome: 'Z2 — Resistência',       desc: 'Zona da queima de gordura.' },
    { k: 'z3', nome: 'Z3 — Aeróbica',          desc: 'Melhora o transporte de oxigênio.' },
    { k: 'z4', nome: 'Z4 — Limiar de Lactato', desc: 'Sustentar esforço em subidas longas.' },
    { k: 'z5', nome: 'Z5 — VO₂ Máx',           desc: 'Aumenta a cilindrada do motor.' },
    { k: 'z6', nome: 'Z6 — Anaeróbica',        desc: 'Tiros curtos (<2 min). Explosão máxima.' },
  ];

  function destroyChart() {
    if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
  }

  /* ── Blocos ──────────────────────────────────────────────────────── */

  function idCardHTML(user) {
    const idade = calcAge(user.dataNascimento);
    const imc   = calcBMI(user.pesoAtual, user.altura);
    const fcm   = calcFCMax(idade);
    const info  = bmiInfo(imc);

    const linha = (rotulo, valor, unidade, cor) => `
      <div class="m-prow">
        <span class="m-prow-key">${esc(rotulo)}</span>
        <span class="m-prow-val"${cor ? ` style="color:${esc(cor)}"` : ''}>
          ${esc(valor)}${unidade ? ` <span class="m-unit">${esc(unidade)}</span>` : ''}
        </span>
      </div>`;

    return `<div class="m-card">
      <div class="m-pid">
        <div class="m-iconbtn m-pid-avatar" data-variant="lime">${esc(MShell.initials(user.nome))}</div>
        <div style="min-width:0">
          <div class="m-title" style="font-size:22px">${esc(user.nome || '—')}</div>
          <div class="m-sub">${esc(idade ? `${idade} anos` : 'idade —')} ·
            ${esc(user.altura ? `${(user.altura / 100).toFixed(2).replace('.', ',')} m` : 'altura —')}</div>
        </div>
      </div>
      ${linha('Peso atual', user.pesoAtual ? fmtNum(user.pesoAtual, 1) : '—', 'kg')}
      ${linha('IMC', imc ? fmtNum(imc, 1) : '—', '', info.color)}
      ${linha('Classificação', info.label, '')}
      ${linha('FC máxima', fcm || '—', 'bpm')}
    </div>`;
  }

  function metaHTML(user, analise) {
    if (!user.pesoMeta) {
      return `<div class="m-card">
        <div class="m-card-head"><span class="m-eyebrow">Meta de peso</span></div>
        <p class="m-sub">Nenhuma meta definida. Configure na versão desktop.</p>
      </div>`;
    }

    const atual = user.pesoAtual || 0;
    const meta  = user.pesoMeta;
    // Progresso a partir do peso inicial conhecido (primeira pesagem do
    // período). Sem histórico, a barra fica vazia em vez de mentir 100%.
    const inicial = analise.ok ? (WeightStats.dailyWeights(Storage.getWeights())[0] || {}).peso : null;
    let pct = 0;
    if (inicial != null && inicial !== meta) {
      pct = Math.max(0, Math.min(100, ((inicial - atual) / (inicial - meta)) * 100));
    }

    let taxa = '', msg = '';
    if (analise.ok) {
      const cor = analise.taxaPositiva ? 'magenta' : 'lime';
      const sinal = analise.taxaPositiva ? '+' : '';
      taxa = `<b style="color:var(--${cor})">${esc(sinal + String(analise.taxaKgSem).replace('.', ','))} kg/sem</b>`;
      msg  = analise.msg;
    }

    const faltam = analise.ok && analise.metaAtingida
      ? '<b style="color:var(--lime)">✓ meta atingida</b>'
      : `faltam <b style="color:var(--magenta)">${esc(fmtNum(Math.max(0, atual - meta), 1))} kg</b>`;

    return `<div class="m-card">
      <div class="m-card-head">
        <span class="m-eyebrow">Meta de peso</span>
        <span class="m-sub">${taxa}</span>
      </div>
      <div class="m-meta-row">
        <span class="m-num m-num-lg">${esc(fmtNum(atual, 1))}</span>
        <i class="fa-solid fa-arrow-right" style="color:var(--muted)"></i>
        <span class="m-num m-num-lg" style="color:var(--lime)">${esc(fmtNum(meta, 1))}</span>
        <span class="m-unit">kg</span>
      </div>
      <div class="m-bar" style="margin:12px 0 8px"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="m-sub">${faltam}${analise.ok && analise.semanas !== '—'
        ? ` · previsão <b>${esc(analise.previsao)}</b>` : ''}</div>
      ${msg ? `<p class="m-sub" style="margin-top:8px">${esc(msg)}</p>` : ''}
    </div>`;
  }

  function zonasHTML(user) {
    const fcm = calcFCMax(calcAge(user.dataNascimento));
    const z   = calcZones(fcm);

    const faixa = (k) => {
      if (!z) return '—';
      const zz = z[k];
      if (k === 'z1') return `< ${zz.max}`;
      if (k === 'z6') return `> ${z.z5.max}`;
      return `${zz.min}–${zz.max}`;
    };

    return `<div class="m-card">
      <div class="m-card-head">
        <span class="m-eyebrow">Zonas de FC</span>
        <span class="m-sub">FCM ${esc(fcm || '—')} bpm</span>
      </div>
      ${ZONAS.map(zo => `
        <div class="m-zone" data-z="${esc(zo.k)}">
          <div class="m-zone-top">
            <span class="m-zone-name">${esc(zo.nome)}</span>
            <span class="m-zone-bpm">${esc(faixa(zo.k))}</span>
          </div>
          <p class="m-micro">${esc(zo.desc)}</p>
        </div>`).join('')}
    </div>`;
  }

  function renderChart() {
    const canvas = document.getElementById('m-perfil-chart');
    if (!canvas) return;

    const corte = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const pts = WeightStats.dailyWeights(Storage.getWeights()).filter(p => p.data >= corte);
    if (pts.length < 2) {
      canvas.closest('.m-card').querySelector('.m-chart').innerHTML =
        '<div class="m-empty" style="border:0">Menos de duas pesagens nos últimos 90 dias.</div>';
      return;
    }

    const meta = Storage.getUser().pesoMeta;
    const datasets = [{
      data: pts.map(p => +p.peso.toFixed(1)),
      borderColor: '#c6f135', borderWidth: 2, tension: .3,
    }];
    if (meta) {
      datasets.push({
        data: pts.map(() => meta),
        borderColor: '#ec3a8b', borderWidth: 1, borderDash: [4, 4],
      });
    }

    chart = MShell.mChart(canvas, {
      type: 'line',
      data: { labels: pts.map(p => MShell.fmtDate(p.data)), datasets },
      options: {
        scales: {
          x: { ticks: { color: '#8b95a1', font: { size: 9 }, maxTicksLimit: 4 }, grid: { display: false } },
          y: { ticks: { color: '#8b95a1', font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: '#2a313a' } },
        },
      },
    });
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  function render() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    const user    = Storage.getUser();
    const analise = WeightStats.weightAnalysis(user, Storage.getWeights());

    view.innerHTML =
      idCardHTML(user) +
      metaHTML(user, analise) +
      `<div class="m-card">
         <div class="m-card-head"><span class="m-eyebrow">Peso · 90 dias</span></div>
         <div class="m-chart" style="height:150px"><canvas id="m-perfil-chart"></canvas></div>
       </div>` +
      zonasHTML(user);

    renderChart();
  }

  async function carregarPesagens() {
    await Storage.load(['weights']);
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    // BUG-078: mesmo token de geracao do Insights.
    const gen = ++_gen;

    if (!_everLoaded) view.innerHTML = '<div class="m-empty">Carregando pesagens…</div>';
    try {
      // Guarda com TTL de 5 min (padrão MShell) — era flag eterna, que nunca
      // refletia sync novo sem F5.
      await MShell.cached('perfil-weights', MShell.TTL_DADOS, carregarPesagens);
      _everLoaded = true;
    } catch (e) {
      console.error('[profile-mobile] weights', e);
    }
    if (gen !== _gen) return;   // saiu da aba durante a carga
    render();
  }

  MRouter.register({
    slug: 'perfil',
    aliases: ['zonas'],
    viewId: VIEW_ID,
    tab: 'mais',
    label: 'Perfil',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Seu perfil', title: 'PERFIL', back: 'mais' });
      load();
    },
    onLeave: () => { _gen++; destroyChart(); },
  });
})();
