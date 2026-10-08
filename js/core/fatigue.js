/* ═══════════════════════════════════════════════════════════════════════
   CORE / FATIGUE — Índice de Fadiga (heurística deste app) e Training
   Readiness (score oficial da Garmin), compartilhados pelo desktop
   (js/insights.js) e pela aba Insights mobile (js/mobile/insights-mobile.js).

   Extraído VERBATIM de js/insights.js na v2.9.0 — pesos, cortes e
   mensagens são os mesmos; o que saiu foi a escrita no DOM.

   Como em Metrics.tsbStatus, a saída traz o NOME do token de cor
   ('green' | 'amber' | 'red' | 'muted2'), nunca um hex: --red e --amber
   divergem de propósito entre css/style.css e css/mobile.css, e devolver
   hex daqui pintaria as duas telas com a mesma cor.
═══════════════════════════════════════════════════════════════════════ */
(function () {

  /* ── Índice de Fadiga ─────────────────────────────────────────────── */

  /**
   * Combina Body Battery, HRV e stress dos últimos 7 dias num índice 0–100
   * onde MAIOR = mais fadiga. Índice heurístico do projeto, não métrica
   * clínica.
   *
   * Componente de HRV (#57): em vez de um corte fixo (ex. "queda de 25%"),
   * usa z-score contra a baseline pessoal (média/SD das 4 semanas antes da
   * semana atual, método Plews/Buchheit) — o coeficiente de variação (CV =
   * SD/média) natural de cada pessoa decide o que é "queda significativa"
   * pra ELA, não um número arbitrário igual pra todo mundo. Precisa de pelo
   * menos 14 noites de HRV na janela de baseline; com menos, cai no limiar
   * fixo antigo (usuário novo na Garmin / gap de sync).
   *
   * @param  {Array} health — /api/garmin/health, mais recente primeiro
   * @return {Object} { ok, score, status, token, msg, bb, hrv, stress, fonteCount }
   */
  function fatigueIndex(health) {
    const arr = Array.isArray(health) ? health : [];
    if (!arr.length) return { ok: false };

    const recentes  = arr.slice(0, 7);    // últimos 7 dias

    const avg = (a, key) => {
      const vals = a.map(d => d[key]).filter(v => v != null && isFinite(v));
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };

    const bbDrainAvg = avg(recentes, 'body_battery_drain');
    const bbMaxAvg   = avg(recentes, 'body_battery_max');
    const stressAvg  = avg(recentes, 'stress_avg');
    const hrvSem      = avg(recentes, 'hrv_noite_avg');
    // Baseline pessoal (#57, método Plews/Buchheit): janela de 4 semanas
    // ANTES da semana atual, não só a semana anterior — um único dia ruim
    // na "semana anterior" não deveria inflar/desinflar o desvio-padrão da
    // baseline. Precisa de pelo menos 14 noites válidas nessa janela; com
    // menos, a SD não é confiável e cai no fallback de limiar fixo abaixo.
    const baselineVals = arr.slice(7, 35)
      .map(d => d.hrv_noite_avg).filter(v => v != null && isFinite(v));
    const hasBaseline = baselineVals.length >= 14;
    const hrvBaselineMean = hasBaseline
      ? baselineVals.reduce((s, v) => s + v, 0) / baselineVals.length : null;
    const hrvBaselineSD = hasBaseline
      ? Math.sqrt(baselineVals.reduce((s, v) => s + (v - hrvBaselineMean) ** 2, 0) / baselineVals.length)
      : null;

    if (bbDrainAvg == null || stressAvg == null) return { ok: false };

    // Componentes normalizados em 0-100 (maior = mais fadiga). Uma fonte
    // ausente entra neutra (50) em vez de derrubar o índice.
    const hasBBI    = bbMaxAvg != null && bbDrainAvg != null;
    const hasStress = stressAvg != null;
    const hasHRV    = hrvSem != null && (hasBaseline ? hrvBaselineSD > 0 : arr.slice(7, 14).some(d => d.hrv_noite_avg != null));
    const bbiScore    = hasBBI    ? Math.min(100, (bbDrainAvg / Math.max(bbMaxAvg, 1)) * 100) : 50;
    const stressScore = hasStress ? Math.min(100, stressAvg * 1.5) : 50;  // stress 50 → 75
    let hrvScore = 50;
    let hrvRef = null;   // valor de referência pra exibir o delta (baseline ou semana anterior)
    if (hasHRV && hasBaseline && hrvBaselineSD > 0) {
      // Z-score relativo à variação natural do próprio usuário (CV = SD/média
      // da baseline) em vez de um corte fixo de "queda de 25%" — alguém com
      // HRV naturalmente instável (CV alto) não deveria disparar fadiga a
      // cada flutuação normal; alguém muito estável (CV baixo) não deveria
      // escapar de uma queda pequena mas estatisticamente significativa.
      const hrvZ = (hrvSem - hrvBaselineMean) / hrvBaselineSD;   // negativo = abaixo da baseline = fadiga
      hrvScore = Math.max(0, Math.min(100, 50 - hrvZ * 25));     // -2 SD → 100, 0 → 50, +2 SD → 0
      hrvRef = hrvBaselineMean;
    } else if (hasHRV) {
      // Fallback: menos de 14 noites de baseline válidas (usuário novo na
      // Garmin, ou gap longo de sync) — mantém o limiar fixo de queda de
      // 25% como antes, só até acumular histórico suficiente.
      const hrvSemAntFallback = avg(arr.slice(7, 14), 'hrv_noite_avg');
      if (hrvSemAntFallback) {
        const delta = (hrvSemAntFallback - hrvSem) / hrvSemAntFallback;
        hrvScore = Math.max(0, Math.min(100, 50 + delta * 200));
        hrvRef = hrvSemAntFallback;
      }
    }

    const score      = Math.round(bbiScore * 0.40 + hrvScore * 0.35 + stressScore * 0.25);
    const fonteCount = [hasBBI, hasStress, hasHRV].filter(Boolean).length;

    let status, token, msg;
    if (score < 45)      { status = 'Recuperado'; token = 'green'; msg = 'Recuperação ótima — sessão intensa recomendada.'; }
    else if (score < 65) { status = 'Moderado';   token = 'amber'; msg = 'Carga acumulando — treino normal ok, evite muito volume.'; }
    else                 { status = 'Fadigado';   token = 'red';   msg = 'Sinais de fadiga — descanso ou atividade leve hoje.'; }

    return {
      ok: true, score, status, token, fonteCount,
      msg: fonteCount < 3 ? `${msg} (índice baseado em ${fonteCount}/3 fontes Garmin)` : msg,
      bb:     hasBBI    ? `${Math.round(bbDrainAvg)} / ${Math.round(bbMaxAvg)}` : '—',
      hrv:    hasHRV    ? `${Math.round(hrvSem)} ms` + (hrvRef ? ` (${hrvSem > hrvRef ? '+' : ''}${Math.round(hrvSem - hrvRef)})` : '') : '—',
      stress: hasStress ? `${Math.round(stressAvg)}` : '—',
    };
  }

  /* ── Training Readiness (Garmin) ──────────────────────────────────── */

  // Níveis da Garmin: POOR < LOW < MODERATE < HIGH < (VERY_HIGH/PRIME).
  const READINESS_INFO = {
    VERY_HIGH: { label: 'Máxima',      token: 'green', msg: 'Prontidão máxima — ótimo dia para sua sessão mais forte.' },
    PRIME:     { label: 'Máxima',      token: 'green', msg: 'Prontidão máxima — ótimo dia para sua sessão mais forte.' },
    HIGH:      { label: 'Alta',        token: 'green', msg: 'Garmin diz: pronto para sessão intensa hoje.' },
    MODERATE:  { label: 'Moderada',    token: 'amber', msg: 'Recuperação moderada — treino normal ok.' },
    LOW:       { label: 'Baixa',       token: 'red',   msg: 'Baixa prontidão — priorize recuperação hoje.' },
    POOR:      { label: 'Muito baixa', token: 'red',   msg: 'Prontidão muito baixa — dia de descanso, evite treino intenso.' },
  };

  /**
   * @param  {Array} items — /api/garmin/training-readiness (qualquer ordem)
   * @return {Object} { ok, score, label, token, msg, sleep, recoveryH, hrv, serie }
   *                  `serie` vem em ordem cronológica, para a sparkline.
   */
  function readiness(items) {
    if (!Array.isArray(items) || items.length === 0) return { ok: false };

    const ordered = [...items].sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const latest  = ordered[ordered.length - 1];
    const level   = latest.level || '—';
    const info    = READINESS_INFO[level] || { label: level, token: 'muted2', msg: '' };

    return {
      ok: true,
      score: latest.score ?? null,
      label: info.label,
      token: info.token,
      msg: info.msg,
      sleep: latest.sleep_score != null ? String(latest.sleep_score) : '—',
      // `recovery_time_min` guarda MINUTOS (Garmin `recoveryTime`); /60 → horas.
      recoveryH: latest.recovery_time_min != null ? `${Math.round(latest.recovery_time_min / 60)}h` : '—',
      hrv: latest.hrv_weekly_avg != null ? `${latest.hrv_weekly_avg} ms` : '—',
      serie: ordered.map(r => ({ data: r.data, score: r.score })),
    };
  }

  window.Fatigue = { fatigueIndex, readiness, READINESS_INFO };
})();
