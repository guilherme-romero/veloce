/* ═══════════════════════════════════════════════════════════════════════
   MAIS — aba que lista as seções que só existem na UI desktop e permite
   voltar para ela. Os links levam ?ui=desktop justamente para PERSISTIR a
   escolha: sem isso, variant.js jogaria o usuário de volta ao mobile na
   carga do index.html.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-mais';

  // slug do desktop → rótulo e ícone. Os slugs vêm de ROUTES em js/router.js.
  const SECOES = [
    { slug: 'perfil',      label: 'Perfil e pesagens', icon: 'fa-user' },
    { slug: 'treinos',     label: 'Treinos',           icon: 'fa-dumbbell' },
    { slug: 'passeios',    label: 'Passeios',          icon: 'fa-calendar-day' },
    { slug: 'rotas',       label: 'Rotas',             icon: 'fa-map-location-dot' },
    { slug: 'ferramentas', label: 'Ferramentas',       icon: 'fa-screwdriver-wrench' },
    { slug: 'conexoes',    label: 'Conexões',          icon: 'fa-plug' },
  ];

  function itemHTML(s, destaque) {
    const cls = destaque ? ' is-current' : '';
    return `<a class="m-list-item${cls}" href="index.html?ui=desktop#/${s.slug}">
      <i class="fa-solid ${s.icon}"></i>
      <span>${MShell.esc(s.label)}</span>
      <i class="fa-solid fa-chevron-right m-chevron"></i>
    </a>`;
  }

  function render(slugPedido) {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    view.innerHTML = `
      <p class="m-sub">Estas seções continuam na versão desktop — abrir qualquer
      uma passa a usar essa versão até você voltar para a mobile.</p>

      <div class="m-list">
        ${SECOES.map(s => itemHTML(s, s.slug === slugPedido)).join('')}
      </div>

      <div class="m-list">
        <button class="m-list-item" type="button" id="m-switch-desktop">
          <i class="fa-solid fa-display"></i>
          <span>Usar a versão desktop</span>
          <i class="fa-solid fa-chevron-right m-chevron"></i>
        </button>
        <button class="m-list-item" type="button" id="m-logout">
          <i class="fa-solid fa-right-from-bracket"></i>
          <span>Sair</span>
          <i class="fa-solid fa-chevron-right m-chevron"></i>
        </button>
      </div>

      <p class="m-sub" style="text-align:center">VELOCE LABS v${MShell.esc(window.APP_VERSION || '')}</p>
    `;

    document.getElementById('m-switch-desktop')
      ?.addEventListener('click', () => window.Variant && Variant.switchTo('desktop'));

    document.getElementById('m-logout')?.addEventListener('click', async () => {
      // fetch direto, igual ao doLogout() do desktop (app.js:479)
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
      catch (_) {}
      location.replace('/login.html');
    });
  }

  MRouter.register({
    slug: 'mais',
    viewId: VIEW_ID,
    label: 'Mais',
    // Um slug desktop-only cai aqui; `slug` é o que o usuário pediu, e o
    // item correspondente aparece destacado em vez de redirecionar sozinho.
    onEnter: ({ slug }) => {
      MShell.setHeader({ eyebrow: 'Configurações', title: 'MAIS' });
      render(slug);
    },
  });
})();
