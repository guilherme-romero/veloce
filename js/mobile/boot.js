/* ═══════════════════════════════════════════════════════════════════════
   MOBILE BOOT — equivalente enxuto do boot() de js/app.js.

   app.js NÃO é carregado no mobile (traz renderAll, modais de perfil e o
   wire da nav desktop), então o gate de autenticação vem duplicado aqui —
   10 linhas, cópia fiel de ensureAuthenticated() em js/app.js:468. Extrair
   para js/core/ só se aparecer um terceiro consumidor.

   A ordem importa: os dados PRECISAM estar carregados antes de qualquer
   view, senão o cache em memória está vazio e as telas aparecem sem dados e
   sem erro no console. O que muda em relação ao desktop é o ESCOPO da carga
   — ver COLECOES abaixo.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  async function ensureAuthenticated() {
    try {
      const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (resp.ok) return true;
    } catch (e) {
      console.warn('[auth] backend indisponível, redirecionando para login');
    }
    location.replace('/login.html');
    return false;
  }

  async function safe(label, fn) {
    try { return await fn(); }
    catch (e) { console.error(`[boot mobile] ${label}:`, e); }
  }

  // As telas mobile leem exatamente estas duas coleções, via Storage.getUser()
  // e Storage.getTrainingLog(). As outras seis que loadAll() busca — modes,
  // workouts, weights, rides, home-exercises e routes — não são lidas por
  // nenhuma delas, e bikes.js fala direto com a API. Buscá-las custaria
  // caminho crítico de boot por dado que ninguém consome.
  // Ao criar uma tela que use outro getter do Storage, acrescente a coleção
  // correspondente aqui.
  const COLECOES = ['profile', 'training-log'];

  async function boot() {
    console.log(`%c[VELOCE LABS · mobile] Boot v${window.APP_VERSION || '?'}`,
                'color:#c6f135;font-weight:bold');

    // Auth e dados em paralelo: sem sessão as duas chamadas de dados voltam
    // 401 e o wrapper Api já manda para o login — mesmo destino do gate, com
    // uma ida-e-volta a menos no caminho feliz.
    const [autenticado] = await Promise.all([
      ensureAuthenticated(),
      safe('Carga inicial (Storage.load)', () => Storage.load(COLECOES)),
    ]);
    if (!autenticado) return;

    // Bind do botão da lista vazia (o do header é feito por bikes-mobile.js).
    await safe('Bikes.init', () => window.Bikes && Bikes.init());

    // Só depois de haver dados as views entram no ar.
    await safe('Router', () => MRouter.init());

    // O service worker não precisa de chamada: js/pwa.js é uma IIFE que se
    // registra sozinha no evento 'load'.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
