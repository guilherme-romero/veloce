/* ═══════════════════════════════════════════════════════════════════════
   MAIS — entrada para as views que existem na UI mobile mas não têm tab
   própria (Perfil e Passeios), mais as ações de conta.

   Até a v2.7.9 esta aba listava as seções desktop-only como links para
   index.html. Na v2.8.0 Perfil e Passeios viraram telas mobile nativas e
   as demais (Treinos, Rotas, Ferramentas, Conexões, Testes) saíram da
   lista por decisão de escopo: no celular só o que foi desenhado para o
   celular. Elas seguem alcançáveis pelo botão "Usar a versão desktop", e
   um deep link para o slug delas continua caindo nesta tela (ver
   FALLBACK em router-mobile.js).
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-mais';

  // Views mobile nativas alcançadas por aqui. O slug é o MESMO do desktop,
  // então #/perfil e #/passeios funcionam nas duas variantes.
  const SECOES = [
    { slug: 'perfil',   label: 'Perfil e pesagens', icon: 'fa-user' },
    { slug: 'passeios', label: 'Passeios',          icon: 'fa-calendar-day' },
  ];

  function itemHTML(s) {
    return `<button class="m-list-item" type="button" data-slug="${escAttr(s.slug)}">
      <i class="fa-solid ${escAttr(s.icon)}"></i>
      <span>${MShell.esc(s.label)}</span>
      <i class="fa-solid fa-chevron-right m-chevron"></i>
    </button>`;
  }

  function render(slugPedido) {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    // Um slug que a UI mobile não implementa cai aqui; em vez de um 404
    // silencioso, a tela explica onde aquela seção mora.
    const naoImplementado = slugPedido && slugPedido !== 'mais'
      && !SECOES.some(s => s.slug === slugPedido);

    view.innerHTML = `
      ${naoImplementado ? `<p class="m-sub" style="color:var(--amber)">
        Esta seção existe só na versão desktop — abra-a pelo botão abaixo.</p>` : ''}

      <div class="m-list">
        ${SECOES.map(itemHTML).join('')}
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

    view.querySelectorAll('[data-slug]').forEach(btn => {
      btn.addEventListener('click', () => MRouter.navigate(btn.dataset.slug));
    });

    document.getElementById('m-switch-desktop')
      ?.addEventListener('click', () => window.Variant && Variant.switchTo('desktop'));

    document.getElementById('m-logout')?.addEventListener('click', async () => {
      // Dados de saude nao podem sobreviver ao logout no aparelho. Antes do
      // fetch de proposito: vale mesmo se a chamada de rede falhar.
      try { await caches.delete('treino-bike-data'); } catch (_) {}
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
    onEnter: ({ slug }) => {
      MShell.setHeader({ eyebrow: 'Configurações', title: 'MAIS' });
      render(slug);
    },
  });
})();
