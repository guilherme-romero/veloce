/* ═══════════════════════════════════════════════════════════════════════
   ROUTER — SPA com hash routing (Fase 8.1)

   Comportamento:
     - Cada seção <section id="X"> é mostrada/escondida via JS
     - URL #/perfil, #/atividades, #/insights, etc.
     - hashchange listener troca a seção visível
     - scrollToSection() (legado) agora vira navigate()
     - Botão ativo no nav é atualizado automaticamente

   Rotas suportadas (ID da seção ↔ slug do hash):
     #/                ou (vazio) → primeira seção configurada como default
     #/perfil          → profile (inclui zonas FC agrupado dentro)
     #/zonas           → profile (alias retrocompatível)
     #/fortalecimento  → plan (alias retrocompatível)
     #/treinos         → plan (inclui Fortalecimento em casa agrupado dentro)
     #/passeios        → rides
     #/rotas           → routes
     #/atividades      → activities
     #/insights        → insights

   Rotas futuras (Fase 8.2-8.5):
     #/                → home (landing)
     #/integracoes     → integrations
     #/historico       → history
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const ROUTES = [
    { slug: '',                section: 'home',         navBtn: 'nav-home',         label: 'Início' },
    { slug: 'inicio',          section: 'home',         navBtn: 'nav-home',         label: 'Início' },
    { slug: 'home',            section: 'home',         navBtn: 'nav-home',         label: 'Início' },
    { slug: 'perfil',          section: 'profile',      navBtn: 'nav-profile',      label: 'Perfil' },
    { slug: 'zonas',           section: 'profile',      navBtn: 'nav-profile',      label: 'Perfil' },
    { slug: 'bike',            section: 'bikes',        navBtn: 'nav-bikes',        label: 'Bike' },
    { slug: 'bikes',           section: 'bikes',        navBtn: 'nav-bikes',        label: 'Bike' },
    { slug: 'fortalecimento',  section: 'plan',         navBtn: 'nav-plan',         label: 'Treinos' },
    { slug: 'treinos',         section: 'plan',         navBtn: 'nav-plan',         label: 'Treinos' },
    { slug: 'passeios',        section: 'rides',        navBtn: 'nav-rides',        label: 'Passeios' },
    { slug: 'rotas',           section: 'routes',       navBtn: 'nav-routes',       label: 'Rotas' },
    { slug: 'atividades',      section: 'activities',   navBtn: 'nav-activities',   label: 'Histórico' },
    { slug: 'historico',       section: 'activities',   navBtn: 'nav-activities',   label: 'Histórico' },
    { slug: 'insights',        section: 'insights',     navBtn: 'nav-insights',     label: 'Insights' },
    { slug: 'conexoes',        section: 'integrations', navBtn: 'nav-integrations', label: 'Conexões' },
    // Adicionar aqui novas seções (historico, home)
  ];

  // Aliases por section ID (para legacy scrollToSection)
  const SECTION_TO_SLUG = {};
  ROUTES.forEach(r => { if (r.slug) SECTION_TO_SLUG[r.section] = r.slug; });

  const DEFAULT_SLUG = 'inicio';

  function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '').trim();
    return h || DEFAULT_SLUG;
  }

  function findRoute(slug) {
    return ROUTES.find(r => r.slug === slug) || ROUTES.find(r => r.slug === DEFAULT_SLUG);
  }

  // Esconde todas as seções, mostra só a do route
  function showSection(route) {
    if (!route) return;
    ROUTES.forEach(r => {
      const el = document.getElementById(r.section);
      if (!el) return;
      if (r.section === route.section) {
        el.style.display = '';
        el.removeAttribute('aria-hidden');
      } else {
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
      }
    });

    // Atualiza nav: marca botão ativo
    ROUTES.forEach(r => {
      const btn = document.getElementById(r.navBtn);
      if (btn) btn.classList.toggle('active', r.section === route.section);
    });

    // Atualiza título da página
    document.title = `${route.label} · Treino Bike`;

    // Rola para o topo da seção
    window.scrollTo({ top: 0, behavior: 'auto' });

    // Callbacks de entrada por seção
    if (route.section === 'rides' && window.Rides?.loadWeather) {
      window.Rides.loadWeather();
    }
    if (route.section === 'bikes' && window.Bikes?.load) {
      window.Bikes.load();
    }
    if (route.section === 'activities' && window.Activities?.refreshMaps) {
      // Leaflet criado em seção display:none renderiza com 0x0; refresh ao entrar.
      setTimeout(() => window.Activities.refreshMaps(), 60);
    }
  }

  function navigate(slugOrHashOrSection) {
    let slug = slugOrHashOrSection;
    if (typeof slug !== 'string') return;
    slug = slug.replace(/^#\/?/, '').trim();
    // Se foi passado um section ID em vez de slug, traduz
    if (SECTION_TO_SLUG[slug]) slug = SECTION_TO_SLUG[slug];
    if (!slug) slug = DEFAULT_SLUG;

    const route = findRoute(slug);
    if (!route) return;
    const targetHash = '#/' + route.slug;
    if (location.hash === targetHash) {
      // Mesmo hash — força render (útil ao boot)
      showSection(route);
    } else {
      location.hash = targetHash; // dispara hashchange → onHashChange
    }
  }

  function onHashChange() {
    const slug = parseHash();
    const route = findRoute(slug);
    showSection(route);
  }

  function init() {
    window.addEventListener('hashchange', onHashChange);
    initDrawer();
    // Render inicial baseado no hash atual (ou default)
    const slug = parseHash();
    const route = findRoute(slug);
    showSection(route);
  }

  // Re-bind dos botões da nav para usar navigate() em vez de scrollToSection legado
  function rebindNav() {
    ROUTES.forEach(r => {
      const btn = document.getElementById(r.navBtn);
      if (!btn) return;
      // Remove onclick inline (que chama scrollToSection antigo)
      btn.onclick = (e) => {
        e.preventDefault();
        navigate(r.slug || DEFAULT_SLUG);
        closeDrawer(); // fecha drawer ao navegar em mobile
      };
    });
  }

  // ── Mobile drawer (Fase 8.8 → BUG-001 v2: detecção robusta + debug) ──
  // Detecção robusta: testa se métodos showPopover/hidePopover existem
  // como função NO ELEMENTO criado, não na prototype (que pode ter o
  // método via accessor em alguma classe intermediária).
  const _supportsPopover = (() => {
    try {
      const el = document.createElement('div');
      return typeof el.showPopover === 'function'
          && typeof el.hidePopover === 'function';
    } catch { return false; }
  })();

  // Debug: ative com ?debug=drawer na URL. Mostra estado num overlay
  // fixo no canto inferior esquerdo + log no console.
  const _debug = /[?&]debug=drawer\b/.test(location.search);
  const _dbg = (...args) => {
    if (!_debug) return;
    console.log('[drawer]', ...args);
    _dbgOverlay(args.join(' '));
  };
  let _dbgEl = null;
  function _dbgOverlay(line) {
    if (!_debug) return;
    if (!_dbgEl) {
      _dbgEl = document.createElement('pre');
      _dbgEl.id = 'drawer-debug';
      _dbgEl.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:90vw;max-height:40vh;overflow:auto;background:rgba(0,0,0,0.85);color:#0f0;font:11px/1.3 monospace;padding:8px;z-index:2147483647;border:1px solid #0f0;border-radius:4px;margin:0;white-space:pre-wrap;pointer-events:auto;';
      document.body && document.body.appendChild(_dbgEl);
    }
    const ts = new Date().toISOString().slice(11,19);
    _dbgEl.textContent = `[${ts}] ${line}\n` + (_dbgEl.textContent || '').slice(0, 4000);
  }
  // Log inicial: contexto que importa
  _dbg(`supportsPopover=${_supportsPopover}`,
       `userAgent=${navigator.userAgent.slice(0,120)}`);

  function _isPopoverActive() {
    if (!_supportsPopover) return false;
    const navLinks = document.getElementById('nav-links');
    return !!(navLinks && navLinks.hasAttribute('popover') && navLinks.matches(':popover-open'));
  }

  function _setBurgerIcon(open) {
    const burger = document.getElementById('nav-hamburger');
    if (!burger) return;
    const icon = burger.querySelector('i');
    if (icon) icon.className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
  }

  function openDrawer() {
    const navLinks = document.getElementById('nav-links');
    let promoted = false;
    if (_supportsPopover && navLinks && navLinks.hasAttribute('popover')) {
      try {
        navLinks.showPopover();
        promoted = navLinks.matches(':popover-open');
      } catch (err) {
        _dbg(`showPopover ERROR: ${err.name}: ${err.message}`);
      }
    }
    document.body.classList.add('nav-open');
    _setBurgerIcon(true);
    _dbg(`open: popover=${promoted}`,
         `parent=${navLinks?.parentElement?.tagName}`,
         `hasAttr=${navLinks?.hasAttribute('popover')}`);
  }
  function closeDrawer() {
    const navLinks = document.getElementById('nav-links');
    if (_supportsPopover && navLinks && navLinks.hasAttribute('popover')) {
      try { navLinks.hidePopover(); } catch (err) {
        _dbg(`hidePopover ERROR: ${err.name}: ${err.message}`);
      }
    }
    document.body.classList.remove('nav-open');
    _setBurgerIcon(false);
  }
  function toggleDrawer() {
    if (document.body.classList.contains('nav-open')) closeDrawer();
    else openDrawer();
  }

  // Em mobile mantém popover="auto" ativo; em desktop remove o atributo
  // para o layout flex normal do <nav> funcionar (popover força display:none).
  // Detecta "mobile" pela visibilidade real do hamburger no CSS — fonte
  // única de verdade. Antes usávamos window.innerWidth <= 700, mas há
  // devices onde innerWidth pode reportar 767 enquanto o CSS mobile está
  // ativo (DPR, viewport-fit=cover, PWA standalone).
  function _isMobileNav() {
    const burger = document.getElementById('nav-hamburger');
    if (!burger) return window.innerWidth <= 700; // fallback
    return getComputedStyle(burger).display !== 'none';
  }
  function ensureDrawerPosition() {
    const navLinks = document.getElementById('nav-links');
    if (!navLinks) return;
    const isMobile = _isMobileNav();
    _dbg(`ensureDrawerPosition: mobile=${isMobile} (width=${window.innerWidth})`);
    if (_supportsPopover) {
      if (isMobile) {
        if (!navLinks.hasAttribute('popover')) navLinks.setAttribute('popover', 'auto');
      } else {
        if (navLinks.hasAttribute('popover')) {
          try { navLinks.hidePopover(); } catch (_) {}
          navLinks.removeAttribute('popover');
        }
      }
      return;
    }
    // Fallback (sem Popover API): move para body em mobile pra escapar do
    // stacking context do <nav> (parcialmente eficaz em Android — motivo
    // original do BUG-001).
    const navInner = document.querySelector('nav .nav-inner');
    if (isMobile && navLinks.parentElement !== document.body) {
      document.body.appendChild(navLinks);
    } else if (!isMobile && navLinks.parentElement === document.body && navInner) {
      const navRight = navInner.querySelector('.nav-right');
      navInner.insertBefore(navLinks, navRight);
    }
  }

  function initDrawer() {
    const burger = document.getElementById('nav-hamburger');
    if (burger) burger.addEventListener('click', toggleDrawer);

    // Posiciona o drawer corretamente baseado no tamanho da tela
    ensureDrawerPosition();

    // Log estado inicial do drawer
    const _initNav = document.getElementById('nav-links');
    _dbg(`init: width=${window.innerWidth}`,
         `parent=${_initNav?.parentElement?.tagName}`,
         `hasAttr=${_initNav?.hasAttribute('popover')}`,
         `attr=${_initNav?.getAttribute('popover')}`);

    // Sincroniza classe/ícone com light dismiss (clicar fora ou ESC)
    // do popover. Evento 'toggle' dispara em qualquer mudança de estado.
    const navLinks = document.getElementById('nav-links');
    if (navLinks && _supportsPopover) {
      navLinks.addEventListener('toggle', (e) => {
        const open = e.newState === 'open';
        document.body.classList.toggle('nav-open', open);
        _setBurgerIcon(open);
      });
    }

    // Backdrop: cria div fixo atrás do drawer e fecha ao clicar
    let backdrop = document.getElementById('nav-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'nav-backdrop';
      backdrop.className = 'nav-backdrop';
      backdrop.addEventListener('click', closeDrawer);
      document.body.appendChild(backdrop);
    }

    // Resize: fecha drawer + reposiciona elemento se cruzou breakpoint
    window.addEventListener('resize', () => {
      if (!_isMobileNav()) closeDrawer();
      ensureDrawerPosition();
    });

    // Fecha com tecla ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });
  }

  // Override compatibilidade: scrollToSection passa a navegar
  window.scrollToSection = function (sectionId) {
    navigate(sectionId);
  };

  window.Router = { init, navigate, rebindNav, ROUTES };
})();
