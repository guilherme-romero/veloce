/* ═══════════════════════════════════════════════════════════════════════
   CORE / UNIFIED-ACTIVITIES — cache compartilhado de GET /activities/unified
   por janela (parâmetro `days`), usado por desktop e mobile.

   Antes desta issue (#52), cada um dos ~15 call sites (js/*.js e
   js/mobile/*.js) chamava `Api.get('/activities/unified?days=N')` direto,
   sem cache: múltiplas telas pedindo a MESMA janela (365 é a mais comum —
   5 chamadores) refaziam o SELECT + sort completo no backend a cada troca
   de aba/página. TTL de 5 min (mesmo valor de MShell.TTL_DADOS no mobile) —
   o sync automático roda a cada 30 min (server/scheduler.js), então 5 min
   cobre 100% das trocas de tela de uma sessão sem servir dado muito velho.

   Cache por valor EXATO de `days` (sem reuso cross-window): janelas
   diferentes (30 vs 365) não derivam uma da outra sem reimplementar o
   filtro de data no cliente — a issue original já apontava isso como fora
   do escopo "baixo/médio esforço". Cobre o caso real (mesma janela, várias
   telas) sem essa complexidade.

   Invalidação: chamada explícita após qualquer sync que possa trazer
   atividade nova — Strava manual (js/strava.js), Garmin manual
   (js/garmin.js), sync combinado do botão único da Home mobile
   (js/mobile/home-mobile.js — chama os endpoints direto, não passa por
   strava.js/garmin.js, que não são carregados no mobile) — e após excluir
   uma atividade importada (js/home.js, único DELETE /activities/:fonte/:id
   do frontend). js/rides.js é só leitura (calendário), não precisa
   invalidar. Sync automático do scheduler (server-side, a cada 30 min) não
   tem como invalidar o cache do cliente — o TTL de 5 min já limita essa
   janela de dado desatualizado, mesmo comportamento que o mobile já tinha
   antes desta issue.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const TTL_MS = 5 * 60 * 1000;
  const _cache = new Map();   // days -> { p: Promise, ts: number }

  /**
   * @param  {number} days
   * @return {Promise<{items: Array}>} mesmo shape de Api.get('/activities/unified?days=N')
   */
  async function get(days) {
    const hit = _cache.get(days);
    if (hit && (Date.now() - hit.ts) < TTL_MS) return hit.p;
    const p = window.Api.get(`/activities/unified?days=${days}`);
    _cache.set(days, { p, ts: Date.now() });
    try {
      return await p;
    } catch (e) {
      _cache.delete(days);   // erro não fica cacheado
      throw e;
    }
  }

  /** Chamar após qualquer sync/CRUD que possa alterar o conjunto de atividades. */
  function invalidate() {
    _cache.clear();
  }

  window.UnifiedActivities = { get, invalidate };
})();
