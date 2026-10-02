/* ═══════════════════════════════════════════════════════════════════════
   DESEMPENHO (Fase 3 da evolução IDEIA-1+2) — porta pro mobile o mesmo
   motor puro do desktop (js/core/training-suggestion.js e
   js/core/suggestion-history.js, Fases 1-2 já entregues): Sugestão de
   Treino + Cruzamento sugestão×execução, ambos calibrados via
   GET /garmin/calibration. Nenhuma lógica nova aqui — só orquestração de
   fetch + render, mesma duplicação já aceita entre insights.js e
   insights-mobile.js (o projeto não compartilha essa camada entre
   desktop/mobile, só o motor em js/core/).

   Sem MShell.cached de propósito: a Sugestão de Treino é uma regra barata
   que deve recalcular a cada abertura — é uma propriedade do próprio
   conceito no GLOSSARY.md, não uma escolha de plataforma (aplicar cache só
   aqui criaria duas fontes de verdade pra mesma seção).

   Seletor segmentado "Desempenho | Insights" (MShell.segment) no topo:
   Insights saiu do menu "Mais" e passou a viver aqui dentro (inverso do
   handoff mobile original, que propunha o contrário) — ver
   js/mobile/insights-mobile.js.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-desempenho';

  // Mesmo mapa de js/proximo-treino.js (desktop) — duplicado de propósito,
  // mesma disciplina do projeto de não compartilhar a camada de apresentação
  // entre desktop/mobile, só o motor em js/core/.
  const ESTADOS_VEREDITO = {
    'recuperacao':     { label: 'Recuperação',                bg: 'var(--magenta)', icon: 'fa-bed' },
    'volume':          { label: 'Treino leve / manutenção',   bg: 'var(--amber)',   icon: 'fa-feather' },
    'zona-alvo:amber': { label: 'Treino forte / intervalado', bg: 'var(--lime)',    icon: 'fa-bolt' },
    'zona-alvo:green': { label: 'Treino normal',              bg: 'var(--lime)',    icon: 'fa-bicycle' },
  };

  function estadoVeredito(sug) {
    const chave = sug.categoria === 'zona-alvo' ? `zona-alvo:${sug.token}` : sug.categoria;
    return ESTADOS_VEREDITO[chave] || ESTADOS_VEREDITO['zona-alvo:green'];
  }

  function splitMotivoAcao(msg) {
    const idx = msg.indexOf(' — ');
    if (idx === -1) return { subtitulo: '', titulo: msg };
    return { subtitulo: msg.slice(0, idx), titulo: msg.slice(idx + 3) };
  }

  function skeleton() {
    return `
      ${MShell.segment('desempenho')}
      <div class="m-empty" id="m-desemp-empty" hidden></div>
      <div id="m-desemp-top">
        <div class="mdesemp-verdict" id="mdesemp-verdict">
          <span class="mdesemp-verdict__badge"><i id="mdesemp-verdict-icon" class="fa-solid"></i>
            <span id="mdesemp-verdict-categoria"></span></span>
          <div class="mdesemp-verdict__title" id="mdesemp-verdict-title"></div>
          <div class="mdesemp-verdict__sub" id="mdesemp-verdict-sub"></div>
        </div>
        <div class="mdesemp-adherence">
          <div class="mdesemp-adherence__ring" id="mdesemp-adherence-ring" hidden>
            <div class="mdesemp-adherence__ring-inner">
              <span class="mdesemp-adherence__pct" id="mdesemp-adherence-pct"></span>
            </div>
          </div>
          <div class="mdesemp-adherence__body">
            <span class="mdesemp-adherence__label">Aderência · 90 dias</span>
            <p class="mdesemp-adherence__text" id="mdesemp-adherence-text"></p>
            <p class="mdesemp-adherence__empty" id="mdesemp-adherence-empty" hidden>Sem histórico suficiente.</p>
          </div>
        </div>
      </div>

      <div class="m-card mdesemp-analysis">
        <div class="m-card-head">
          <span class="m-eyebrow" id="m-pa-label">Análise</span>
          <button id="m-pa-btn" class="mdesemp-btn" type="button" hidden>
            <i class="fa-solid fa-wand-magic-sparkles"></i> Analisar de novo
          </button>
        </div>
        <div class="m-empty" id="m-pa-empty"></div>
        <div id="m-pa-content" hidden>
          <div class="mdesemp-analysis__grid">
            <div class="mdesemp-stat-tile">
              <div class="mdesemp-stat__value" id="m-pa-stat-vel"></div>
              <div class="mdesemp-stat__label">vel. média km/h</div>
            </div>
            <div class="mdesemp-stat-tile">
              <div class="mdesemp-stat__value mdesemp-stat__value--fc" id="m-pa-stat-fc"></div>
              <div class="mdesemp-stat__label">fc média bpm</div>
            </div>
          </div>
          <div id="m-pa-texto"></div>
          <div class="mdesemp-focus" id="m-pa-foco" hidden>
            <div class="mdesemp-focus__title"><i class="fa-solid fa-crosshairs"></i>Foco de treino</div>
            <p class="mdesemp-focus__text" id="m-pa-foco-text"></p>
          </div>
          <p class="mdesemp-meta" id="m-pa-meta"></p>
        </div>
      </div>

      <div class="m-card mdesemp-compare">
        <div class="m-card-head">
          <span class="m-eyebrow">Comparativo · 30d</span>
        </div>
        <div class="m-empty" id="m-comp-empty" hidden>Pedale por pelo menos 3 saídas em cada um dos últimos dois períodos de 30 dias para ver o comparativo.</div>
        <div id="m-comp-content" hidden>
          <div class="mdesemp-compare-grid">
            <div class="mdesemp-carousel-tile">
              <div class="mdesemp-tile__label">Volume</div>
              <div class="mdesemp-tile__value" id="m-comp-volume-value"></div>
              <div class="mdesemp-tile__delta" id="m-comp-volume-delta"></div>
              <div class="mdesemp-bars">
                <div class="mdesemp-bar"><div class="mdesemp-bar__fill" id="m-comp-volume-bar-anterior" style="background:var(--border2);"></div></div>
                <div class="mdesemp-bar"><div class="mdesemp-bar__fill" id="m-comp-volume-bar-atual" style="background:var(--lime);"></div></div>
              </div>
            </div>
            <div class="mdesemp-carousel-tile">
              <div class="mdesemp-tile__label">Tempo de pedal</div>
              <div class="mdesemp-tile__value" id="m-comp-tempo-value"></div>
              <div class="mdesemp-tile__delta" id="m-comp-tempo-delta"></div>
              <div class="mdesemp-bars">
                <div class="mdesemp-bar"><div class="mdesemp-bar__fill" id="m-comp-tempo-bar-anterior" style="background:var(--border2);"></div></div>
                <div class="mdesemp-bar"><div class="mdesemp-bar__fill" id="m-comp-tempo-bar-atual" style="background:var(--lime);"></div></div>
              </div>
            </div>
            <div class="mdesemp-carousel-tile">
              <div class="mdesemp-tile__label">Altimetria</div>
              <div class="mdesemp-tile__value" id="m-comp-altimetria-value"></div>
              <div class="mdesemp-tile__delta" id="m-comp-altimetria-delta"></div>
              <div class="mdesemp-bars">
                <div class="mdesemp-bar"><div class="mdesemp-bar__fill" id="m-comp-altimetria-bar-anterior" style="background:var(--border2);"></div></div>
                <div class="mdesemp-bar"><div class="mdesemp-bar__fill" id="m-comp-altimetria-bar-atual" style="background:var(--lime);"></div></div>
              </div>
            </div>
            <div class="mdesemp-carousel-tile" id="m-comp-peso-card" hidden>
              <div class="mdesemp-tile__label">Peso corporal</div>
              <div class="mdesemp-tile__value" id="m-comp-peso-value"></div>
              <div class="mdesemp-tile__delta" id="m-comp-peso-delta"></div>
              <svg viewBox="0 0 160 40" preserveAspectRatio="none">
                <polyline id="m-comp-peso-line" class="mdesemp-sparkline" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
                <circle id="m-comp-peso-dot" class="mdesemp-sparkline-dot" r="3.5"></circle>
              </svg>
            </div>
          </div>
          <div class="mdesemp-zone-card">
            <div class="mdesemp-tile__label">Tempo por zona</div>
            <div class="mdesemp-zone-row">
              <span class="mdesemp-zone-row__label">Anterior</span>
              <div class="mdesemp-zone-row__bar" id="m-comp-zona-anterior-bar"></div>
              <span class="mdesemp-zone-row__total" id="m-comp-zona-anterior-total"></span>
            </div>
            <div class="mdesemp-zone-row">
              <span class="mdesemp-zone-row__label">Atual</span>
              <div class="mdesemp-zone-row__bar" id="m-comp-zona-atual-bar"></div>
              <span class="mdesemp-zone-row__total" id="m-comp-zona-atual-total"></span>
            </div>
            <div class="mdesemp-zone-legend">
              <span class="mdesemp-zone-legend__item"><span class="mdesemp-zone-legend__swatch" style="background:var(--blue);"></span>Resistência</span>
              <span class="mdesemp-zone-legend__item"><span class="mdesemp-zone-legend__swatch" style="background:var(--amber);"></span>Limiar</span>
              <span class="mdesemp-zone-legend__item"><span class="mdesemp-zone-legend__swatch" style="background:var(--red);"></span>Máximo</span>
            </div>
          </div>
        </div>
      </div>

      <p class="mdesemp-footnote">Sugestão por regras locais (fadiga, TSB e zonas de FC) — heurística do app, não IA.</p>`;
  }

  function mostrarTopoVazio(msg) {
    const top   = document.getElementById('m-desemp-top');
    const empty = document.getElementById('m-desemp-empty');
    if (top) top.hidden = true;
    if (empty) { empty.hidden = false; empty.textContent = msg; }
  }

  // BUG-078 (mesmo padrão de insights-mobile.js): entrar/sair/voltar rápido
  // da aba antes da resposta chegar não pode deixar uma busca antiga
  // sobrescrever o Veredito/Aderência com dado desatualizado. onLeave (no
  // MRouter.register abaixo) também invalida os módulos de Análise e
  // Comparativo, que têm seu próprio _gen.
  let _gen = 0;

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const gen = ++_gen;

    // Veredito/Aderência, Análise e Comparativo são independentes entre si
    // (fontes de dados próprias) — uma falha num bloco não deve derrubar os
    // outros dois, por isso o markup inteiro nasce sempre e cada bloco
    // decide por conta própria se mostra dado ou estado vazio.
    view.innerHTML = skeleton();
    MShell.wireSegment(view);

    try {
      // fcMax antes do Promise.all — a calibração precisa dele na query
      // string (mesma ordem de js/proximo-treino.js).
      const user  = window.Storage ? Storage.getUser() : {};
      const fcMax = window.Metrics.calcFCMax(user);

      const [unified, health, zoneDist, calibracao] = await Promise.all([
        window.Api.get('/activities/unified?days=180').catch(() => ({ items: [] })),
        // 104 dias: 90 do Cruzamento sugestão×execução + margem de lookback
        // do fatigueIndex — mesmo raciocínio de js/proximo-treino.js.
        window.Api.get('/garmin/health?days=104').catch(() => []),
        window.Api.get('/garmin/zone-distribution?days=30').catch(() => null),
        fcMax ? window.Api.get('/garmin/calibration?fcMax=' + fcMax).catch(() => null) : Promise.resolve(null),
      ]);
      if (gen !== _gen) return;

      const activities = (unified && unified.items) || [];
      const healthArr = Array.isArray(health) ? [...health].sort((a, b) => b.data.localeCompare(a.data)) : [];
      const limiares = calibracao ? {
        zonaAltaMinPct: calibracao.zonaAltaMinPct,
        tsbSobrecarga:  calibracao.tsbSobrecarga,
      } : undefined;

      const sug = window.TrainingSuggestion.suggest({
        activities, health: healthArr, zoneDist, fcMax, limiares,
      });

      if (!sug.ok) {
        mostrarTopoVazio('Sincronize com o Garmin e treine por pelo menos 7 dias para ver a sugestão aqui.');
      } else {
        const estado = estadoVeredito(sug);
        const { titulo, subtitulo } = splitMotivoAcao(sug.msg);

        const verdict = document.getElementById('mdesemp-verdict');
        if (verdict) verdict.style.background = estado.bg;
        const icon = document.getElementById('mdesemp-verdict-icon');
        if (icon) icon.className = 'fa-solid ' + estado.icon;
        const categoriaEl = document.getElementById('mdesemp-verdict-categoria');
        if (categoriaEl) categoriaEl.textContent = estado.label;
        const tituloEl = document.getElementById('mdesemp-verdict-title');
        if (tituloEl) tituloEl.textContent = titulo.replace(/\.$/, '').toUpperCase();
        const subEl = document.getElementById('mdesemp-verdict-sub');
        if (subEl) subEl.textContent = subtitulo;

        const limiarTss = calibracao ? calibracao.tssRecuperacaoIgnorada : undefined;
        const hist = window.SuggestionHistory.analyze({ activities, health: healthArr, fcMax, days: 90, limiarTss });
        const ring  = document.getElementById('mdesemp-adherence-ring');
        const texto = document.getElementById('mdesemp-adherence-text');
        const vazio = document.getElementById('mdesemp-adherence-empty');
        if (hist.ok) {
          if (ring) {
            ring.hidden = false;
            ring.style.background = `conic-gradient(var(--lime) 0 ${hist.percentual}%, var(--border) ${hist.percentual}% 100%)`;
          }
          const pct = document.getElementById('mdesemp-adherence-pct');
          if (pct) pct.textContent = hist.percentual + '%';
          if (texto) {
            texto.hidden = false;
            texto.replaceChildren();
            texto.append('Você seguiu a recuperação em ');
            const strong = document.createElement('strong');
            strong.style.color = 'var(--text)';
            strong.textContent = `${hist.seguiu} de ${hist.total}`;
            texto.append(strong, ` ocasiões nos últimos ${hist.janelaDias} dias.`);
          }
          if (vazio) vazio.hidden = true;
        } else {
          if (ring) ring.hidden = true;
          if (texto) texto.hidden = true;
          if (vazio) vazio.hidden = false;
        }
      }
    } catch (err) {
      if (gen !== _gen) return;
      console.error('[desempenho-mobile]', err);
      mostrarTopoVazio('Falha ao calcular a sugestão de treino.');
    }

    // Independentes do bloco acima: Análise busca /performance-analysis,
    // Comparativo calcula no cliente a partir de /activities,
    // /garmin/zone-distribution-by-activity e /weights. Cada um tem seu
    // próprio _gen, invalidado junto no onLeave abaixo.
    window.PerformanceAnalysisMobile?.load();
    window.ComparativePerformanceMobile?.load();
  }

  MRouter.register({
    slug: 'desempenho',
    viewId: VIEW_ID,
    label: 'Desempenho',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Sugestão do dia', title: 'DESEMPENHO' });
      load();
    },
    onLeave: () => {
      _gen++;
      window.PerformanceAnalysisMobile?.invalidate();
      window.ComparativePerformanceMobile?.invalidate();
    },
  });
})();
