/* ═══════════════════════════════════════════════════════════════════════
   PUSH-OPTIN — ativação das notificações push no device (#3 Nível B, F3).

   Expõe window.PushOptin para os toggles do Perfil (desktop, js/app.js) e das
   Configurações (mobile, js/mobile/config-mobile.js). O "ligado" NÃO é uma
   preferência salva no perfil: é o estado real deste device — permissão do
   navegador + existência de uma PushSubscription registrada no serviço de push
   e no banco (POST /api/push/subscribe). Por isso cada device liga/desliga por
   si; não há flag global.

   `enable()` precisa ser chamada DENTRO do handler do clique no toggle: o
   Notification.requestPermission() exige user-gesture. O estado é lido de
   Notification.permission + registration.pushManager.getSubscription().

   iOS: push só com o PWA instalado na tela inicial (standalone) e iOS 16.4+.
   Fora disso isSupported() é false e a UI mostra a instrução. Foco v1: Android.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  // VAPID pública (base64url) → Uint8Array que o pushManager.subscribe espera.
  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }
  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPod|iPad/.test(ua) ||
           (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  // Suporte técnico a push neste contexto. No iOS, exige PWA instalado.
  function isSupported() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return false;
    }
    if (isIOS() && !isStandalone()) return false;
    return true;
  }

  // Motivo de indisponibilidade, para a UI mostrar a instrução certa.
  function unsupportedReason() {
    if (isIOS() && !isStandalone()) return 'ios-install';
    return 'unsupported';
  }

  async function _subscription() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  /**
   * Estado atual do opt-in neste device.
   * @returns {Promise<'unsupported'|'blocked'|'on'|'off'>}
   */
  async function currentState() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    try {
      return (await _subscription()) ? 'on' : 'off';
    } catch (_) {
      return 'off';
    }
  }

  /**
   * Liga as notificações: pede permissão, assina e registra no backend.
   * CHAMAR dentro do handler de clique (user-gesture).
   * @returns {Promise<'on'|'blocked'|'unsupported'|'no-server'>}
   */
  async function enable() {
    if (!isSupported()) return 'unsupported';

    const perm = await Notification.requestPermission();
    // 'denied' é bloqueio real (só o usuário reverte nas configs do navegador);
    // 'default' é só o prompt dispensado — pode tentar de novo, volta a 'off'.
    if (perm === 'denied') return 'blocked';
    if (perm !== 'granted') return 'off';

    // Chave pública do servidor (503 = VAPID não configurado lá).
    let key;
    try {
      key = (await window.Api.get('/push/vapid-public-key')).key;
    } catch (e) {
      if (e.status === 503) return 'no-server';
      throw e;
    }
    if (!key) return 'no-server';

    const reg = await navigator.serviceWorker.ready;
    // Reusa a subscription existente se já houver (evita trocar à toa).
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    const json = sub.toJSON();
    try {
      await window.Api.post('/push/subscribe', {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
    } catch (e) {
      // Registro no servidor falhou: desfaz a subscription local para não
      // ficar "ligado" no device sem o servidor saber (digest nunca sairia).
      // currentState() volta a 'off' e a UI reflete o erro.
      try { await sub.unsubscribe(); } catch (_) {}
      throw e;
    }
    return 'on';
  }

  /**
   * Desliga: cancela a subscription e remove do backend. Idempotente.
   * @returns {Promise<'off'>}
   */
  async function disable() {
    try {
      const sub = await _subscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        try { await window.Api.del('/push/subscribe', { endpoint }); } catch (_) {}
      }
    } catch (_) { /* best-effort: desligar nunca deve estourar na UI */ }
    return 'off';
  }

  window.PushOptin = { isSupported, unsupportedReason, currentState, enable, disable };
})();
