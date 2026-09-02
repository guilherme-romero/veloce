/* ═══════════════════════════════════════════════════════════════════════
   BIKES (tela 04 do handoff) — módulo fino: js/bikes.js faz todo o
   trabalho, inclusive o sheet de componente (openComponentDetail), desde
   que mobile.html forneça os ids #bikes-list / #bikes-empty /
   #btn-add-bike / #btn-add-bike-empty.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-bikes';

  MRouter.register({
    slug: 'bikes',
    aliases: ['bike'],
    viewId: VIEW_ID,
    label: 'Bikes',
    onEnter: () => {
      MShell.setHeader({
        eyebrow: 'Equipamento',
        title: 'GARAGEM',
        actions: `<button id="btn-add-bike" class="m-btn m-btn-primary" type="button"
                    style="font-size:15px;padding:10px 16px;min-height:40px">
                    <i class="fa-solid fa-plus"></i> Nova</button>`,
      });
      // O botão vive no header, recriado a cada onEnter: o bind é aqui, e
      // não no Bikes.init() (que roda uma vez só, no boot).
      document.getElementById('btn-add-bike')
        ?.addEventListener('click', () => Bikes.openBikeModal(null));

      if (window.Bikes && Bikes.load) Bikes.load();
    },
  });
})();
