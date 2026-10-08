/* ═══════════════════════════════════════════════════════════════════════
   CORE / SESSION — gate de autenticação (boot) + logout. Compartilhado por
   js/app.js (desktop) e js/mobile/boot.js + js/mobile/more-mobile.js
   (mobile), que antes tinham cada um a própria cópia idêntica (issue #13).

   js/login.js NÃO usa este módulo: ele faz a checagem INVERSA (se já
   autenticado, redireciona pro app) com timeout/AbortController próprio —
   comportamento genuinamente diferente, não é duplicação do mesmo padrão.
═══════════════════════════════════════════════════════════════════════ */
(function () {

  /**
   * Verifica a sessão via /api/auth/me.
   * @return {Promise<boolean>} true se autenticado (ou backend indisponível
   *   — deixa o PWA abrir offline com o cache do SW); false se já
   *   redirecionou pro login.
   */
  async function ensureAuthenticated() {
    try {
      const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (resp.ok) return true;
    } catch (e) {
      // BUG-079: erro de REDE, nao de sessao. Antes a execucao caia no
      // redirect abaixo e o PWA nunca abria offline, apesar dos arquivos do
      // SHELL em cache. Deixa o app abrir com o que o SW guardou; se a sessao
      // estiver mesmo invalida, a primeira chamada do Api devolve 401 e manda
      // pro login ali.
      console.warn('[auth] backend indisponível — abrindo com o cache offline');
      return true;
    }
    window.location.replace('/login.html');
    return false;
  }

  /**
   * Encerra a sessão: limpa o cache de dados offline (dados de saúde não
   * podem sobreviver ao logout no aparelho), confirma com o servidor e só
   * então redireciona.
   */
  async function doLogout() {
    // Antes do fetch de propósito: vale mesmo se a chamada de rede falhar.
    try { await caches.delete('treino-bike-data'); } catch (_) {}
    // BUG-075: sem checar resp.ok, uma falha de rede deixava o cookie
    // tb_session VALIDO e ainda assim mandava para o login — o usuario
    // acreditava ter saido e bastava voltar para estar logado de novo. So
    // redireciona se o servidor confirmar.
    let ok = false;
    try {
      const r = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      ok = r.ok;
    } catch (e) { /* rede indisponivel */ }
    if (!ok) {
      if (window.toast) toast('Não foi possível encerrar a sessão no servidor. Tente de novo.', { kind: 'error' });
      return;
    }
    window.location.replace('/login.html');
  }

  window.Session = { ensureAuthenticated, doLogout };
})();
