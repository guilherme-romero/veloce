/* ═══════════════════════════════════════════════════════════════════════
   PWA — registro do service worker e detecção de nova versão
═══════════════════════════════════════════════════════════════════════ */

(function () {
  if (!('serviceWorker' in navigator)) return;

  let registration = null;
  let updateBannerShown = false;

  // BUG-068 — foto tirada ANTES de registrar o SW. Se a pagina nasceu sem
  // controlador, a primeira tomada de controle e' INSTALACAO, nao atualizacao:
  // o SW faz skipWaiting() no install e clients.claim() no activate, e o claim
  // assume esta pagina ja aberta, emitindo 'controllerchange' sem que exista
  // versao nova. Era isso que fazia o banner "Nova versao disponivel" aparecer
  // na 1a visita, apos Shift+Reload, apos limpar dados, e — o caso mais comum
  // no celular — depois de o iOS descartar o SW por ~7 dias sem uso.
  // Precisa ser uma FOTO, nao leitura ao vivo: com skipWaiting() o claim pode
  // ja ter ocorrido quando o statechange dispara, e a leitura ao vivo passaria
  // a mentir justamente numa instalacao nova.
  const paginaJaControlada = !!navigator.serviceWorker.controller;

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
          if (newWorker.state === 'installed' && paginaJaControlada) {
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

  // Navegação pedida pelo clique numa notificação push (#3 Nível B): o SW
  // focou esta janela e manda o hash — só o cliente conhece a variante/rota.
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'PUSH_NAVIGATE' && typeof d.hash === 'string' && d.hash) {
      location.hash = d.hash;
    }
  });

  // O SW faz skipWaiting()+clients.claim(), então 'controllerchange' pode
  // disparar sozinho (nova versão assume em background). Só recarregamos se o
  // usuário pediu (botão "Atualizar"); caso contrário, mostramos o banner e
  // deixamos ele recarregar quando quiser — sem interromper o uso.
  let refreshing = false;
  let userTriggeredUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    if (userTriggeredUpdate) {
      refreshing = true;
      window.location.reload();
      return;
    }
    // Sem controlador na carga: este evento e' o claim da PRIMEIRA instalacao.
    // Nao ha versao nova, entao nao pode aparecer banner (BUG-068).
    if (!paginaJaControlada) {
      console.log('[PWA] SW assumiu a pagina pela 1a vez — instalacao, nao atualizacao');
      return;
    }
    showUpdateBanner();
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
      userTriggeredUpdate = true;
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        // o controllerchange acima vai recarregar (userTriggeredUpdate=true)
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
