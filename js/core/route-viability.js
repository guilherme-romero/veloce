/* ═══════════════════════════════════════════════════════════════════════
   CORE / ROUTE-VIABILITY — avalia se uma rota (GPX) é concluível vs o
   histórico pessoal de pedais (Issue #2 / IDEIA-3). Determinístico e puro:
   nenhuma IA, nenhum I/O. Quem chama injeta a função de tempo (`estimateTime`,
   normalmente window.Utils.estimateRideTimeMin) pra não duplicar o modelo de
   tempo nem divergir dele — e pra o motor rodar headless nos testes.

   Modelo (grilling 2026-10-12):
   - velocidade-base pessoal = mediana da velocidade média das saídas da janela;
     injetada no estimateTime (a penalidade de subida embutida cuida da elevação,
     sem contar elevação em dobro).
   - classificação pela DURAÇÃO prevista vs a distribuição das durações reais:
     viável ≤ p75 · limítrofe entre p75 e o máximo · além do histórico acima do
     máximo. Trava de elevação: se o desnível+ da rota passar do máximo recente,
     sobe o tier independentemente da duração ("um paredão é um paredão").
   - esforço qualitativo derivado do tier + duração.
   - estado honesto (anti-#94): < minRides saídas comparáveis → { ok:false, insuf:true }.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const DAY = 86400000;

  // Percentil por interpolação linear sobre array JÁ ORDENADO ascendente.
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const rank = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  }

  /**
   * @param {Object} opts
   * @param {number} opts.distKm        — distância da rota (km)
   * @param {number} opts.desnivelPos   — ganho de elevação da rota (m)
   * @param {Array}  opts.activities    — itens do UnifiedActivities (distanciaKm, tempoMovS, elevacaoM, data)
   * @param {Function} opts.estimateTime — ({dist,speed,elev}) => { movTimeMin, ... }
   * @param {number} [opts.windowDays=180] — janela de referência (6 meses)
   * @param {number} [opts.minRides=3]     — mínimo de saídas comparáveis
   * @return {{ok:boolean, insuf?:boolean, baseN:number, tier?:string,
   *           tempoMin?:number, baseSpeed?:number, esforco?:string,
   *           recordeKm?:number, recordeElev?:number}}
   */
  function analyze(opts) {
    const { distKm, desnivelPos = 0, activities = [], estimateTime,
            windowDays = 180, minRides = 3 } = opts || {};
    if (!distKm || distKm <= 0 || typeof estimateTime !== 'function') {
      return { ok: false, insuf: true, baseN: 0 };
    }

    const cut = Date.now() - windowDays * DAY;
    const rides = (activities || []).filter(a =>
      a && a.distanciaKm > 0 && a.tempoMovS > 0 &&
      new Date(String(a.data) + 'T12:00:00').getTime() >= cut);
    if (rides.length < minRides) return { ok: false, insuf: true, baseN: rides.length };

    // Velocidade-base pessoal (km/h): mediana da velocidade média das saídas.
    const speeds = rides
      .map(r => r.distanciaKm / (r.tempoMovS / 3600))
      .filter(v => isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    const baseSpeed = percentile(speeds, 50);

    const est = estimateTime({ dist: distKm, speed: baseSpeed, elev: desnivelPos });
    const tempoMin = (est && est.movTimeMin) || 0;

    // Distribuição das durações reais (min).
    const durs = rides.map(r => r.tempoMovS / 60).sort((a, b) => a - b);
    const p50 = percentile(durs, 50);
    const p75 = percentile(durs, 75);
    const maxDur  = durs[durs.length - 1];
    const maxElev = rides.reduce((m, r) => Math.max(m, r.elevacaoM || 0), 0);
    const maxDist = rides.reduce((m, r) => Math.max(m, r.distanciaKm || 0), 0);

    let tier = tempoMin <= p75 ? 'viavel' : tempoMin <= maxDur ? 'limitrofe' : 'alem';
    // Trava de elevação: desnível acima do máximo recente sobe o tier.
    if (desnivelPos > maxElev) tier = tier === 'viavel' ? 'limitrofe' : 'alem';

    const esforco = tier === 'alem' ? 'muito pesado'
      : tier === 'limitrofe' ? 'pesado'
      : tempoMin <= p50 ? 'leve' : 'moderado';

    return {
      ok: true, tier, tempoMin: Math.round(tempoMin), baseSpeed: +baseSpeed.toFixed(1),
      esforco, baseN: rides.length, recordeKm: +maxDist.toFixed(1), recordeElev: Math.round(maxElev),
    };
  }

  window.RouteViability = { analyze, percentile };
})();
