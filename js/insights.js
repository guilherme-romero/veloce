/* ═══════════════════════════════════════════════════════════════════════
   INSIGHTS — análises derivadas dos dados Garmin Connect (Fase 7)

   Relatórios implementados:
     7.1 Índice de Fadiga      (BBI drain + HRV trend + Stress)
     7.2 Sono × Desempenho     (sono_deep vs FC média da ride seguinte)
     7.3 Intensidade/kg semanal (TRIMP/peso, 12 semanas — fallback de watts/kg)
     7.4 TSS / ATL / CTL / TSB  (carga aguda vs crônica)
     7.5 Custo metabólico       (kcal/km, baseline 30 dias)
     7.6 HRV × Carga de treino  (correlação visual)

   Convenções:
     - Todos os cálculos client-side, dados via Storage.* e /api/garmin/health
     - TRIMP simplificado: tempo_min × (fc_media / fc_max)²
     - TSS ≈ TRIMP normalizado em escala de 100 (~1h em limiar = 100 TSS)
     - ATL = média exponencial 7d, CTL = média exponencial 42d
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  // ── Estado dos gráficos ─────────────────────────────────────────
  const _charts = { trimp: null, sleep: null, custo: null, hrvLoad: null, insLoad: null, insZone: null };

  // ── Helpers de cor (usa FC_ZONES quando aplicável) ──────────────
  const COLORS = {
    teal:   '#c6f135',
    amber:  '#f5d523',
    red:    '#f0523a',
    green:  '#22c55e',
    blue:   '#4e9ef5',
    muted:  '#6b7280',
    muted2: '#9299a8',
    border: '#252830',
  };

  // Tooltip flutuante padrão (mesma "mini legenda" do HISTÓRICO): ao passar o
  // mouse sobre qualquer ponto da coluna, mostra todos os valores daquele x.
  const HOVER = { mode: 'index', intersect: false };
  const TOOLTIP_STYLE = {
    backgroundColor: 'rgba(19,21,26,0.95)',
    borderColor: COLORS.border,
    borderWidth: 1,
    titleColor: '#e6e8ec',
    bodyColor: '#c4c9d4',
    padding: 10,
    cornerRadius: 8,
    usePointStyle: true,
    boxWidth: 8,
    boxHeight: 8,
    boxPadding: 4,
  };

  // ── Helpers de cálculo ──────────────────────────────────────────
  function calcFCMax(user) {
    if (user.fcMax) return user.fcMax;
    if (!user.dataNascimento) return null;
    const anos = (Date.now() - new Date(user.dataNascimento).getTime()) / (365.25 * 86400_000);
    return Math.round(220 - anos);
  }

  // TRIMP simplificado: duração (min) × fator de intensidade², onde
  // intensidade = FC média ÷ FC máxima teórica. É uma aproximação quadrática
  // para comparação relativa entre semanas — não é a exponencial de Banister
  // nem a zonal de Edwards, e não usa a reserva de FC de Karvonen.
  // Sem FC média, usa 0,70 (≈ Zona 2) como estimativa conservadora.
  const INTENSITY_FALLBACK = 0.70;

  function trimpDeAtividade(act, fcMax) {
    if (!act || !fcMax || !act.tempoMovS) return 0;
    const tempoMin = act.tempoMovS / 60;
    let intensity  = INTENSITY_FALLBACK;
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
    let intensity = INTENSITY_FALLBACK;
    if (act.fcMedia) {
      const raw = act.fcMedia / fcMax;
      if (raw > 1.0) console.warn(`[TSS] FC média (${act.fcMedia}) > FCMax (${fcMax}) em ${act.data}`);
      intensity = Math.min(raw, 1.0);
    }
    // Aproximação: TSS = tempo_h × intensity² × 100 (1h em ~88% FCM ≈ 77 TSS)
    return tempoH * intensity * intensity * 100;
  }

  // Média exponencial decaída: TC(hoje) = TC(ontem) + (TSS - TC(ontem)) / tau
  function calcEMA(serieDiaria, tau) {
    if (!serieDiaria.length) return 0;
    let ema = serieDiaria[0];
    for (let i = 1; i < serieDiaria.length; i++) {
      ema = ema + (serieDiaria[i] - ema) / tau;
    }
    return ema;
  }

  function fmtDate(iso) {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); }
    catch { return iso; }
  }

  // ───────────────────────────────────────────────────────────────
  // 7.1 — ÍNDICE DE FADIGA
  // ───────────────────────────────────────────────────────────────
  function renderFadiga(health) {
    if (!health.length) return false;
    const recentes = health.slice(0, 7);   // últimos 7 dias
    const semanaAnt = health.slice(7, 14); // semana anterior

    const avg = (arr, key) => {
      const vals = arr.map(d => d[key]).filter(v => v != null && isFinite(v));
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };

    const bbDrainAvg = avg(recentes, 'body_battery_drain');
    const bbMaxAvg   = avg(recentes, 'body_battery_max');
    const stressAvg  = avg(recentes, 'stress_avg');
    const hrvSem     = avg(recentes, 'hrv_noite_avg');
    const hrvSemAnt  = avg(semanaAnt, 'hrv_noite_avg');

    if (bbDrainAvg == null || stressAvg == null) return false;

    // Componentes normalizados em 0-100 (maior = mais fadiga)
    const hasBBI    = bbMaxAvg != null && bbDrainAvg != null;
    const hasStress = stressAvg != null;
    const hasHRV    = !!(hrvSem && hrvSemAnt);
    const bbiScore    = hasBBI    ? Math.min(100, (bbDrainAvg / Math.max(bbMaxAvg, 1)) * 100) : 50;
    const stressScore = hasStress ? Math.min(100, stressAvg * 1.5) : 50; // stress 50 → 75 no score
    let hrvScore = 50;
    if (hasHRV) {
      const delta = (hrvSemAnt - hrvSem) / hrvSemAnt; // positivo = HRV caindo = fadiga subindo
      hrvScore = Math.max(0, Math.min(100, 50 + delta * 200));
    }

    const fadiga     = Math.round(bbiScore * 0.40 + hrvScore * 0.35 + stressScore * 0.25);
    const fonteCount = [hasBBI, hasStress, hasHRV].filter(Boolean).length;

    let status, color, msg;
    if (fadiga < 45)      { status = 'Recuperado';  color = COLORS.green; msg = 'Recuperação ótima — sessão intensa recomendada.'; }
    else if (fadiga < 65) { status = 'Moderado';    color = COLORS.amber; msg = 'Carga acumulando — treino normal ok, evite muito volume.'; }
    else                  { status = 'Fadigado';    color = COLORS.red;   msg = 'Sinais de fadiga — descanso ou atividade leve hoje.'; }

    $('fadiga-score').textContent = fadiga;
    $('fadiga-status').textContent = status;
    $('fadiga-status').style.background = color + '20';
    $('fadiga-status').style.color = color;
    $('fadiga-fill').style.width = fadiga + '%';
    $('fadiga-fill').style.background = color;
    $('fadiga-bb').textContent     = hasBBI    ? `${Math.round(bbDrainAvg)} / ${Math.round(bbMaxAvg)}` : '—';
    $('fadiga-hrv').textContent    = hasHRV    ? `${Math.round(hrvSem)} ms` + (hrvSemAnt ? ` (${hrvSem > hrvSemAnt ? '+' : ''}${Math.round(hrvSem - hrvSemAnt)})` : '') : '—';
    $('fadiga-stress').textContent = hasStress ? `${Math.round(stressAvg)}` : '—';
    $('fadiga-msg').textContent    = fonteCount < 3
      ? `${msg} (índice baseado em ${fonteCount}/3 fontes Garmin)`
      : msg;
    return true;
  }

  // ───────────────────────────────────────────────────────────────
  // 7.4 — TSS / ATL / CTL / TSB
  // ───────────────────────────────────────────────────────────────
  function renderTSS(activities, fcMax) {
    if (!activities.length || !fcMax) return false;

    // Agrupa TSS por dia (últimos 60 dias) — preenche dias sem atividade com 0
    const tssDia = {};
    activities.forEach(a => {
      const tss = tssDeAtividade(a, fcMax);
      if (tss > 0) tssDia[a.data] = (tssDia[a.data] || 0) + tss;
    });

    // Série diária 60 dias (mais antigo → mais recente)
    const serie = [];
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    for (let i = 59; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      serie.push(tssDia[iso] || 0);
    }

    const ctl = calcEMA(serie, 42); // crônica
    const atl = calcEMA(serie, 7);  // aguda
    const tsb = ctl - atl;

    let status, color, msg;
    if (tsb > 10)       { status = 'Fresco';     color = COLORS.green; msg = 'TSB positivo — momento ideal para sessão intensa ou prova.'; }
    else if (tsb > -5)  { status = 'Ótimo';      color = COLORS.teal;  msg = 'Em equilíbrio — pode manter o ritmo de treino atual.'; }
    else if (tsb > -20) { status = 'Carregado';  color = COLORS.amber; msg = 'Carga acumulada — bom estímulo, monitore sinais de cansaço.'; }
    else                { status = 'Sobrecarga'; color = COLORS.red;   msg = 'Risco de overreaching — reduza volume nos próximos dias.'; }

    $('tsb-value').textContent  = tsb.toFixed(0);
    $('tsb-value').style.color  = color;
    $('tss-status').textContent = status;
    $('tss-status').style.background = color + '20';
    $('tss-status').style.color = color;
    $('ctl-value').textContent  = ctl.toFixed(1);
    $('atl-value').textContent  = atl.toFixed(1);
    $('tss-msg').textContent    = msg;
    return true;
  }

  // ───────────────────────────────────────────────────────────────
  // 7.3 — INTENSIDADE/KG SEMANAL (TRIMP/peso)
  // ───────────────────────────────────────────────────────────────
  function renderTrimpSemanal(activities, weights, fcMax) {
    if (!activities.length || !fcMax) return false;

    // Peso por dia (último valor antes ou no dia da atividade)
    const weightsOrd = weights.filter(w => w.tipo === 'atual')
                              .sort((a, b) => a.data.localeCompare(b.data));
    const pesoDoDia = (data) => {
      const aplicaveis = weightsOrd.filter(w => w.data <= data);
      if (!aplicaveis.length) return null;
      const w = aplicaveis[aplicaveis.length - 1];
      const days = Math.round((new Date(data + 'T12:00:00') - new Date(w.data + 'T12:00:00')) / 86400000);
      if (days > 30) console.warn(`[pesoDoDia] Peso de ${w.data} é ${days} dias antigo para ${data}`);
      return w.peso;
    };

    // 12 semanas — domingo como início
    const semanas = [];
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    const dow = hoje.getDay(); // 0 = domingo
    const semAtualInicio = new Date(hoje); semAtualInicio.setDate(hoje.getDate() - dow);

    for (let i = 11; i >= 0; i--) {
      const inicio = new Date(semAtualInicio); inicio.setDate(inicio.getDate() - i * 7);
      const fim    = new Date(inicio); fim.setDate(fim.getDate() + 7);
      const isoIni = inicio.toISOString().slice(0, 10);
      const isoFim = fim.toISOString().slice(0, 10);

      const acts = activities.filter(a => a.data >= isoIni && a.data < isoFim);
      let trimpFC = 0, trimpEst = 0, pesoMed = null, pesoSum = 0, pesoN = 0;
      acts.forEach(a => {
        const t = trimpDeAtividade(a, fcMax);
        if (a.fcMedia) trimpFC += t; else trimpEst += t; // separa carga real vs estimada
        const p = pesoDoDia(a.data);
        if (p) { pesoSum += p; pesoN++; }
      });
      const trimpTotal = trimpFC + trimpEst;
      pesoMed = pesoN ? pesoSum / pesoN : pesoDoDia(isoFim) || null;

      const trimpKg = (trimpTotal > 0 && pesoMed) ? trimpTotal / pesoMed : 0;
      semanas.push({
        label: inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''),
        trimpKg: +trimpKg.toFixed(2),
        trimpTotal,
        // Estimado só quando a MAIOR parte da carga veio de atividades sem FC
        estimado: trimpTotal > 0 && trimpEst > trimpFC,
        parcial: i === 0, // i=0 é a última semana = semana em curso (incompleta)
      });
    }

    // Trend: compara as duas últimas semanas COMPLETAS (ignora a em curso, que
    // está parcial e puxaria a tendência para baixo de forma enganosa).
    const idxAtual = semanas.length - 1;            // semana em curso (parcial)
    const ultima = semanas[idxAtual - 1]?.trimpKg ?? 0;   // última completa
    const penult = semanas[idxAtual - 2]?.trimpKg ?? 0;   // anterior à última completa
    let trendLabel = '—', trendColor = COLORS.muted2, msg = '';
    if (penult > 0) {
      const delta = ((ultima - penult) / penult) * 100;
      const arrow = delta >= 0 ? '▲' : '▼';
      trendLabel = `${arrow} ${Math.abs(delta).toFixed(0)}%`;
      if (delta > 10)       { trendColor = COLORS.green; msg = 'Volume crescendo — atenção à recuperação para sustentar o aumento.'; }
      else if (delta < -15) { trendColor = COLORS.amber; msg = 'Queda significativa — semana de recuperação ou previsto?'; }
      else                  { trendColor = COLORS.teal;  msg = 'Volume estável — boa consistência semanal.'; }
    }

    $('trimp-trend').textContent  = trendLabel;
    $('trimp-trend').style.background = trendColor + '20';
    $('trimp-trend').style.color = trendColor;
    $('trimp-msg').textContent = msg;

    const canvas = $('trimpChart');
    if (!canvas || !window.Chart) return true;
    if (_charts.trimp) _charts.trimp.destroy();
    _charts.trimp = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: semanas.map(s => s.label),
        datasets: [{
          data: semanas.map(s => s.trimpKg),
          // Verde-limão cheio = carga com FC; esmaecido + borda cinza = majoritariamente
          // estimada (sem FC); borda âmbar = semana em curso (parcial).
          backgroundColor: semanas.map(s => s.parcial ? 'rgba(198,241,53,0.18)' : (s.estimado ? 'rgba(198,241,53,0.20)' : 'rgba(198,241,53,0.45)')),
          borderColor: semanas.map(s => s.parcial ? COLORS.amber : (s.estimado ? COLORS.muted2 : COLORS.teal)),
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: HOVER,
        plugins: {
          legend: { display: false },
          tooltip: { ...TOOLTIP_STYLE, callbacks: {
            label: c => {
              const s = semanas[c.dataIndex];
              let base = `${c.parsed.y.toFixed(2)} TRIMP/kg`;
              if (s.parcial)       base += ' (semana em curso)';
              else if (s.estimado) base += ' (estimado — sem FC)';
              return base;
            }
          }},
        },
        scales: {
          y: { beginAtZero: true, ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
          x: { ticks: { color: COLORS.muted2 }, grid: { display: false } },
        },
      },
    });
    return true;
  }

  // Média móvel simples de N pontos (ignora nulos na janela)
  function _movingAvg(arr, n) {
    return arr.map((_, i) => {
      const win = arr.slice(Math.max(0, i - n + 1), i + 1).filter(v => v != null && isFinite(v));
      return win.length ? +(win.reduce((s, v) => s + v, 0) / win.length).toFixed(1) : null;
    });
  }

  // ───────────────────────────────────────────────────────────────
  // % DE SONO PROFUNDO (promovido de Testes · S3) — últimos 30 dias
  // ───────────────────────────────────────────────────────────────
  function renderSleepPct(health) {
    const canvas = $('insSleepPctChart');
    if (!canvas || !window.Chart) return false;
    const arr = [...health].sort((a, b) => a.data.localeCompare(b.data)).slice(-30);
    const labels = arr.map(h => h.data.slice(5));
    const pct = arr.map(h => (h.sono_total_s && h.sono_deep_s) ? +((h.sono_deep_s / h.sono_total_s) * 100).toFixed(1) : null);

    if (_charts.sleepPct) _charts.sleepPct.destroy();
    _charts.sleepPct = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          { type: 'line', label: '% profundo',      data: pct,                 borderColor: COLORS.blue,   backgroundColor: 'rgba(78,158,245,0.15)', borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true },
          { type: 'line', label: 'Ideal máx (23%)', data: labels.map(() => 23), borderColor: COLORS.muted2, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
          { type: 'line', label: 'Ideal mín (13%)', data: labels.map(() => 13), borderColor: COLORS.muted2, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: HOVER,
        plugins: {
          legend: { display: true, labels: { color: COLORS.muted2, boxWidth: 12, padding: 10, font: { size: 11 } } },
          tooltip: { ...TOOLTIP_STYLE, callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y}%` } },
        },
        scales: {
          x: { ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } },
          y: { ticks: { color: COLORS.muted2, callback: v => v + '%' }, grid: { color: COLORS.border }, suggestedMin: 0, suggestedMax: 35 },
        },
      },
    });

    const valid = pct.filter(v => v != null);
    const avg = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
    const msgEl = $('ins-sleep-pct-msg');
    if (msgEl) msgEl.textContent = avg == null ? 'Sem dados de sono suficientes.' : `Média de ${avg.toFixed(0)}% de sono profundo (faixa ideal 13–23%).`;
    return true;
  }

  // ───────────────────────────────────────────────────────────────
  // HRV NOTURNO × MÉDIA 7 NOITES (promovido de Testes · H3)
  // ───────────────────────────────────────────────────────────────
  function renderHrvMA(health) {
    const canvas = $('insHrvMaChart');
    if (!canvas || !window.Chart) return false;
    const arr = [...health].sort((a, b) => a.data.localeCompare(b.data)).slice(-30);
    const labels = arr.map(h => h.data.slice(5));
    const noite = arr.map(h => h.hrv_noite_avg ?? null);
    const ma = _movingAvg(noite, 7);

    if (_charts.hrvMa) _charts.hrvMa.destroy();
    _charts.hrvMa = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          { type: 'bar',  label: 'HRV noturno',     data: noite, backgroundColor: 'rgba(198,241,53,0.4)', borderColor: COLORS.teal, borderWidth: 1, borderRadius: 3 },
          { type: 'line', label: 'Média 7 noites',  data: ma,    borderColor: COLORS.amber, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: HOVER,
        plugins: {
          legend: { display: true, labels: { color: COLORS.muted2, boxWidth: 12, padding: 10, font: { size: 11 } } },
          tooltip: { ...TOOLTIP_STYLE, callbacks: { label: c => c.parsed.y == null ? `${c.dataset.label}: —` : `${c.dataset.label}: ${c.parsed.y} ms` } },
        },
        scales: {
          x: { ticks: { color: COLORS.muted2, maxTicksLimit: 10 }, grid: { display: false } },
          y: { ticks: { color: COLORS.muted2, callback: v => v + ' ms' }, grid: { color: COLORS.border } },
        },
      },
    });

    const valid = noite.filter(v => v != null);
    const last = valid[valid.length - 1];
    const lastMa = ma.filter(v => v != null).pop();
    const msgEl = $('ins-hrv-ma-msg');
    if (msgEl && last != null && lastMa != null) {
      const d = last - lastMa;
      msgEl.textContent = Math.abs(d) < 2
        ? 'HRV noturno em linha com a média de 7 noites.'
        : (d > 0 ? `HRV ${Math.round(d)} ms acima da média — boa recuperação.`
                 : `HRV ${Math.round(-d)} ms abaixo da média — possível fadiga ou estresse.`);
    }
    return true;
  }

  // ───────────────────────────────────────────────────────────────
  // 7.5 — CUSTO METABÓLICO (kcal/km)
  // ───────────────────────────────────────────────────────────────
  function renderCustoMetabolico(activities) {
    const elegiveis = activities.filter(a => a.calorias > 0 && a.distanciaKm > 1);
    if (elegiveis.length < 5) {
      $('custo-msg').textContent = 'Precisa de pelo menos 5 atividades com calorias registradas para análise confiável.';
      return false;
    }

    // kcal/km por atividade, ordenado por data
    const pontos = elegiveis
      .map(a => ({ data: a.data, x: a.data, y: +(a.calorias / a.distanciaKm).toFixed(1) }))
      .sort((a, b) => a.data.localeCompare(b.data));

    // Baseline: média geral
    const baseline = pontos.reduce((s, p) => s + p.y, 0) / pontos.length;
    // Tendência: últimas 5 vs anteriores
    const recentes = pontos.slice(-5);
    const anteriores = pontos.slice(0, -5);
    let trendLabel = '—', trendColor = COLORS.muted2, msg = '';
    if (anteriores.length >= 3) {
      const avgRec = recentes.reduce((s, p) => s + p.y, 0) / recentes.length;
      const avgAnt = anteriores.reduce((s, p) => s + p.y, 0) / anteriores.length;
      const delta = ((avgRec - avgAnt) / avgAnt) * 100;
      const arrow = delta >= 0 ? '▲' : '▼';
      trendLabel = `${arrow} ${Math.abs(delta).toFixed(0)}%`;
      if (delta > 10)       { trendColor = COLORS.red;   msg = 'Custo subindo — possível fadiga, técnica ou terreno mais exigente.'; }
      else if (delta < -8)  { trendColor = COLORS.green; msg = 'Eficiência melhorando — gastando menos energia por km.'; }
      else                  { trendColor = COLORS.teal;  msg = `Baseline: ~${baseline.toFixed(0)} kcal/km. Variação dentro do normal.`; }
    }

    $('custo-trend').textContent = trendLabel;
    $('custo-trend').style.background = trendColor + '20';
    $('custo-trend').style.color = trendColor;
    $('custo-msg').textContent = msg;

    const canvas = $('custoChart');
    if (!canvas || !window.Chart) return true;
    if (_charts.custo) _charts.custo.destroy();
    _charts.custo = new Chart(canvas, {
      type: 'line',
      data: {
        labels: pontos.map(p => fmtDate(p.x)),
        datasets: [
          {
            data: pontos.map(p => p.y),
            borderColor: COLORS.teal,
            backgroundColor: 'rgba(198,241,53,0.12)',
            tension: 0.25,
            fill: true,
            pointRadius: 3,
          },
          {
            data: pontos.map(() => baseline),
            borderColor: COLORS.muted,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: HOVER,
        plugins: {
          legend: { display: false },
          tooltip: { ...TOOLTIP_STYLE, callbacks: { label: c => c.datasetIndex === 0 ? `${c.parsed.y} kcal/km` : `baseline ${baseline.toFixed(0)}` } },
        },
        scales: {
          y: { ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
          x: { ticks: { color: COLORS.muted2, maxRotation: 45 }, grid: { display: false } },
        },
      },
    });
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // FASE 9 — Cards baseados em dados Garmin extras (Readiness, PBs, Scores)
  // ═══════════════════════════════════════════════════════════════
  let _readinessSparkChart = null;

  // 7.7 — Training Readiness (Garmin)
  function renderReadiness(items) {
    const card = $('card-readiness');
    if (!card) return;
    if (!items || items.length === 0) { card.hidden = true; return; }
    card.hidden = false;

    // Ordena asc por data para a sparkline; mais recente é o último
    const ordered = [...items].sort((a, b) => a.data.localeCompare(b.data));
    const latest = ordered[ordered.length - 1];

    const score = latest.score ?? null;
    const level = latest.level || '—';
    // Garmin retorna níveis: POOR < LOW < MODERATE < HIGH < (VERY_HIGH/PRIME)
    const READINESS_INFO = {
      VERY_HIGH: { label: 'Máxima',     color: COLORS.green, msg: 'Prontidão máxima — ótimo dia para sua sessão mais forte.' },
      PRIME:     { label: 'Máxima',     color: COLORS.green, msg: 'Prontidão máxima — ótimo dia para sua sessão mais forte.' },
      HIGH:      { label: 'Alta',       color: COLORS.green, msg: 'Garmin diz: pronto para sessão intensa hoje.' },
      MODERATE:  { label: 'Moderada',   color: COLORS.amber, msg: 'Recuperação moderada — treino normal ok.' },
      LOW:       { label: 'Baixa',      color: COLORS.red,   msg: 'Baixa prontidão — priorize recuperação hoje.' },
      POOR:      { label: 'Muito baixa',color: COLORS.red,   msg: 'Prontidão muito baixa — dia de descanso, evite treino intenso.' },
    };
    const info = READINESS_INFO[level] || { label: level, color: COLORS.muted2, msg: '' };
    const color = info.color, msg = info.msg;

    $('readiness-score').textContent = score ?? '—';
    $('readiness-level').textContent = info.label;
    $('readiness-level').style.background = color + '20';
    $('readiness-level').style.color = color;
    if (score != null) {
      $('readiness-fill').style.width = Math.min(100, Math.max(0, score)) + '%';
      $('readiness-fill').style.background = color;
    }
    $('readiness-sleep').textContent = latest.sleep_score != null ? `${latest.sleep_score}` : '—';
    $('readiness-recovery').textContent = latest.recovery_time_h != null ? `${Math.round(latest.recovery_time_h / 60)}h` : '—';
    $('readiness-hrv').textContent = latest.hrv_weekly_avg != null ? `${latest.hrv_weekly_avg} ms` : '—';
    $('readiness-msg').textContent = msg;

    // Sparkline
    const canvas = $('readinessSparkChart');
    if (canvas && window.Chart) {
      if (_readinessSparkChart) _readinessSparkChart.destroy();
      _readinessSparkChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: ordered.map(r => r.data.slice(5)), // MM-DD
          datasets: [{
            data: ordered.map(r => r.score),
            borderColor: color,
            backgroundColor: color + '20',
            tension: 0.3,
            fill: true,
            pointRadius: 2,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            y: { display: false, min: 0, max: 100 },
            x: { display: false },
          },
        },
      });
    }
    return true;
  }

  // 7.8 — Personal Records (Garmin)
  function renderPRs(items) {
    const card = $('card-prs');
    if (!card) return;
    if (!items || items.length === 0) { card.hidden = true; return; }
    card.hidden = false;

    const esc = window.esc || (s => String(s || ''));

    const TYPE_LABELS = {
      1:  '1 km mais rápido',
      2:  'Maior distância',
      3:  'Maior elevação acumulada',
      4:  'Maior duração',
      5:  'Velocidade máxima',
      6:  '5 km mais rápido',
      7:  '10 km mais rápido',
      8:  'Meia-maratona mais rápida',
      9:  'Maratona mais rápida',
      10: 'Maior cadência média',
      11: 'Maior subida acumulada em 1h',
      12: 'Maior potência média em 1h',
      13: 'Melhor VO2max estimado',
      14: 'Maior distância semanal',
      15: 'Maior elevação semanal',
      16: 'Maior carga de treino',
    };

    const ACTIVITY_TYPE_LABELS = {
      cycling: 'Ciclismo', road_biking: 'Ciclismo estrada',
      mountain_biking: 'MTB', gravel_cycling: 'Gravel',
      running: 'Corrida', treadmill_running: 'Esteira',
      trail_running: 'Trail', walking: 'Caminhada',
      swimming: 'Natação', strength_training: 'Força',
    };

    const CYCLING_TYPES = new Set(['cycling', 'road_biking', 'mountain_biking', 'gravel_cycling']);

    // Garmin reutiliza type_ids de corrida em atividades de ciclismo com semântica diferente.
    // Confirmado cruzando os valores do DB com as colunas distancia_m / elevacao_m das atividades:
    //   type 8 (cycling)     → distancia_m  → exibir como km
    //   type 9 (road_biking) → elevacao_m   → exibir como metros
    //   type 12              → armazenado em centiwatts (÷100 para W)
    const formatValue = (typeId, value, actType) => {
      if (value == null) return '—';
      const isCycling = CYCLING_TYPES.has(actType);

      // type 8 para ciclismo = distância máxima do pedal (metros → km)
      if (typeId === 8 && isCycling) return (value / 1000).toFixed(1).replace('.', ',') + ' km';
      // type 9 para ciclismo = maior ganho de elevação (metros)
      if (typeId === 9 && isCycling) return Math.round(value).toLocaleString('pt-BR') + ' m';

      // Tempos em segundos: 1km, 5km, 10km, meia, maratona, duração (apenas para corrida)
      if ([1, 4, 6, 7, 8, 9].includes(typeId)) {
        const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), s = Math.floor(value % 60);
        return h > 0 ? `${h}h${String(m).padStart(2,'0')}m` : `${m}min ${String(s).padStart(2,'0')}s`;
      }
      // Distância máxima (metros → km)
      if (typeId === 2) return (value / 1000).toFixed(1).replace('.', ',') + ' km';
      // Elevação acumulada (metros)
      if (typeId === 3) return Math.round(value).toLocaleString('pt-BR') + ' m';
      // Velocidade m/s → km/h
      if (typeId === 5) return (value * 3.6).toFixed(1).replace('.', ',') + ' km/h';
      // Cadência
      if (typeId === 10) return Math.round(value) + ' rpm';
      // Maior subida acumulada em 1h (metros)
      if (typeId === 11) return Math.round(value).toLocaleString('pt-BR') + ' m';
      // Maior potência média em 1h — Garmin armazena em centiwatts (÷100 para W)
      if (typeId === 12) return (value > 1000 ? Math.round(value / 100) : Math.round(value)).toLocaleString('pt-BR') + ' W';
      // VO2max (Garmin armazena × 1000 internamente)
      if (typeId === 13) return (value > 1000 ? value / 1000 : value).toFixed(1) + ' mL/kg/min';
      // Maior distância semanal (metros → km)
      if (typeId === 14) return (value / 1000).toFixed(1).replace('.', ',') + ' km';
      // Maior elevação semanal (metros)
      if (typeId === 15) return Math.round(value).toLocaleString('pt-BR') + ' m';
      // Carga de treino (score)
      if (typeId === 16) return Math.round(value) + ' pts';
      return value.toFixed(1).replace('.', ',');
    };

    // Labels alternativos para type_ids cujo significado muda em ciclismo
    const CYCLING_LABEL_OVERRIDE = {
      8: 'Maior distância (ciclismo)',
      9: 'Maior elevação num pedal',
    };

    // Mostra apenas os recordes selecionados:
    // 14=dist. semanal · 8=dist. ciclismo · 15=elev. semanal · 9=elev. num pedal · 13=VO2max
    const ALLOWED_PR_TYPES = new Set([14, 8, 15, 9, 13]);
    const visible = items.filter(p => ALLOWED_PR_TYPES.has(p.type_id) && TYPE_LABELS[p.type_id] != null);
    $('prs-count').textContent = visible.length;

    const now = Date.now();
    const DAYS_30 = 30 * 86400_000;

    const parseIsoDate = raw => {
      if (!raw) return null;
      // Suporta "YYYY-MM-DD HH:MM:SS" e "YYYY-MM-DDTHH:MM:SS"
      const iso = raw.split(/[T ]/)[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
      const d = new Date(iso + 'T12:00:00');
      return isNaN(d.getTime()) ? null : d;
    };

    $('prs-list').innerHTML = visible.map(p => {
      const isCyc = CYCLING_TYPES.has(p.activity_type);
      const label = (isCyc && CYCLING_LABEL_OVERRIDE[p.type_id]) || TYPE_LABELS[p.type_id];
      const val   = formatValue(p.type_id, p.valor, p.activity_type);
      const d     = parseIsoDate(p.pr_date || p.activity_date);
      const dataStr = d && isFinite(d)
        ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';
      const isNew = d && isFinite(d) && (now - d.getTime()) < DAYS_30;
      const newBadge = isNew ? '<span class="pr-new">Novo!</span>' : '';
      const actBadge = p.activity_type
        ? `<span class="pr-sport">${esc(ACTIVITY_TYPE_LABELS[p.activity_type] || p.activity_type)}</span>`
        : '';
      const meta = [p.activity_name, dataStr].filter(Boolean).join(' · ');
      return `
        <div class="pr-item">
          <div class="pr-info">
            <div class="pr-label">${esc(label)} ${newBadge}</div>
            <div class="pr-meta">${esc(meta)} ${actBadge}</div>
          </div>
          <div class="pr-value">${esc(val)}</div>
        </div>`;
    }).join('');

    const hasNew = visible.some(p => {
      const d = parseIsoDate(p.pr_date || p.activity_date);
      return d && isFinite(d) && (now - d.getTime()) < DAYS_30;
    });
    $('prs-msg').textContent = hasNew ? 'Você bateu um recorde nos últimos 30 dias!' : '';
    return true;
  }

  // 7.9 — Hill + Endurance Score (Garmin)
  function renderScores(items) {
    const card = $('card-scores');
    if (!card) return;
    if (!items || items.length === 0) { card.hidden = true; return; }

    const latest = [...items].sort((a, b) => b.data.localeCompare(a.data))[0];
    if (!latest.endurance_score && !latest.hill_score) { card.hidden = true; return; }
    card.hidden = false;

    // Endurance
    const eVal = latest.endurance_score;
    const eMin = latest.endurance_gauge_lower || 0;
    const eMax = latest.endurance_gauge_upper || 10000;
    const eClass = latest.endurance_classification;
    const CLASS_LABELS = ['—','Iniciante','Amador','Intermediário','Treinado','Bem Treinado','Especialista','Superior','Elite'];

    // Sugestões de progressão do Endurance Score, indexadas pela classificação
    // (1=Iniciante … 8=Elite). Acompanham a curva: base aeróbica → volume →
    // limiar → VO2max → polarização → manutenção. Índice 0 = sem dado/score.
    const ENDURANCE_TIPS = [
      'Sincronize mais pedais longos no Garmin para o Endurance Score se caracterizar.',
      'Construa a base: pedais longos e constantes em Z2, 2–3× por semana, sem se preocupar com ritmo.',
      'Aumente o volume semanal aos poucos (~10%/semana), mantendo a maior parte do tempo em Z2.',
      'Some um pedal longo progressivo e um treino de tempo/limiar (Z3–Z4) por semana.',
      'Inclua intervalados de limiar (ex.: 2×20 min em Z4) para elevar o teto aeróbico.',
      'Periodize: alterne blocos de volume com semanas de VO2max (ex.: 5×4 min em Z5).',
      'Refine com sweet spot prolongado e recuperação estruturada entre os blocos fortes.',
      'Mantenha alto volume com treino polarizado (muito Z2 + doses de Z5) e cuide da recuperação.',
      'Score de elite — foque em manutenção, especificidade de prova e recuperação fina.',
    ];

    $('endurance-value').textContent = eVal ?? '—';
    if (eVal != null) {
      const pct = Math.max(0, Math.min(100, ((eVal - eMin) / (eMax - eMin)) * 100));
      $('endurance-fill').style.width = pct + '%';
      $('endurance-fill').style.background = COLORS.teal;
    }
    $('endurance-meta').textContent = `${eMin}–${eMax} · ${CLASS_LABELS[eClass] || ''}`;
    const eTip = $('endurance-tip');
    if (eTip) eTip.textContent = eVal != null ? (ENDURANCE_TIPS[eClass] || ENDURANCE_TIPS[0]) : '';

    // Hill
    const hVal = latest.hill_score;
    $('hill-value').textContent = hVal ?? '—';
    if (hVal != null) {
      $('hill-fill').style.width = Math.min(100, hVal) + '%';
      $('hill-fill').style.background = COLORS.amber;
    } else {
      $('hill-fill').style.width = '0%';
    }
    $('hill-meta').textContent = hVal == null
      ? 'Sem score ainda — o Garmin calcula o Hill Score a partir de rides com ganho de elevação significativo. Sincronize atividades com subidas para acumular dados.'
      : 'Capacidade em subidas.';

    $('scores-class').textContent = CLASS_LABELS[eClass] || '—';
    $('scores-class').style.background = COLORS.teal + '20';
    $('scores-class').style.color = COLORS.teal;

    $('scores-msg').textContent = (hVal == null && eVal != null)
      ? 'Endurance bem caracterizada. Para o Hill Score, sincronize rides com elevação acumulada no Garmin Connect.'
      : '';
    return true;
  }

  // ───────────────────────────────────────────────────────────────
  // TOPO Hi-Vis — banner + KPIs + carga×fadiga×forma + zona + recomendações
  // ───────────────────────────────────────────────────────────────
  function emaSeries(serie, tau) {
    if (!serie.length) return [];
    const out = [serie[0]];
    for (let i = 1; i < serie.length; i++) out.push(out[i - 1] + (serie[i] - out[i - 1]) / tau);
    return out;
  }

  function renderInsLoadChart(labels, carga, fadiga, forma) {
    const el = $('insLoadChart');
    if (!el || !window.Chart) return;
    if (_charts.insLoad) { _charts.insLoad.destroy(); _charts.insLoad = null; }
    _charts.insLoad = new Chart(el.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Carga',  data: carga,  borderColor: '#c6f135', backgroundColor: 'rgba(198,241,53,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true },
        { label: 'Fadiga', data: fadiga, borderColor: '#f5d523', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.35 },
        { label: 'Forma',  data: forma,  borderColor: '#ec3a8b', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, borderDash: [5, 4], tension: 0.35 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: HOVER,
        plugins: {
          legend: { display: true, labels: { color: COLORS.muted2, boxWidth: 12, padding: 12, font: { size: 11 } } },
          tooltip: { ...TOOLTIP_STYLE, callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y}` } },
        },
        scales: {
          y: { ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
          x: { ticks: { color: COLORS.muted2 }, grid: { display: false } },
        },
      },
    });
  }

  async function renderInsZoneChart() {
    const el = $('insZoneChart');
    if (!el || !window.Chart) return;
    let dist = null;
    try { dist = await window.Api.get('/garmin/zone-distribution?days=30'); } catch (_) {}
    const seg = (dist && dist.segundosPorZona) || [];
    const total = (dist && dist.totalSegundos) || 0;
    if (_charts.insZone) { _charts.insZone.destroy(); _charts.insZone = null; }
    if (!total) { el.parentElement.innerHTML = '<div style="color:var(--muted2);font-size:12px;text-align:center;padding:24px 0;">Sem dados de zona de FC nos últimos 30 dias.</div>'; return; }
    // Usa os SEGUNDOS reais (não % arredondado): zonas pequenas — ex.: Z1 com
    // poucos minutos — continuam visíveis em vez de sumir por arredondar a 0%.
    const data = seg.slice(0, 5);
    _charts.insZone = new Chart(el.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
              datasets: [{ data, backgroundColor: ['#4e9ef5', '#f5d523', '#22c55e', '#f0523a', '#a855f7'], borderColor: '#13151a', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { color: COLORS.muted2, boxWidth: 10, padding: 10, font: { size: 11 } } },
          tooltip: { ...TOOLTIP_STYLE, callbacks: { label: c => {
            const pct = total ? Math.round((c.parsed / total) * 100) : 0;
            const min = Math.round(c.parsed / 60);
            return `${c.label}: ${pct}% · ${min} min`;
          } } } } },
    });
  }

  // Pool de sugestões por categoria. Cada item tem `when(ctx)` (condição sobre
  // os dados dos insights) e a mensagem exibida. Para cada categoria mostra-se
  // a primeira sugestão cuja condição é satisfeita.
  const INS_REC_POOL = {
    forma: [
      { when: c => c.tsb > 15,                      cls: 'lime',    icon: 'fa-circle-check',         title: 'Janela de pico',        msg: 'TSB bem positivo — ideal para uma prova, KOM ou teste de performance nos próximos dias.' },
      { when: c => c.tsb > 5,                       cls: 'lime',    icon: 'fa-circle-check',         title: 'Aproveite a forma',     msg: 'Você está fresco e em forma — programe um pedal forte enquanto o TSB está positivo.' },
      { when: c => c.tsb > -10,                     cls: 'lime',    icon: 'fa-gauge',                title: 'Mantenha o ritmo',      msg: 'Carga e recuperação equilibradas — siga com o plano de treino atual.' },
      { when: c => c.tsb > -25,                     cls: 'amber',   icon: 'fa-gauge-high',           title: 'Bom estímulo',          msg: 'Carga acumulando bem. Treino normal ok, mas evite excesso de volume esta semana.' },
      { when: c => true,                            cls: 'magenta', icon: 'fa-triangle-exclamation', title: 'Priorize recuperação',  msg: 'Sobrecarga acumulada — reduza volume e intensidade nos próximos dias para evitar overreaching.' },
    ],
    sono: [
      { when: c => c.sonoMedH != null && c.sonoMedH < 6,   cls: 'magenta', icon: 'fa-bed', title: 'Sono insuficiente', msg: c => `Média de apenas ${c.sonoMedH.toFixed(1).replace('.', ',')}h nas últimas noites. A recuperação está comprometida — priorize dormir.` },
      { when: c => c.sonoMedH != null && c.sonoMedH < 7,   cls: 'amber',   icon: 'fa-bed', title: 'Cuide do sono',     msg: c => `Sua média caiu para ${c.sonoMedH.toFixed(1).replace('.', ',')}h. Priorize o descanso antes do próximo bloco intenso.` },
      { when: c => c.sonoMedH != null,                     cls: 'lime',    icon: 'fa-bed', title: 'Sono em dia',       msg: c => `Média de ${c.sonoMedH.toFixed(1).replace('.', ',')}h — boa base de recuperação. Mantenha a rotina.` },
      { when: c => true,                                   cls: 'amber',   icon: 'fa-bed', title: 'Registre o sono',   msg: 'Sincronize o sono no Garmin para acompanhar a qualidade da sua recuperação.' },
    ],
    intensidade: [
      { when: c => c.hrvDelta != null && c.hrvDelta < -6,  cls: 'magenta', icon: 'fa-heart-pulse', title: 'HRV em queda',           msg: 'Sua HRV noturna caiu na última semana — sinal de fadiga. Inclua um dia leve ou de descanso.' },
      { when: c => c.pctAlto < 0.10,                       cls: 'magenta', icon: 'fa-mountain',    title: 'Adicione subidas',       msg: 'Pouco volume em Z4–Z5 nas últimas 2 semanas. Inclua intervalados em rampa para ganhar potência.' },
      { when: c => c.pctAlto > 0.30,                       cls: 'lime',    icon: 'fa-arrow-down-wide-short', title: 'Equilibre com base', msg: 'Muito volume em alta intensidade — adicione pedais longos em Z2 para consolidar a base aeróbica.' },
      { when: c => true,                                   cls: 'amber',   icon: 'fa-bolt',        title: 'Boa dose de intensidade', msg: 'Distribuição de zonas equilibrada — mantenha a mescla de base e intensidade.' },
    ],
  };

  function pickRec(cat, ctx) {
    const pool = INS_REC_POOL[cat] || [];
    const r = pool.find(x => { try { return x.when(ctx); } catch (_) { return false; } });
    if (!r) return null;
    return { cls: r.cls, icon: r.icon, title: r.title, msg: typeof r.msg === 'function' ? r.msg(ctx) : r.msg };
  }

  function renderInsRecs(tsb, healthArr, activities, fcMax) {
    const cont = $('ins-recs');
    if (!cont) return;

    // Sono (média das últimas noites)
    const sonoVals = healthArr.filter(h => h.sono_total_s != null).slice(0, 7).map(h => h.sono_total_s);
    const sonoMedH = sonoVals.length ? (sonoVals.reduce((s, v) => s + v, 0) / sonoVals.length) / 3600 : null;

    // Volume em alta intensidade (Z4–Z5 ≈ fcMedia ≥ 85% FCM) nas últimas 2 semanas
    const duasSem = Date.now() - 14 * 86400_000;
    let altoTempo = 0, totalTempo = 0;
    (activities || []).forEach(a => {
      const isoD = (a.data || (a.inicio || '').slice(0, 10));
      const d = new Date(isoD + 'T12:00:00'); if (isNaN(d) || d.getTime() < duasSem) return;
      const intens = a.fcMedia && fcMax ? a.fcMedia / fcMax : 0;
      totalTempo += (a.tempoMovS || 0);
      if (intens >= 0.85) altoTempo += (a.tempoMovS || 0);
    });
    const pctAlto = totalTempo ? altoTempo / totalTempo : 0;

    // Tendência de HRV (semana atual vs. anterior)
    const hrvSerie = healthArr.filter(h => h.hrv_noite_avg != null).map(h => h.hrv_noite_avg);
    const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const hrvSem = avg(hrvSerie.slice(0, 7)), hrvAnt = avg(hrvSerie.slice(7, 14));
    const hrvDelta = (hrvSem != null && hrvAnt != null) ? hrvSem - hrvAnt : null;

    const ctx = { tsb, sonoMedH, pctAlto, hrvDelta };
    const recs = ['forma', 'sono', 'intensidade'].map(cat => pickRec(cat, ctx)).filter(Boolean);

    const esc = window.esc || (s => String(s == null ? '' : s));
    cont.innerHTML = recs.map(r =>
      `<div class="ins-rec ${r.cls}"><div class="ins-rec-title"><i class="fa-solid ${r.icon}"></i>${esc(r.title)}</div><div class="ins-rec-msg">${esc(r.msg)}</div></div>`
    ).join('');
  }

  function renderInsightsTop(activities, healthArr, prs, fcMax) {
    const top = $('insights-top');
    if (!top) return;

    let ctl = 0, atl = 0, tsb = 0, ctlSerie = [], atlSerie = [];
    if (activities.length && fcMax) {
      const tssDia = {};
      activities.forEach(a => { const t = tssDeAtividade(a, fcMax); if (t > 0) tssDia[a.data] = (tssDia[a.data] || 0) + t; });
      const serie = [];
      const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
      for (let i = 59; i >= 0; i--) { const d = new Date(hoje); d.setDate(d.getDate() - i); serie.push(tssDia[d.toISOString().slice(0, 10)] || 0); }
      ctlSerie = emaSeries(serie, 42);
      atlSerie = emaSeries(serie, 7);
      ctl = ctlSerie[ctlSerie.length - 1] || 0;
      atl = atlSerie[atlSerie.length - 1] || 0;
      tsb = ctl - atl;
    }
    top.hidden = false;

    // Banner
    let bTitle, bMsg, bColor, bIcon;
    if (tsb > 10)       { bTitle = 'Forma em pico — aproveite a janela'; bMsg = 'Seu balanço de treino (TSB) está positivo e a fadiga baixa. Bom momento para um pedal forte ou prova.'; bColor = 'var(--lime)'; bIcon = 'fa-bolt'; }
    else if (tsb > -5)  { bTitle = 'Em equilíbrio'; bMsg = 'Carga e recuperação equilibradas — mantenha o ritmo de treino atual.'; bColor = 'var(--lime)'; bIcon = 'fa-scale-balanced'; }
    else if (tsb > -20) { bTitle = 'Carregado — bom estímulo'; bMsg = 'Carga acumulada. Treino normal ok, mas monitore sinais de cansaço.'; bColor = 'var(--amber)'; bIcon = 'fa-gauge-high'; }
    else                { bTitle = 'Sobrecarga — priorize recuperação'; bMsg = 'Risco de overreaching. Reduza volume e intensidade nos próximos dias.'; bColor = 'var(--magenta)'; bIcon = 'fa-triangle-exclamation'; }
    const banner = $('ins-banner'); if (banner) banner.style.background = bColor;
    $('ins-banner-title').textContent = bTitle;
    $('ins-banner-msg').textContent = bMsg;
    $('ins-banner-tsb').textContent = (tsb >= 0 ? '+' : '') + tsb.toFixed(0);
    const bico = $('ins-banner-ico'); if (bico) bico.className = 'fa-solid ' + bIcon;

    // KPIs
    $('ins-kpi-ctl').textContent = ctl.toFixed(0);
    $('ins-kpi-atl').textContent = atl.toFixed(0);
    $('ins-kpi-atl-sub').textContent = atl <= ctl ? 'recuperado' : 'fadiga elevada';
    let vo2 = null;
    (prs || []).forEach(p => { if (p.type_id === 13) vo2 = p.valor > 1000 ? p.valor / 1000 : p.valor; });
    $('ins-kpi-vo2').textContent = vo2 ? vo2.toFixed(0) : '—';
    $('ins-kpi-vo2-sub').textContent = vo2 ? 'estimado pelo Garmin' : 'sincronize o Garmin';
    const hrvVals = healthArr.filter(h => h.hrv_noite_avg != null).slice(0, 7).map(h => h.hrv_noite_avg);
    const hrv = hrvVals.length ? hrvVals.reduce((s, v) => s + v, 0) / hrvVals.length : null;
    $('ins-kpi-hrv').textContent = hrv ? Math.round(hrv) : '—';
    $('ins-kpi-hrv-sub').textContent = hrv ? 'média 7 dias' : 'sem dados';

    // Gráfico Carga × Fadiga × Forma (8 pontos semanais)
    const labels = [], cArr = [], aArr = [], fArr = [];
    for (let w = 7; w >= 0; w--) {
      const idx = ctlSerie.length - 1 - w * 7;
      if (idx < 0) continue;
      labels.push('S' + (8 - w));
      cArr.push(+ctlSerie[idx].toFixed(1));
      aArr.push(+atlSerie[idx].toFixed(1));
      fArr.push(+(ctlSerie[idx] - atlSerie[idx]).toFixed(1));
    }
    renderInsLoadChart(labels, cArr, aArr, fArr);
    renderInsZoneChart();
    renderInsRecs(tsb, healthArr, activities, fcMax);
  }

  // ───────────────────────────────────────────────────────────────
  // LOAD — busca dados e renderiza todos os insights
  // ───────────────────────────────────────────────────────────────
  async function load() {
    const empty   = $('insights-empty');
    const content = $('insights-content');
    if (!empty || !content) return;

    try {
      const [unified, health, readiness, prs, scores] = await Promise.all([
        window.Api.get('/activities/unified?days=180').catch(() => ({ items: [] })),
        window.Api.get('/garmin/health?days=60').catch(() => []),
        window.Api.get('/garmin/training-readiness?days=14').catch(() => []),
        window.Api.get('/garmin/personal-records').catch(() => []),
        window.Api.get('/garmin/fitness-scores?days=14').catch(() => []),
      ]);

      const activities = (unified && unified.items) || [];
      // Ordenar health desc (mais recente primeiro) — para slice em janelas
      const healthArr = Array.isArray(health) ? [...health].sort((a, b) => b.data.localeCompare(a.data)) : [];

      const user = window.Storage ? Storage.getUser() : {};
      const weights = window.Storage ? Storage.getWeights() : [];
      const fcMax = calcFCMax(user);

      if (activities.length === 0 && healthArr.length === 0) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;

      // Roda cada insight individualmente — falha em um não derruba os outros
      try { renderInsightsTop(activities, healthArr, prs, fcMax); } catch (e) { console.error('[insights] topo', e); }
      try { renderFadiga(healthArr); }                              catch (e) { console.error('[insights] 7.1', e); }
      try { renderTSS(activities, fcMax); }                         catch (e) { console.error('[insights] 7.4', e); }
      try { renderTrimpSemanal(activities, weights, fcMax); }       catch (e) { console.error('[insights] 7.3', e); }
      try { renderSleepPct(healthArr); }                            catch (e) { console.error('[insights] sono%', e); }
      try { renderHrvMA(healthArr); }                               catch (e) { console.error('[insights] hrv-ma', e); }
      try { renderCustoMetabolico(activities); }                    catch (e) { console.error('[insights] 7.5', e); }
      try { renderReadiness(readiness); }                            catch (e) { console.error('[insights] 7.7', e); }
      try { renderPRs(prs); }                                        catch (e) { console.error('[insights] 7.8', e); }
      try { renderScores(scores); }                                  catch (e) { console.error('[insights] 7.9', e); }
    } catch (err) {
      console.error('[insights]', err);
      empty.textContent = 'Falha ao carregar insights.';
      empty.hidden = false;
      content.hidden = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Popover de informação dos cards de Insights
  // ═══════════════════════════════════════════════════════════════
  function initInfoPopovers() {
    const popover = document.getElementById('insight-popover');
    if (!popover) return;
    let activeBtn = null;

    function hide() {
      popover.hidden = true;
      activeBtn = null;
    }

    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.insight-info-btn');
      if (!btn) { hide(); return; }
      e.stopPropagation();
      if (activeBtn === btn) { hide(); return; }

      activeBtn = btn;
      popover.textContent = btn.dataset.info || '';
      popover.hidden = false;

      // Posiciona abaixo do botão, limitado à janela
      const rect = btn.getBoundingClientRect();
      const pw = Math.min(300, window.innerWidth - 24);
      popover.style.maxWidth = pw + 'px';
      let left = rect.left;
      if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
      if (left < 12) left = 12;
      let top = rect.bottom + 8;
      if (top + 120 > window.innerHeight) top = rect.top - 8 - popover.offsetHeight;
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
    }, true);
  }

  initInfoPopovers();

  window.Insights = { load };
})();
