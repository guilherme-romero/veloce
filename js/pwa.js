/* ═══════════════════════════════════════════════════════════════════════
   PWA — registro do service worker e detecção de nova versão
═══════════════════════════════════════════════════════════════════════ */

(function () {
  if (!('serviceWorker' in navigator)) return;

  let registration = null;
  let updateBannerShown = false;

  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('./service-worker.js');
      console.log(`[PWA] SW registrado (escopo: ${registration.scope})`);

      // FORÇA verificação de update logo após registrar — pega correções rápido
      try { await registration.update(); } catch (_) {}

      // Quando uma nova versão é encontrada, espera estado 'installed'
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        console.log('[PWA] Nova versão do SW detectada — instalando…');
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Nova versão instalada e pronta para ativar
            console.log('[PWA] Nova versão pronta — banner exibido');
            showUpdateBanner();
          }
        });
      });

      // Verifica updates periodicamente (1 vez por hora) enquanto a página estiver aberta
      setInterval(() => {
        if (registration) registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    } catch (e) {
      console.warn('[PWA] SW registration failed:', e);
    }
  });

  // Quando o SW assume controle, recarrega a página (após o usuário aceitar)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  function showUpdateBanner() {
    if (updateBannerShown) return;
    updateBannerShown = true;

    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.innerHTML = `
      <div class="update-banner-inner">
        <i class="fa-solid fa-arrow-rotate-right"></i>
        <span>Nova versão disponível</span>
        <button class="btn btn-sm btn-primary" type="button" data-update>Atualizar</button>
        <button class="update-banner-close" type="button" data-dismiss aria-label="Fechar">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    document.body.appendChild(banner);

    banner.querySelector('[data-update]').onclick = () => {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        // o controllerchange acima vai recarregar
      } else {
        window.location.reload();
      }
    };
    banner.querySelector('[data-dismiss]').onclick = () => {
      banner.remove();
      updateBannerShown = false;
    };
  }
})();
