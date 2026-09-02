/* ═══════════════════════════════════════════════════════════════════════
   CORE · ACTIVITY-STATS — agregações puras sobre a lista de atividades
   unificadas (/api/activities/unified). Sem DOM, sem Storage: só entra
   array e sai número.

   Extraído de js/home.js para ser consumido pelas DUAS UIs. O corpo das
   funções veio verbatim de lá; home.js passou a consumir daqui por alias,
   de modo que nenhuma chamada de render mudou.
═══════════════════════════════════════════════════════════════════════ */
(function () {

  // Garmin manda "YYYY-MM-DD HH:MM:SS" (espaço); Strava manda
  // "YYYY-MM-DDTHH:MM:SSZ", onde o Z é na verdade hora local. Datas sem
  // hora entram ao meio-dia para não escorregar de dia por fuso.
  function parseLocalDT(iso) {
    if (!iso) return null;
    const s = String(iso).replace(' ', 'T').replace(/Z$/, '');
    const d = new Date(s.includes('T') ? s : s + 'T12:00:00');
    return isNaN(d) ? null : d;
  }

  // Km desta semana vs. semana passada (ambas inteiras), com DOMINGO como
  // início da semana. Fonte: atividades unificadas (Garmin/Strava), que é o
  // que reflete de fato o que foi pedalado.
  function weekStatsFromActivities(items) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dow = today.getDay(); // 0 = domingo (início da semana)

    const startThis = new Date(today);     startThis.setDate(today.getDate() - dow);
    const startLast = new Date(startThis); startLast.setDate(startThis.getDate() - 7);
    const endThis   = new Date(startThis); endThis.setDate(startThis.getDate() + 7); // exclusivo

    let atual = 0, anterior = 0;
    (items || []).forEach(a => {
      if (!isFinite(a.distanciaKm)) return;
      const d = parseLocalDT(a.inicio || a.data);
      if (!d) return;
      const day = new Date(d); day.setHours(0, 0, 0, 0);
      if (day >= startThis && day < endThis)        atual    += a.distanciaKm;
      else if (day >= startLast && day < startThis) anterior += a.distanciaKm;
    });

    // Só há % quando existe base de comparação (> 0) na semana passada.
    const pct = anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;
    return { atual, pct };
  }

  // Totais de um conjunto de atividades (mesmas somas dos KPIs do desktop
  // em js/activities.js#renderHistKpis).
  function totals(items) {
    return (items || []).reduce((acc, a) => {
      acc.km    += (a.distanciaKm || 0);
      acc.segs  += (a.tempoMovS   || 0);
      acc.elev  += (a.elevacaoM   || 0);
      acc.count += 1;
      return acc;
    }, { km: 0, segs: 0, elev: 0, count: 0 });
  }

  // 12 meses (Jan–Dez), mesmo formato do bucketByCalendarMonth do desktop.
  // Com `year`, filtra o ano; sem ele, agrega todos os anos no mesmo mês.
  function monthlyVolume(items, year) {
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      const d = new Date(year || 2000, m, 1);
      buckets.push({
        key: m,
        label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        km: 0, count: 0, elev: 0,
      });
    }
    (items || []).forEach(a => {
      const d = parseLocalDT(a.inicio || a.data);
      if (!d) return;
      if (year && d.getFullYear() !== year) return;
      const b = buckets[d.getMonth()];
      if (!b) return;
      b.km    += (a.distanciaKm || 0);
      b.count += 1;
      b.elev  += (a.elevacaoM || 0);
    });
    return buckets;
  }

  /**
   * Mapa de constância: uma célula por dia, os últimos `dias` dias.
   *
   * `padStart`/`padEnd` são as células VAZIAS que o chamador deve emitir
   * antes e depois das reais para que o grid feche em semanas inteiras —
   * com 7 linhas e fluxo por coluna, cada linha vira um dia da semana
   * (dom→sáb), como no heatmap desktop. Mesmas fórmulas de js/heatmap.js:92
   * e :123. Quem renderiza em fita corrida simplesmente ignora os dois.
   *
   * Níveis por km no dia: 0 = nada, 1 = até 15, 2 = até 40, 3 = acima.
   */
  function consistencyGrid(items, dias = 60) {
    const porDia = {};
    (items || []).forEach(a => {
      const d = parseLocalDT(a.inicio || a.data);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      porDia[key] = (porDia[key] || 0) + (a.distanciaKm || 0);
    });

    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    const cells = [];
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const km = porDia[key] || 0;
      cells.push({
        date: key, km,
        lvl: km === 0 ? 0 : km <= 15 ? 1 : km <= 40 ? 2 : 3,
      });
    }
    const ativos = cells.filter(c => c.km > 0).length;

    // Alinhamento por dia da semana: quantos quadrados vazios entram antes do
    // dia mais antigo e depois de hoje para completar a primeira e a última
    // coluna do grid de 7 linhas.
    const primeiro = new Date(hoje);
    primeiro.setDate(primeiro.getDate() - (dias - 1));
    const padStart = primeiro.getDay();                    // dom=0 … sáb=6
    const padEnd   = (7 - ((padStart + dias) % 7)) % 7;

    return { cells, ativos, dias, pct: dias ? (ativos / dias) * 100 : 0, padStart, padEnd };
  }

  window.ActivityStats = {
    parseLocalDT, weekStatsFromActivities, totals, monthlyVolume, consistencyGrid,
  };
})();
