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
     #/perfil          → profile
     #/zonas           → zones
     #/fortalecimento  → home-workout
     #/treinos         → plan
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
    { slug: 'zonas',           section: 'zones',        navBtn: 'nav-zones',        label: 'Zonas FC' },
    { slug: 'bike',            section: 'bikes',        navBtn: 'nav-bikes',        label: 'Bike' },
    { slug: 'bikes',           section: 'bikes',        navBtn: 'nav-bikes',        label: 'Bike' },
    { slug: 'fortalecimento',  section: 'home-workout', navBtn: 'nav-home-workout', label: 'Fortalecimento' },
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

  // ── Mobile drawer (Fase 8.8 → BUG-001 fix: Popover API top layer) ──
  // Solução definitiva: usa Popover API quando suportada (Chrome 114+,
  // Safari 17+, Firefox 125+). O elemento vai pro top layer do browser,
  // acima de QUALQUER stacking context — escapa de backdrop-filter,
  // transforms, will-change e contain em qualquer ancestral. Fallback
  // para a abordagem antiga (classe nav-open) em browsers sem suporte.
  const _supportsPopover = typeof HTMLElement !== 'undefined'
    && HTMLElement.prototype.hasOwnProperty('popover');

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
    if (_supportsPopover && navLinks && navLinks.hasAttribute('popover')) {
      try { navLinks.showPopover(); } catch (_) {}
    }
    document.body.classList.add('nav-open');
    _setBurgerIcon(true);
  }
  function closeDrawer() {
    const navLinks = document.getElementById('nav-links');
    if (_supportsPopover && navLinks && navLinks.hasAttribute('popover')) {
      try { navLinks.hidePopover(); } catch (_) {}
    }
    document.body.classList.remove('nav-open');
    _setBurgerIcon(false);
  }
  function toggleDrawer() {
    if (document.body.classList.contains('nav-open')) closeDrawer();
    else openDrawer();
  }

  // Em mobile mantém popover="manual" ativo; em desktop remove o atributo
  // para o layout flex normal do <nav> funcionar (popover força display:none).
  function ensureDrawerPosition() {
    const navLinks = document.getElementById('nav-links');
    if (!navLinks) return;
    const isMobile = window.innerWidth <= 700;
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
      if (window.innerWidth > 700) closeDrawer();
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
