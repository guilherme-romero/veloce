/* ═══════════════════════════════════════════════════════════════════════
   MOBILE BOOT — equivalente enxuto do boot() de js/app.js.

   app.js NÃO é carregado no mobile (traz renderAll, modais de perfil e o
   wire da nav desktop), mas o gate de autenticação é compartilhado via
   js/core/session.js (issue #13 — antes vinha duplicado aqui).

   A ordem importa: os dados PRECISAM estar carregados antes de qualquer
   view, senão o cache em memória está vazio e as telas aparecem sem dados e
   sem erro no console. O que muda em relação ao desktop é o ESCOPO da carga
   — ver COLECOES abaixo.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const { ensureAuthenticated } = window.Session;

  async function safe(label, fn) {
    try { return await fn(); }
    catch (e) { console.error(`[boot mobile] ${label}:`, e); }
  }

  // Coleções do CAMINHO CRÍTICO — as que a primeira tela (Início) lê, via
  // Storage.getUser() e Storage.getTrainingLog().
  //
  // As demais são carregadas sob demanda, na primeira visita à tela que as
  // usa, e não no boot:
  //   weights → js/mobile/profile-mobile.js  (Storage.load(['weights']))
  //   rides   → js/mobile/rides-mobile.js    (Storage.load(['rides']))
  // modes, workouts, home-exercises e routes não são lidas por nenhuma tela
  // mobile; bikes.js fala direto com a API.
  //
  // Ao criar uma tela nova: se ela for a primeira coisa que o usuário vê,
  // acrescente a coleção aqui; se não, carregue-a no onEnter da view, como
  // fazem Perfil e Passeios.
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
