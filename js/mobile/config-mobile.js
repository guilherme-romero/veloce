/* ═══════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES (mobile) — settings editáveis do app no celular (#103).

   É a PRIMEIRA tela de escrita de perfil no mobile: o Perfil
   (profile-mobile.js) é só-leitura por design e o resto das preferências se
   edita no desktop. Hoje só o toggle do relatório mensal do Telegram; base
   para futuros settings. Grava via Storage.setUser — mesmo fluxo/PUT
   /api/profile do desktop (js/app.js), com whitelist no backend.

   Alcançada pela aba "Mais" (more-mobile.js). Slug mobile nativo, então o
   deep link #/configuracoes funciona e não cai no FALLBACK "só no desktop".
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-configuracoes';

  function render() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const u = Storage.getUser();

    view.innerHTML = `
      <div class="m-card">
        <span class="m-eyebrow">Relatório mensal</span>
        <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;margin-top:10px">
          <input type="checkbox" id="mcfg-relatorio-telegram" ${u.relatorioMensalTelegram ? 'checked' : ''} />
          <span>Enviar o resumo mensal pelo Telegram (todo dia 1º)</span>
        </label>
        <p class="m-sub" style="margin-top:10px">Requer o bot do Telegram configurado no servidor.</p>
      </div>
    `;

    const cb = document.getElementById('mcfg-relatorio-telegram');
    cb?.addEventListener('change', () => {
      // getUser() devolve o merge completo; só trocamos o toggle, o resto fica.
      Storage.setUser({ ...Storage.getUser(), relatorioMensalTelegram: cb.checked });
      window.toast?.(cb.checked ? 'Relatório mensal ativado' : 'Relatório mensal desativado');
    });
  }

  MRouter.register({
    slug: 'configuracoes',
    viewId: VIEW_ID,
    label: 'Configurações',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Perfil', title: 'CONFIGURAÇÕES', back: 'mais' });
      render();
    },
  });
})();
