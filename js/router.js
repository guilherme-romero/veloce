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
      };
    });
  }

  // Override compatibilidade: scrollToSection passa a navegar
  window.scrollToSection = function (sectionId) {
    navigate(sectionId);
  };

  window.Router = { init, navigate, rebindNav, ROUTES };
})();
