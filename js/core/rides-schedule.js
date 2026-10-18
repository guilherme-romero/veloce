/* ═══════════════════════════════════════════════════════════════════════
   CORE / RIDES-SCHEDULE — seleção pura de passeios por data. Fonte única
   cliente+servidor: o sino in-app (js/notifications.js) reusa `nextRide` e o
   digest de push da véspera (server/scheduler.js, #3 F2) reusa `ridesOn`.

   Opera sobre o shape NORMALIZADO do passeio ({ id, data, horaInicio, destino,
   distancia }, camelCase) — o mesmo que rowToRide devolve em
   server/routes/rides.js e que Storage.getRides() entrega no cliente. Sem DOM,
   sem rede: roda headless em Node (tests/core-load.js), como os demais js/core.

   `data` é ISO YYYY-MM-DD e `horaInicio` é "HH:MM" (pode vir vazio). A ordem
   por horaInicio joga os sem-hora pro fim — num digest de "amanhã", um passeio
   sem horário não deve furar a fila dos que têm largada marcada.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const DAY_MS = 86400000;

  /**
   * Passeios de um dia específico, ordenados por horário de largada.
   * @param  {Array}  rides   — lista de passeios normalizados
   * @param  {string} dateISO — YYYY-MM-DD
   * @return {Array}  subconjunto de `rides` com data === dateISO
   */
  function ridesOn(rides, dateISO) {
    if (!Array.isArray(rides) || !dateISO) return [];
    // horaInicio é "HH:MM" — comparação lexicográfica de string já ordena por
    // horário. Vazio vira '99:99' pro passeio sem largada marcada ir pro fim.
    const key = r => r.horaInicio || '99:99';
    return rides
      .filter(r => r && r.data === dateISO)
      .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  /**
   * O passeio futuro mais próximo dentro de um horizonte de dias.
   * @param  {Array}  rides       — lista de passeios normalizados
   * @param  {string} todayISO    — YYYY-MM-DD de "hoje"
   * @param  {number} horizonDays — distância máxima em dias (default 2)
   * @return {Object|null} o passeio, ou null se nenhum dentro do horizonte
   */
  function nextRide(rides, todayISO, horizonDays = 2) {
    if (!Array.isArray(rides) || !todayISO) return null;
    const futuros = rides
      .filter(r => r && r.data >= todayISO)
      .sort((a, b) => (a.data < b.data ? -1 : 1));
    if (!futuros.length) return null;
    const r = futuros[0];
    const diff = Math.round(
      (new Date(r.data + 'T12:00:00') - new Date(todayISO + 'T12:00:00')) / DAY_MS
    );
    return diff > horizonDays ? null : r;
  }

  window.RidesSchedule = { ridesOn, nextRide };
})();
