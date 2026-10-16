/* ═══════════════════════════════════════════════════════════════════════
   MOBILE SHELL — cabeçalho por view e utilitários compartilhados pelas
   telas mobile. A tab bar em si é markup estático de mobile.html; quem
   marca a aba ativa é o MRouter.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = window.esc || (s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  // Igual ao utils.js: escAttr é o mesmo esc. O fallback nunca escapa menos.
  const escAttr = window.escAttr || esc;

  /**
   * Troca o conteúdo do header. Duas formas:
   *   setHeader({ brand: true })                  → logo VELOCE LABS (Home)
   *   setHeader({ eyebrow: '…', title: '…' })     → cabeçalho de seção
   * `actions` é HTML já escapado pelo chamador (ícones, botões).
   * `back` é o slug para onde a seta de voltar navega — as telas que não
   * têm tab própria (Perfil, Passeios) voltam para 'mais'.
   */
  function setHeader({ brand = false, eyebrow = '', title = '', actions = '', back = '' } = {}) {
    const left  = document.getElementById('m-header-left');
    const right = document.getElementById('m-header-actions');
    if (!left || !right) return;

    left.innerHTML = brand
      ? `<div class="m-header-brand">
           <div class="m-header-mark"><i class="fa-solid fa-bicycle"></i></div>
           <span class="m-header-name">VELOCE <b>LABS</b></span>
         </div>`
      : `<div class="m-header-title">
           ${back ? `<button class="m-back" type="button" data-back="${escAttr(back)}"
                       aria-label="Voltar"><i class="fa-solid fa-chevron-left"></i></button>` : ''}
           <div style="min-width:0">
             ${eyebrow ? `<span class="m-eyebrow">${esc(eyebrow)}</span>` : ''}
             <h1>${esc(title)}</h1>
           </div>
         </div>`;
    right.innerHTML = actions || '';

    left.querySelector('[data-back]')
      ?.addEventListener('click', (e) => MRouter.navigate(e.currentTarget.dataset.back));
  }

  /**
   * Seletor segmentado genérico de abas internas — usado tanto por
   * "Desempenho | Insights" (dentro da tab Desempenho) quanto por
   * "Treino IA | Histórico" (dentro da tab Atividades, ver
   * `segmentAtividades`). Nenhuma das views que usam isso tem entrada
   * própria no menu "Mais" — continuam views independentes do MRouter
   * (próprio viewId cada), o seletor só troca de rota. `.m-segment` usa
   * grid-auto-flow:column (css/mobile-desempenho.css) — funciona com
   * qualquer nº de itens, sem precisar de uma classe modificadora por caso.
   */
  function segmentBase(itens, ativo) {
    const item = (slug, label) => `<button type="button" class="m-segment-btn${ativo === slug ? ' is-active' : ''}"
        data-slug="${escAttr(slug)}" role="tab" aria-selected="${ativo === slug}">${esc(label)}</button>`;
    return `<div class="m-segment" role="tablist">${itens.map(([slug, label]) => item(slug, label)).join('')}</div>`;
  }

  /** "Desempenho | Insights" — ver desempenho-mobile.js / insights-mobile.js. */
  function segment(ativo) {
    return segmentBase([['desempenho', 'Desempenho'], ['insights', 'Insights']], ativo);
  }

  /** "Treino | Histórico" — dentro da tab Atividades (ver activities-mobile.js / treino-ia-mobile.js). */
  function segmentAtividades(ativo) {
    return segmentBase([['treino-ia', 'Treino'], ['atividades', 'Histórico']], ativo);
  }

  /** Liga os cliques do seletor renderizado dentro de `view` à navegação do MRouter. */
  function wireSegment(view) {
    view.querySelectorAll('.m-segment-btn').forEach(btn => {
      btn.addEventListener('click', () => MRouter.navigate(btn.dataset.slug));
    });
  }

  /** Iniciais para o avatar do header (mesma regra do desktop). */
  function initials(nome) {
    const parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '--';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  /* ── Formatadores (a UI mobile encurta mais que o desktop) ────────── */

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // Uma única implementação de parsing de data, compartilhada com o desktop.
  const parseLocalDT = ActivityStats.parseLocalDT;

  function fmtDate(iso) {
    const d = parseLocalDT(iso);
    return d ? `${d.getDate()} de ${MESES[d.getMonth()]}.` : '—';
  }
  function fmtDateHora(iso) {
    const d = parseLocalDT(iso);
    if (!d) return '—';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${fmtDate(iso)} · ${hh}:${mm}`;
  }
  function fmtDuracao(s) {
    if (!s || !isFinite(s)) return '—';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h}H${String(m).padStart(2, '0')}` : `${m}MIN`;
  }
  function fmtNum(v, casas = 0) {
    if (v == null || !isFinite(v)) return '—';
    return v.toFixed(casas).replace('.', ',');
  }

  /**
   * Helper de Chart.js para telas estreitas. Cinco cuidados que o desktop
   * não precisa: altura vem do wrapper (.m-chart), sem animação, DPR
   * limitado a 2, poucos ticks, e o chamador é responsável por destruir no
   * onLeave da rota — canvas criado com a view escondida nasce 0×0, por
   * isso os gráficos são criados no onEnter, nunca no boot.
   */
  // Carrega o Chart.js (205 KB) sob demanda — mobile.html não injeta mais a
  // tag <script> síncrona, porque Home (sem gráfico) pagava esse parse+eval
  // no boot sem usar (achado #14). Memoiza a promessa: a 1ª tela com
  // gráfico injeta a tag, as próximas reaproveitam o mesmo load.
  let _chartPromise = null;
  function ensureChart() {
    if (window.Chart) return Promise.resolve();
    if (_chartPromise) return _chartPromise;
    _chartPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = () => { _chartPromise = null; s.remove(); reject(new Error('Chart.js falhou ao carregar')); };
      document.head.appendChild(s);
    });
    return _chartPromise;
  }

  function mChart(canvas, cfg) {
    if (!canvas || !window.Chart) return null;
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      plugins: { legend: { display: false } },
      elements: { point: { radius: 0 } },
    };
    const opts = cfg.options || {};
    cfg.options = Object.assign(base, opts, {
      // Object.assign é raso: sem este merge explícito, um chamador que passa
      // `plugins` (para um tooltip, p.ex.) apaga o legend:false do base e o
      // Chart.js volta a desenhar a legenda dentro do canvas.
      plugins: Object.assign({}, base.plugins, opts.plugins || {}),
    });
    return new Chart(canvas.getContext('2d'), cfg);
  }

  /* ── Cache de carga por view ──────────────────────────────────────
     BUG-073 / BUG-074: Insights e Bikes refaziam TODA a carga de rede a cada
     onEnter. Trocar de aba e voltar custava 7 e 3+N requests.

     TTL de 5 min: o sync roda a cada 30 min (server/scheduler.js) e os dados
     da Garmin nao mudam entre syncs, entao 5 min cobre 100% das trocas de aba
     de uma sessao — o caso que queremos matar — e no pior caso serve dado 5
     min velho num universo onde ele ja nasce ate 30 min velho.

     Atividades, Perfil e o clima de Passeios migraram para este padrão único
     em 2026-09-24 (antes: flag eterna em Atividades/Perfil, TTL manual
     próprio no clima) — nenhuma view mobile ficou fora do MShell.cached. */

  const TTL_DADOS = 5 * 60 * 1000;
  const _cache = new Map();   // chave -> { p: Promise, ts: number }

  /**
   * Memoiza o resultado de `fn` por `ttlMs`. Guarda a PROMESSA, nao o valor:
   * duas entradas rapidas na mesma aba coalescem numa unica ida a rede em vez
   * de disparar duas. Se `fn` rejeitar, a entrada e removida — erro nao fica
   * cacheado, e a proxima tentativa refaz a chamada.
   */
  async function cached(chave, ttlMs, fn) {
    const hit = _cache.get(chave);
    if (hit && (Date.now() - hit.ts) < ttlMs) return hit.p;
    const p = Promise.resolve().then(fn);
    _cache.set(chave, { p, ts: Date.now() });
    try { return await p; } catch (e) { _cache.delete(chave); throw e; }
  }

  /** Sem argumento limpa tudo; com chave, so aquela entrada. */
  function invalidate(chave) {
    if (chave == null) _cache.clear(); else _cache.delete(chave);
  }

  /**
   * Popover de info no clique (padrao .insight-info-btn + data-info), mesmo
   * comportamento do desktop (js/insights.js). O mobile nao carrega insights.js,
   * entao o handler vive aqui. Delegacao global: cobre qualquer botao renderizado
   * depois, sem hover (toque nao tem hover). Idempotente.
   */
  let _infoPopoverReady = false;
  function initInfoPopovers() {
    if (_infoPopoverReady) return;
    const popover = document.getElementById('insight-popover');
    if (!popover) return;
    _infoPopoverReady = true;
    let activeBtn = null;

    function hide() { popover.hidden = true; activeBtn = null; }

    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.insight-info-btn');
      if (!btn) { hide(); return; }
      e.stopPropagation();
      if (activeBtn === btn) { hide(); return; }

      activeBtn = btn;
      popover.textContent = btn.dataset.info || '';
      popover.hidden = false;

      // Posiciona abaixo do botao, limitado a janela.
      const rect = btn.getBoundingClientRect();
      const pw = Math.min(300, window.innerWidth - 24);
      popover.style.maxWidth = pw + 'px';
      let left = rect.left;
      if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
      if (left < 12) left = 12;
      let top = rect.bottom + 8;
      if (top + 120 > window.innerHeight) top = rect.top - 8 - popover.offsetHeight;
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
    }, true);
  }

  initInfoPopovers();

  window.MShell = {
    setHeader, initials, segment, segmentAtividades, wireSegment,
    parseLocalDT, fmtDate, fmtDateHora, fmtDuracao, fmtNum,
    mChart, ensureChart, esc,
    cached, invalidate, TTL_DADOS, initInfoPopovers,
  };
})();
