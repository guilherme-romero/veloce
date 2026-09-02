/* ═══════════════════════════════════════════════════════════════════════
   MOBILE ROUTER — hash router das 5 abas + das views que só existem
   dentro da aba "Mais" (Perfil, Passeios).

   É um arquivo novo em vez de uma parametrização de js/router.js porque
   ~180 das 334 linhas de lá são o drawer (Popover API, backdrop, detecção
   de mobile por getComputedStyle do hamburger, overlay de debug) — nada
   disso existe numa tab bar — e porque router.js sobrescreve
   window.scrollToSection para servir os onclick inline do index.html,
   contrato que a UI mobile não tem.

   Diferenças de contrato em relação ao desktop:
   - as views se AUTO-REGISTRAM via register(), em vez de um array ROUTES
     hardcoded;
   - onEnter/onLeave substituem o if encadeado (onLeave é onde os gráficos
     do Chart.js são destruídos);
   - o formato do hash (#/slug) e os slugs são IDÊNTICOS aos do desktop, de
     modo que #/insights funciona nas duas variantes e sobrevive à troca.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const routes  = new Map();   // slug canônico → rota
  const aliases = new Map();   // slug alternativo → slug canônico
  let current = null;      // slug canônico da view visível
  let currentRaw = null;   // slug que o usuário pediu (difere no FALLBACK)
  let started = false;

  const DEFAULT = 'inicio';
  const FALLBACK = 'mais';     // slug de seção que só existe no desktop

  /**
   * @param {Object}   r
   * @param {string}   r.slug      — slug canônico (igual ao do desktop)
   * @param {string[]} [r.aliases] — outros slugs que caem nesta view
   * @param {string}   r.viewId    — id da <section class="m-view">
   * @param {string}   [r.tab]     — slug da tab que fica acesa (para views
   *                                 sem tab própria, como Perfil/Passeios)
   * @param {string}   r.label     — vira o <title> da página
   * @param {Function} [r.onEnter] — chamado ao entrar (recebe { slug })
   * @param {Function} [r.onLeave] — chamado ao sair
   */
  function register(r) {
    routes.set(r.slug, r);
    (r.aliases || []).forEach(a => aliases.set(a, r.slug));
    if (started) apply(slugFromHash());   // registro tardio ainda pega a rota atual
  }

  function resolve(slug) {
    if (routes.has(slug)) return slug;
    if (aliases.has(slug)) return aliases.get(slug);
    // Slug de seção que a UI mobile não tem (treinos, rotas, ferramentas,
    // conexoes, testes): cai na aba Mais em vez de 404. Não redireciona
    // sozinho para o desktop — um redirect automático a partir de um deep
    // link confunde.
    return routes.has(FALLBACK) ? FALLBACK : DEFAULT;
  }

  function slugFromHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
    return raw || DEFAULT;
  }

  function apply(rawSlug) {
    const slug = resolve(rawSlug);
    const route = routes.get(slug);
    if (!route) return;
    // Dois slugs desktop-only diferentes resolvem ambos para 'mais', mas a
    // tela precisa reagir ao que foi pedido (é ela que explica onde aquela
    // seção mora). Mesma view + pedido novo = só re-executa o onEnter, sem
    // refazer a troca de views nem o onLeave.
    if (current === slug) {
      if (currentRaw === rawSlug) return;
      currentRaw = rawSlug;
      if (typeof route.onEnter === 'function') {
        try { route.onEnter({ slug: rawSlug }); }
        catch (e) { console.error('[MRouter] onEnter', slug, e); }
      }
      return;
    }

    const prev = current && routes.get(current);
    if (prev && typeof prev.onLeave === 'function') {
      try { prev.onLeave(); } catch (e) { console.error('[MRouter] onLeave', prev.slug, e); }
    }

    routes.forEach((r) => {
      const el = document.getElementById(r.viewId);
      if (!el) return;
      const on = r.slug === slug;
      el.hidden = !on;
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
    });

    // Views sem tab própria (Perfil, Passeios) mantêm acesa a tab de onde
    // se chega até elas — sem isso a barra fica sem nenhuma marcação.
    const tabAtiva = route.tab || slug;
    document.querySelectorAll('.m-tab').forEach((tab) => {
      const on = tab.dataset.slug === tabAtiva;
      tab.classList.toggle('is-active', on);
      if (on) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });

    current = slug;
    currentRaw = rawSlug;
    document.title = route.label ? `${route.label} · VELOCE LABS` : 'VELOCE LABS';
    window.scrollTo(0, 0);

    if (typeof route.onEnter === 'function') {
      try { route.onEnter({ slug: rawSlug }); } catch (e) { console.error('[MRouter] onEnter', slug, e); }
    }
  }

  function navigate(slug) {
    const target = '#/' + slug;
    if (location.hash === target) apply(slug);
    else location.hash = target;      // hashchange chama apply()
  }

  function init() {
    started = true;

    document.querySelectorAll('.m-tab').forEach((tab) => {
      tab.addEventListener('click', () => navigate(tab.dataset.slug));
    });

    window.addEventListener('hashchange', () => apply(slugFromHash()));

    const slug = slugFromHash();
    // Normaliza a URL: entrar em mobile.html sem hash deve virar #/inicio,
    // e um slug desktop-only deve mostrar na barra a aba onde ele caiu.
    const resolved = resolve(slug);
    if (!location.hash || resolved !== slug) {
      history.replaceState(null, '', '#/' + resolved);
    }
    apply(slug);
  }

  window.MRouter = { init, navigate, register, current: () => current };
})();
