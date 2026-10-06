/* ═══════════════════════════════════════════════════════════════════════
   TREINO IA — seção desktop, Plano de Treino Semanal (IDEIA-7, Issue #1).

   Gatilho exclusivamente sob demanda (botão "Gerar plano") — sem job
   automático. Diferente de performance-analysis.js: sem conceito de cache
   "vencido" por tempo, o plano vale até o usuário gerar outro manualmente.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  function fmtDataHora(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
        + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return iso; }
  }

  function rotuloProvider(payload) {
    if (!payload.provider || !payload.model) return '';
    const nome = payload.provider === 'gemini' ? 'Gemini' : 'Groq';
    return ' · gerado via ' + nome + ' · ' + payload.model;
  }

  const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
  const LABEL_DIA = {
    segunda: 'Segunda-feira', terca: 'Terça-feira', quarta: 'Quarta-feira', quinta: 'Quinta-feira',
    sexta: 'Sexta-feira', sabado: 'Sábado', domingo: 'Domingo',
  };
  // Mesma ordem/cores de js/comparative-performance.js (CATEGORIA_CORES) —
  // Resistência=azul, Limiar lático=amber, Esforço máximo=vermelho.
  const CATEGORIA_ORDEM = ['resistencia', 'limiarLatico', 'esforcoMaximo'];
  const CATEGORIA_CORES = ['var(--blue)', 'var(--amber)', 'var(--red)'];

  // Rosca CSS pura (conic-gradient), adaptada de renderZonePie (js/activities.js)
  // — mas sobre minutos PLANEJADOS de 3 categorias, não segundos reais de 5
  // zonas. Decisão de não extrair em módulo compartilhado: ver plano/PR.
  function renderCategoriaDonut(distribuicaoZonas) {
    const list = (distribuicaoZonas || []).filter((z) => (z.minutos || 0) > 0);
    const total = list.reduce((s, z) => s + (z.minutos || 0), 0);
    if (!total) return '<div class="treino-ia-donut-vazio">Descanso</div>';
    let acc = 0;
    const stops = CATEGORIA_ORDEM.map((cat, i) => {
      const item = list.find((z) => z.categoria === cat);
      if (!item) return null;
      const start = acc;
      acc += (item.minutos / total) * 100;
      return `${CATEGORIA_CORES[i]} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
    }).filter(Boolean).join(', ');
    return `<div class="treino-ia-donut" style="background:conic-gradient(${stops})"></div>`;
  }

  function mostrarVazio(msg) {
    const empty   = $('treino-ia-empty');
    const content = $('treino-ia-content');
    if (!empty || !content) return;
    empty.hidden = false;
    if (msg) empty.textContent = msg;
    content.hidden = true;
  }

  function mostrarResultado(payload, geradoEm) {
    const empty   = $('treino-ia-empty');
    const content = $('treino-ia-content');
    if (!empty || !content) return;
    empty.hidden = true;
    content.hidden = false;

    const obs = $('treino-ia-observacao-geral');
    if (obs) obs.textContent = payload.observacaoGeral || '';

    const dias = $('treino-ia-dias');
    if (dias) {
      dias.replaceChildren();
      const porDia = {};
      (payload.plano || []).forEach((d) => { porDia[d.diaSemana] = d; });

      DIAS_SEMANA.forEach((slug) => {
        const dia = porDia[slug];
        if (!dia) return;

        const card = document.createElement('div');
        card.className = 'treino-ia-dia';

        const donutWrap = document.createElement('div');
        donutWrap.innerHTML = renderCategoriaDonut(dia.distribuicaoZonas);
        card.appendChild(donutWrap.firstElementChild);

        const info = document.createElement('div');
        info.className = 'treino-ia-dia__info';

        const nome = document.createElement('div');
        nome.className = 'treino-ia-dia__nome';
        nome.textContent = LABEL_DIA[slug] || slug;
        info.appendChild(nome);

        const tipo = document.createElement('div');
        tipo.className = 'treino-ia-dia__tipo';
        tipo.textContent = dia.tipoTreino + (dia.duracaoMin ? ' · ' + dia.duracaoMin + ' min' : '');
        info.appendChild(tipo);

        if (dia.descricao) {
          const desc = document.createElement('div');
          desc.className = 'treino-ia-dia__descricao';
          desc.textContent = dia.descricao;
          info.appendChild(desc);
        }

        card.appendChild(info);
        dias.appendChild(card);
      });
    }

    const meta = $('treino-ia-meta');
    if (meta) meta.textContent = 'Gerado em ' + fmtDataHora(geradoEm) + rotuloProvider(payload);
  }

  function perfilCompleto(u) {
    return Array.isArray(u.objetivosPrioridade) && u.objetivosPrioridade.length > 0
      && Array.isArray(u.diasDisponiveis) && u.diasDisponiveis.length > 0
      && !!u.duracaoSessaoMin && !!u.diaLongao && !!u.nivelExperiencia;
  }

  // Insumos 100% calculados no frontend — a IA nunca recebe dados brutos pra
  // recalcular (ADR-0002/0004, mesma regra da Análise de Performance).
  async function montarInsumos(u) {
    const unified = await window.Api.get('/activities/unified?days=365').catch(() => ({ items: [] }));
    const activities = (unified && unified.items) || [];
    const { ctl, atl, tsb } = window.Metrics.calcTSBMetrics(activities, u.fcMax);

    const pesoAnalise = window.WeightStats.weightAnalysis(u, window.Storage.getWeights());
    const tendenciaPeso = pesoAnalise.ok ? { taxaKgSem: pesoAnalise.taxaKgSem, msg: pesoAnalise.msg } : null;

    const calib = u.fcMax ? await window.Api.get('/garmin/calibration?fcMax=' + u.fcMax).catch(() => null) : null;
    const limiares = calib ? {
      zonaAltaMinPct: calib.zonaAltaMinPct,
      tssRecuperacaoIgnorada: calib.tssRecuperacaoIgnorada,
      tsbSobrecarga: calib.tsbSobrecarga,
      fallback: calib.fallback,
    } : null;

    return { ctl, atl, tsb, tendenciaPeso, limiares };
  }

  async function gerar() {
    const btn = $('treino-ia-btn-gerar');
    if (!btn || btn.disabled) return;
    const u = window.Storage.getUser();

    if (!perfilCompleto(u)) {
      window.toast?.('Complete suas preferências de Treino IA no perfil antes de gerar um plano', { kind: 'error' });
      window.openProfileModal?.();
      return;
    }

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando…';

    try {
      const insumos = await montarInsumos(u);
      // O backend lê o perfil (objetivos/dias/duração/...) direto do perfil já
      // validado no banco — o corpo do POST só leva `insumos` (ver
      // server/routes/weekly-training-plan.js:lerPerfilTreinoIa).
      const resp = await window.Api.post('/weekly-training-plan', { insumos });
      if (resp && resp.ok) {
        mostrarResultado(resp.payload, resp.geradoEm);
        window.toast?.('Plano gerado');
      }
    } catch (err) {
      console.error('[weekly-training-plan]', err);
      const corpo = err && err.body;
      if (corpo && corpo.cache) {
        mostrarResultado(corpo.cache.payload, corpo.cache.geradoEm);
        window.toast?.('Não foi possível gerar um novo plano agora — mostrando o último salvo', { kind: 'error' });
      } else {
        mostrarVazio((corpo && corpo.error) || err.message || 'Plano indisponível no momento.');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  async function carregarHistorico() {
    const el = $('treino-ia-historico');
    if (!el) return;
    el.hidden = !el.hidden;
    if (el.hidden || el.dataset.loaded) return;

    const resp = await window.Api.get('/weekly-training-plan/historico').catch(() => ({ ok: false }));
    el.replaceChildren();
    const itens = (resp && resp.ok && resp.itens) || [];
    if (!itens.length) {
      el.textContent = 'Nenhum plano anterior.';
    } else {
      itens.forEach((it) => {
        const p = document.createElement('p');
        p.textContent = 'Plano #' + it.id + ' — ' + fmtDataHora(it.gerado_em);
        el.appendChild(p);
      });
    }
    el.dataset.loaded = '1';
  }

  async function load() {
    const btn = $('treino-ia-btn-gerar');
    if (btn && !btn._wiredWeeklyTrainingPlan) {
      btn._wiredWeeklyTrainingPlan = true;
      btn.addEventListener('click', gerar);
    }
    const histBtn = $('treino-ia-historico-toggle');
    if (histBtn && !histBtn._wiredWeeklyTrainingPlan) {
      histBtn._wiredWeeklyTrainingPlan = true;
      histBtn.addEventListener('click', carregarHistorico);
    }

    try {
      const resp = await window.Api.get('/weekly-training-plan').catch(() => ({ ok: false }));
      if (resp && resp.ok) {
        mostrarResultado(resp.payload, resp.geradoEm);
      } else {
        mostrarVazio();
      }
    } catch (err) {
      console.error('[weekly-training-plan]', err);
      mostrarVazio('Falha ao carregar o plano de treino.');
    }
  }

  window.WeeklyTrainingPlanUI = { load };
})();
