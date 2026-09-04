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

      // BUG-074: Bikes.load() faz /bikes + /bikes/meta/brands +
      // /component-types + UMA chamada por bike. A guarda fica AQUI e nunca
      // dentro de Bikes.load() — js/bikes.js chama o proprio load() em 12
      // pontos apos criar/editar/remover bike ou componente, e engessar isso
      // faria a Garagem parar de refletir as mutacoes.
      //
      // Pular o load inteiro e seguro nesta view: ela nao tem grafico nem
      // onLeave, e o markup renderizado permanece no DOM escondido.
      if (window.Bikes && Bikes.load) {
        MShell.cached('bikes', MShell.TTL_DADOS, async () => { await Bikes.load(); return true; });
      }
    },
  });
})();
