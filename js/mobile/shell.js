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

  window.MShell = {
    setHeader, initials,
    parseLocalDT, fmtDate, fmtDateHora, fmtDuracao, fmtNum,
    mChart, esc,
  };
})();
