/* ═══════════════════════════════════════════════════════════════════════
   CORE · METRICS — fisiologia e carga de treino: FCmax, TRIMP, TSS, EMA e
   o trio CTL/ATL/TSB. Funções puras, sem DOM, sem Storage.

   Extraídas VERBATIM de js/insights.js quando a UI mobile passou a precisar
   dos mesmos números. insights.js continua com todo o seu render e apenas
   consome estas funções por alias — nenhuma das suas chamadas mudou.

   Regra importante: tsbStatus() devolve o NOME do token de cor, nunca o hex.
   O desktop (css/style.css) e o mobile (css/mobile.css) divergem em --red e
   --yellow de propósito; devolver hex daqui mudaria a cor do desktop.
═══════════════════════════════════════════════════════════════════════ */
(function () {

  // TRIMP simplificado: duração (min) × fator de intensidade², onde
  // intensidade = FC média ÷ FC máxima teórica. É uma aproximação quadrática
  // para comparação relativa entre semanas — não é a exponencial de Banister
  // nem a zonal de Edwards, e não usa a reserva de FC de Karvonen.
  // Sem FC média, estima a intensidade pela DURAÇÃO do esforço (a modalidade em
  // act.tipo — cycling/gravel/mtb — não informa intensidade). Pedais curtos
  // tendem a ser mais intensos; longos, mais leves. Faixas conservadoras
  // ancoradas no antigo padrão fixo de 0,70 (≈ Z2), validadas pelo personal-trainer:
  //   < 45 min → 0,75   ·   > 3 h → 0,65   ·   demais → 0,70
  const INTENSITY_FALLBACK = 0.70;

  // ── Helpers de cálculo ──────────────────────────────────────────
  function calcFCMax(user) {
    if (user.fcMax) return user.fcMax;
    if (!user.dataNascimento) return null;
    // Mesma idade ano-mês-dia do Perfil (BUG-052) — evita divergir ±1 bpm perto
    // de aniversários por causa do cálculo em 365,25 dias.
    const anos = _age(user.dataNascimento);
    return anos ? Math.round(220 - anos) : null;
  }

  function intensityFallback(act) {
    const min = (act && act.tempoMovS) ? act.tempoMovS / 60 : 0;
    if (min > 0 && min < 45)  return 0.75;
    if (min > 180)            return 0.65;
    return INTENSITY_FALLBACK;
  }

  function trimpDeAtividade(act, fcMax) {
    if (!act || !fcMax || !act.tempoMovS) return 0;
    const tempoMin = act.tempoMovS / 60;
    let intensity  = intensityFallback(act);
    if (act.fcMedia) {
      const raw = act.fcMedia / fcMax;
      if (raw > 1.0) console.warn(`[TRIMP] FC média (${act.fcMedia}) > FCMax (${fcMax}) em ${act.data}`);
      intensity = Math.min(raw, 1.0);
    }
    return tempoMin * intensity * intensity;
  }

  // TSS normalizado (1h em Z4 ≈ 100). Usa TRIMP como base.
  function tssDeAtividade(act, fcMax) {
    if (!act || !fcMax || !act.tempoMovS) return 0;
    const tempoH = act.tempoMovS / 3600;
    let intensity = intensityFallback(act);
    if (act.fcMedia) {
      const raw = act.fcMedia / fcMax;
      if (raw > 1.0) console.warn(`[TSS] FC média (${act.fcMedia}) > FCMax (${fcMax}) em ${act.data}`);
      intensity = Math.min(raw, 1.0);
    }
    // Aproximação: TSS = tempo_h × intensity² × 100 (1h em ~88% FCM ≈ 77 TSS)
    return tempoH * intensity * intensity * 100;
  }

  // ───────────────────────────────────────────────────────────────
  // 7.4 — TSS / ATL / CTL / TSB
  // ───────────────────────────────────────────────────────────────
  // Fonte única de CTL/ATL/TSB — usada pelo card 7.4 e pelo banner do topo,
  // garantindo que os dois exibam exatamente os mesmos números. Série diária de
  // 60 dias (mais antigo → recente); EMA de 42d (crônica) e 7d (aguda).
  function calcTSBMetrics(activities, fcMax) {
    if (!activities.length || !fcMax) return { ctl: 0, atl: 0, tsb: 0, ctlSerie: [], atlSerie: [] };
    const tssDia = {};
    activities.forEach(a => {
      const tss = tssDeAtividade(a, fcMax);
      if (tss > 0) tssDia[a.data] = (tssDia[a.data] || 0) + tss;
    });
    const serie = [];
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    for (let i = 59; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(d.getDate() - i);
      serie.push(tssDia[d.toISOString().slice(0, 10)] || 0);
    }
    const ctlSerie = emaSeries(serie, 42);
    const atlSerie = emaSeries(serie, 7);
    const ctl = ctlSerie[ctlSerie.length - 1] || 0;
    const atl = atlSerie[atlSerie.length - 1] || 0;
    return { ctl, atl, tsb: ctl - atl, ctlSerie, atlSerie };
  }

  // Média móvel simples de N pontos (ignora nulos na janela)
  function _movingAvg(arr, n) {
    return arr.map((_, i) => {
      const win = arr.slice(Math.max(0, i - n + 1), i + 1).filter(v => v != null && isFinite(v));
      return win.length ? +(win.reduce((s, v) => s + v, 0) / win.length).toFixed(1) : null;
    });
  }

  function _age(iso) {
    if (window.Profile && Profile.calcAge) return Profile.calcAge(iso);
    if (!iso) return 0;
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date();
    let a = t.getFullYear() - y;
    if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) a--;
    return a > 0 ? a : 0;
  }

  // ───────────────────────────────────────────────────────────────
  // TOPO Hi-Vis — banner + KPIs + carga×fadiga×forma + zona + recomendações
  // ───────────────────────────────────────────────────────────────
  // EMA com warm-up a partir de 0 (carga zero antes da janela): evita que o
  // primeiro dia infle CTL/ATL no início do histórico (converge após ~tau dias).
  // Única implementação de EMA do módulo — usada por calcTSBMetrics (card + banner).
  function emaSeries(serie, tau) {
    const out = [];
    let ema = 0;
    for (let i = 0; i < serie.length; i++) { ema = ema + (serie[i] - ema) / tau; out.push(ema); }
    return out;
  }

  // Classificação do TSB. Extraída do if-chain de renderTSS (insights.js) —
  // mesmos cortes, mesmas mensagens; o que muda é devolver token em vez de
  // hex, para que cada UI resolva a cor com as próprias variáveis CSS.
  function tsbStatus(tsb) {
    if (tsb > 10)   return { status: 'Fresco',     token: 'green', msg: 'TSB positivo — momento ideal para sessão intensa ou prova.' };
    if (tsb > -5)   return { status: 'Ótimo',      token: 'teal',  msg: 'Em equilíbrio — pode manter o ritmo de treino atual.' };
    if (tsb > -20)  return { status: 'Carregado',  token: 'amber', msg: 'Carga acumulada — bom estímulo, monitore sinais de cansaço.' };
    return            { status: 'Sobrecarga', token: 'red',   msg: 'Risco de overreaching — reduza volume nos próximos dias.' };
  }

  window.Metrics = {
    age: _age,
    calcFCMax,
    intensityFallback,
    trimpDeAtividade,
    tssDeAtividade,
    emaSeries,
    movingAvg: _movingAvg,
    calcTSBMetrics,
    tsbStatus,
  };
})();
