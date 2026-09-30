/* ═══════════════════════════════════════════════════════════════════════
   CORE / SUGGESTION HISTORY — Cruzamento sugestão×execução (evolução da
   seção Desempenho; design em GLOSSARY.md, termo "Cruzamento sugestão×
   execução"). Recalcula retroativamente, pra cada dia dos últimos N dias,
   se a categoria recuperação teria sido sugerida naquele dia, e compara
   com o TSS real do dia — só recuperação tem veredito (ADR do desenho:
   volume/zona-alvo não entram nesta primeira versão).

   Sem persistência: reaproveita window.Fatigue.fatigueIndex e
   window.Metrics.tssDeAtividade, ambas puras, sem "hoje" hardcoded — só
   fatiamos os arrays de entrada pra cada dia D, nenhuma das duas precisa
   ser alterada.
═══════════════════════════════════════════════════════════════════════ */
(function () {

  // Data LOCAL (não UTC) — mesmo padrão de js/utils.js:74. new Date().toISOString()
  // usa UTC e deslocaria a janela em 1 dia à noite para fuso -03:00, dessincronizando
  // do "hoje" usado para gravar activities/health (ambos em fuso local).
  function paraISO(d) {
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function hojeISO() {
    return paraISO(new Date());
  }

  function subDias(isoBase, n) {
    const d = new Date(isoBase + 'T12:00:00');
    d.setDate(d.getDate() - n);
    return paraISO(d);
  }

  function listaDias(days) {
    const hoje = hojeISO();
    const out = [];
    for (let i = days - 1; i >= 0; i--) out.push(subDias(hoje, i));
    return out;
  }

  function mediana(valores) {
    if (!valores.length) return 0;
    const ord = [...valores].sort((a, b) => a - b);
    const meio = Math.floor(ord.length / 2);
    return ord.length % 2 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
  }

  /**
   * @param  {Object} params
   * @param  {Array}  params.activities — /activities/unified (.items), qualquer ordem
   * @param  {Array}  params.health     — /garmin/health, MAIS RECENTE PRIMEIRO
   * @param  {number} params.fcMax      — Metrics.calcFCMax(user)
   * @param  {number} [params.days=90]  — janela de análise
   * @param  {number} [params.limiarTss] — Limiar calibrado (Fase 2, IDEIA-1+2:
   *                                       GET /garmin/calibration), opcional —
   *                                       sem ele, calcula a mediana inline
   *                                       (mesmo cálculo, só não centralizado).
   * @return {Object} { ok:false } | { ok:true, seguiu, total, percentual, janelaDias }
   */
  function analyze({ activities, health, fcMax, days = 90, limiarTss }) {
    const acts   = Array.isArray(activities) ? activities : [];
    const healthArr = Array.isArray(health) ? health : [];
    if (!healthArr.length || !fcMax) return { ok: false };

    const tssPorDia = {};
    acts.forEach(a => {
      if (!a.data) return;
      const tss = window.Metrics.tssDeAtividade(a, fcMax);
      if (tss > 0) tssPorDia[a.data] = (tssPorDia[a.data] || 0) + tss;
    });

    const dias = listaDias(days);
    const limiar = limiarTss ?? mediana(dias.map(d => tssPorDia[d] || 0));

    let total = 0;
    let seguiu = 0;
    for (const d of dias) {
      const healthAteD = healthArr.filter(h => h.data <= d);
      if (!healthAteD.length) continue;
      const fadiga = window.Fatigue.fatigueIndex(healthAteD);
      // token (não status) — desacopla de mudança de texto em fatigue.js.
      if (!fadiga.ok || fadiga.token !== 'red') continue;

      total++;
      if ((tssPorDia[d] || 0) <= limiar) seguiu++;
    }

    if (total === 0) return { ok: false };

    return {
      ok: true, seguiu, total,
      percentual: Math.round((seguiu / total) * 100),
      janelaDias: days,
    };
  }

  window.SuggestionHistory = { analyze };
})();
