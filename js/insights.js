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
  const _charts = { trimp: null, sleep: null, custo: null, hrvLoad: null };

  // ── Helpers de cor (usa FC_ZONES quando aplicável) ──────────────
  const COLORS = {
    teal:   '#14d9b8',
    amber:  '#f5a523',
    red:    '#f0523a',
    green:  '#22c55e',
    blue:   '#4e9ef5',
    muted:  '#6b7280',
    muted2: '#9299a8',
    border: '#252830',
  };

  // ── Helpers de cálculo ──────────────────────────────────────────
  function calcFCMax(user) {
    if (user.fcMax) return user.fcMax;
    if (!user.dataNascimento) return null;
    const anos = (Date.now() - new Date(user.dataNascimento).getTime()) / (365.25 * 86400_000);
    return Math.round(220 - anos);
  }

  // TRIMP simplificado de Banister (Edwards): tempo (min) × fator de intensidade²
  // Quando fcMedia não está disponível usa 0,70 (≈ Zona 2) como estimativa conservadora.
  const INTENSITY_FALLBACK = 0.70;

  function trimpDeAtividade(act, fcMax) {
    if (!act || !fcMax || !act.tempoMovS) return 0;
    const tempoMin  = act.tempoMovS / 60;
    const intensity = act.fcMedia
      ? Math.min(act.fcMedia / fcMax, 1.10)
      : INTENSITY_FALLBACK;
    return tempoMin * intensity * intensity;
  }

  // TSS normalizado (1h em Z4 ≈ 100). Usa TRIMP como base.
  function tssDeAtividade(act, fcMax) {
    if (!act || !fcMax || !act.tempoMovS) return 0;
    const tempoH    = act.tempoMovS / 3600;
    const intensity = act.fcMedia
      ? Math.min(act.fcMedia / fcMax, 1.10)
      : INTENSITY_FALLBACK;
    // Aproximação: TSS = tempo_h × intensity² × 100 (calibrado para 1h em ~88% FCM ≈ 80 TSS)
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
    const bbiScore  = bbMaxAvg ? Math.min(100, (bbDrainAvg / Math.max(bbMaxAvg, 1)) * 100) : 50;
    const stressScore = Math.min(100, stressAvg * 1.5); // stress 50 → 75 no score
    let hrvScore = 50;
    if (hrvSem && hrvSemAnt) {
      const delta = (hrvSemAnt - hrvSem) / hrvSemAnt; // positivo = HRV caindo = fadiga subindo
      hrvScore = Math.max(0, Math.min(100, 50 + delta * 200));
    }

    const fadiga = Math.round(bbiScore * 0.40 + hrvScore * 0.35 + stressScore * 0.25);

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
    $('fadiga-bb').textContent     = bbMaxAvg ? `${Math.round(bbDrainAvg)} / ${Math.round(bbMaxAvg)}` : '—';
    $('fadiga-hrv').textContent    = hrvSem ? `${Math.round(hrvSem)} ms` + (hrvSemAnt ? ` (${hrvSem > hrvSemAnt ? '+' : ''}${Math.round(hrvSem - hrvSemAnt)})` : '') : '—';
    $('fadiga-stress').textContent = `${Math.round(stressAvg)}`;
    $('fadiga-msg').textContent    = msg;
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
      return aplicaveis.length ? aplicaveis[aplicaveis.length - 1].peso : null;
    };

    // 12 semanas — segunda como início
    const semanas = [];
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    const dow = (hoje.getDay() + 6) % 7;
    const semAtualInicio = new Date(hoje); semAtualInicio.setDate(hoje.getDate() - dow);

    for (let i = 11; i >= 0; i--) {
      const inicio = new Date(semAtualInicio); inicio.setDate(inicio.getDate() - i * 7);
      const fim    = new Date(inicio); fim.setDate(fim.getDate() + 7);
      const isoIni = inicio.toISOString().slice(0, 10);
      const isoFim = fim.toISOString().slice(0, 10);

      const acts = activities.filter(a => a.data >= isoIni && a.data < isoFim);
      let trimpTotal = 0, pesoMed = null, pesoSum = 0, pesoN = 0, semFC = false;
      acts.forEach(a => {
        trimpTotal += trimpDeAtividade(a, fcMax);
        if (!a.fcMedia) semFC = true; // ao menos uma atividade sem FC → estimado
        const p = pesoDoDia(a.data);
        if (p) { pesoSum += p; pesoN++; }
      });
      pesoMed = pesoN ? pesoSum / pesoN : pesoDoDia(isoFim) || null;

      const trimpKg = (trimpTotal > 0 && pesoMed) ? trimpTotal / pesoMed : 0;
      semanas.push({
        label: inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''),
        trimpKg: +trimpKg.toFixed(2),
        trimpTotal,
        estimado: acts.length > 0 && semFC, // sem FC real → barra estimada
      });
    }

    // Trend: última vs penúltima semana
    const ultima = semanas[semanas.length - 1].trimpKg;
    const penult = semanas[semanas.length - 2].trimpKg;
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
          // Barra com tracejado (opacity menor) quando intensidade é estimada (sem FC)
          backgroundColor: semanas.map(s => s.estimado ? 'rgba(20,217,184,0.20)' : 'rgba(20,217,184,0.45)'),
          borderColor: semanas.map(s => s.estimado ? COLORS.muted2 : COLORS.teal),
          borderWidth: 1,
          borderDash: [],
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: c => {
              const s = semanas[c.dataIndex];
              const base = `${c.parsed.y.toFixed(2)} TRIMP/kg`;
              return s.estimado ? base + ' (estimado — sem FC)' : base;
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

  // ───────────────────────────────────────────────────────────────
  // 7.2 — SONO × DESEMPENHO
  // ───────────────────────────────────────────────────────────────
  function renderSonoVsFC(activities, health, fcMax) {
    if (!activities.length || !health.length || !fcMax) return false;

    const healthByDate = {};
    health.forEach(h => { healthByDate[h.data] = h; });

    // Para cada atividade, pega sono_deep_s do dia anterior
    const pontos = [];
    activities.forEach(a => {
      if (!a.fcMedia || !a.data) return;
      const ontem = new Date(a.data + 'T12:00:00');
      ontem.setDate(ontem.getDate() - 1);
      const ontemIso = ontem.toISOString().slice(0, 10);
      const sleep = healthByDate[ontemIso];
      if (!sleep || !sleep.sono_deep_s) return;
      pontos.push({
        x: +(sleep.sono_deep_s / 60).toFixed(1),       // minutos de sono profundo
        y: +((a.fcMedia / fcMax) * 100).toFixed(1),    // % da FCM
        nome: a.nome,
        data: a.data,
      });
    });

    if (pontos.length < 3) {
      $('sleep-msg').textContent = 'Poucos dados ainda — precisa de pelo menos 3 atividades com sono registrado no dia anterior.';
      return true;
    }

    // Análise simples: média de FC% para sono < mediana vs sono > mediana
    const sorted = [...pontos].sort((a, b) => a.x - b.x);
    const mediana = sorted[Math.floor(sorted.length / 2)].x;
    const baixo = pontos.filter(p => p.x < mediana);
    const alto  = pontos.filter(p => p.x >= mediana);
    const avgBaixo = baixo.length ? baixo.reduce((s, p) => s + p.y, 0) / baixo.length : 0;
    const avgAlto  = alto.length  ? alto.reduce((s, p) => s + p.y, 0) / alto.length : 0;
    const diff = avgBaixo - avgAlto;

    let msg;
    if (Math.abs(diff) < 2) msg = `Sem padrão claro — FC média similar (${avgAlto.toFixed(0)}% vs ${avgBaixo.toFixed(0)}% da FCM).`;
    else if (diff > 2)       msg = `Dias com menos sono profundo têm FC mais alta (${avgBaixo.toFixed(0)}% vs ${avgAlto.toFixed(0)}%) — sinal de esforço maior.`;
    else                     msg = `Dias com mais sono profundo têm FC mais alta — pode indicar treinos mais intensos quando bem descansado.`;

    $('sleep-msg').textContent = msg;

    const canvas = $('sleepPerfChart');
    if (!canvas || !window.Chart) return true;
    if (_charts.sleep) _charts.sleep.destroy();
    _charts.sleep = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [{
          data: pontos,
          backgroundColor: 'rgba(78,158,245,0.7)',
          borderColor: COLORS.blue,
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `${c.raw.nome}: ${c.raw.x}min sono → ${c.raw.y}% FCM` } },
        },
        scales: {
          x: { title: { display: true, text: 'Sono profundo (min)', color: COLORS.muted2 }, ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
          y: { title: { display: true, text: '% FC máx', color: COLORS.muted2 }, ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
        },
      },
    });
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
            backgroundColor: 'rgba(20,217,184,0.10)',
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
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => c.datasetIndex === 0 ? `${c.parsed.y} kcal/km` : `baseline ${baseline.toFixed(0)}` } },
        },
        scales: {
          y: { ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
          x: { ticks: { color: COLORS.muted2, maxRotation: 45 }, grid: { display: false } },
        },
      },
    });
    return true;
  }

  // ───────────────────────────────────────────────────────────────
  // 7.6 — HRV × CARGA DE TREINO (correlação visual)
  // ───────────────────────────────────────────────────────────────
  function renderHrvVsCarga(activities, health, fcMax) {
    if (!health.length || !fcMax) return false;

    // TRIMP do dia anterior por data
    const trimpByDate = {};
    activities.forEach(a => {
      const t = trimpDeAtividade(a, fcMax);
      if (t > 0) trimpByDate[a.data] = (trimpByDate[a.data] || 0) + t;
    });

    // Pontos: HRV de hoje vs TRIMP de ontem
    const pontos = [];
    health.forEach(h => {
      if (h.hrv_noite_avg == null) return;
      const ontem = new Date(h.data + 'T12:00:00');
      ontem.setDate(ontem.getDate() - 1);
      const ontemIso = ontem.toISOString().slice(0, 10);
      const trimp = trimpByDate[ontemIso] || 0;
      pontos.push({ x: +trimp.toFixed(1), y: h.hrv_noite_avg, data: h.data });
    });

    if (pontos.length < 5) {
      $('hrv-load-msg').textContent = 'Precisa de pelo menos 5 dias com HRV registrado.';
      return false;
    }

    // Pearson approximation: dias com TRIMP > 0
    const comCarga = pontos.filter(p => p.x > 0);
    const semCarga = pontos.filter(p => p.x === 0);
    const avgHrvComCarga = comCarga.length ? comCarga.reduce((s, p) => s + p.y, 0) / comCarga.length : null;
    const avgHrvSemCarga = semCarga.length ? semCarga.reduce((s, p) => s + p.y, 0) / semCarga.length : null;

    let msg = '';
    if (avgHrvComCarga != null && avgHrvSemCarga != null) {
      const delta = avgHrvSemCarga - avgHrvComCarga;
      if (Math.abs(delta) < 2)      msg = `HRV similar em dias de descanso (${avgHrvSemCarga.toFixed(0)}ms) vs após treino (${avgHrvComCarga.toFixed(0)}ms) — boa adaptação.`;
      else if (delta > 5)            msg = `HRV cai ~${delta.toFixed(0)}ms após dias de treino — recuperação parcial entre sessões.`;
      else                           msg = `Padrão saudável — HRV recupera bem após cargas de treino.`;
    }
    $('hrv-load-msg').textContent = msg;

    const canvas = $('hrvLoadChart');
    if (!canvas || !window.Chart) return true;
    if (_charts.hrvLoad) _charts.hrvLoad.destroy();
    _charts.hrvLoad = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [{
          data: pontos,
          backgroundColor: pontos.map(p => p.x === 0 ? COLORS.muted2 : COLORS.amber),
          pointRadius: 5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `${c.raw.data}: TRIMP ${c.raw.x} → HRV ${c.raw.y}ms` } },
        },
        scales: {
          x: { title: { display: true, text: 'TRIMP do dia anterior', color: COLORS.muted2 }, ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
          y: { title: { display: true, text: 'HRV noturno (ms)', color: COLORS.muted2 }, ticks: { color: COLORS.muted2 }, grid: { color: COLORS.border } },
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

    // Mostra todos os recordes com label conhecido
    const visible = items.filter(p => TYPE_LABELS[p.type_id] != null);
    $('prs-count').textContent = visible.length;

    const now = Date.now();
    const DAYS_30 = 30 * 86400_000;

    const parseIsoDate = raw => {
      if (!raw) return null;
      // Suporta "YYYY-MM-DD HH:MM:SS" e "YYYY-MM-DDTHH:MM:SS"
      const iso = raw.split(/[T ]/)[0];
      return new Date(iso + 'T12:00:00');
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

    $('endurance-value').textContent = eVal ?? '—';
    if (eVal != null) {
      const pct = Math.max(0, Math.min(100, ((eVal - eMin) / (eMax - eMin)) * 100));
      $('endurance-fill').style.width = pct + '%';
      $('endurance-fill').style.background = COLORS.teal;
    }
    $('endurance-meta').textContent = `${eMin}–${eMax} · ${CLASS_LABELS[eClass] || ''}`;

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
      try { renderFadiga(healthArr); }                              catch (e) { console.error('[insights] 7.1', e); }
      try { renderTSS(activities, fcMax); }                         catch (e) { console.error('[insights] 7.4', e); }
      try { renderTrimpSemanal(activities, weights, fcMax); }       catch (e) { console.error('[insights] 7.3', e); }
      try { renderSonoVsFC(activities, healthArr, fcMax); }         catch (e) { console.error('[insights] 7.2', e); }
      try { renderCustoMetabolico(activities); }                    catch (e) { console.error('[insights] 7.5', e); }
      try { renderHrvVsCarga(activities, healthArr, fcMax); }       catch (e) { console.error('[insights] 7.6', e); }
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
