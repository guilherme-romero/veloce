/* ═══════════════════════════════════════════════════════════════════════
   DESEMPENHO (Fase 3 da evolução IDEIA-1+2) — porta pro mobile o mesmo
   motor puro do desktop (js/core/training-suggestion.js e
   js/core/suggestion-history.js, Fases 1-2 já entregues): Sugestão de
   Treino + Cruzamento sugestão×execução, ambos calibrados via
   GET /garmin/calibration. Nenhuma lógica nova aqui — só orquestração de
   fetch + render, mesma duplicação já aceita entre insights.js e
   insights-mobile.js (o projeto não compartilha essa camada entre
   desktop/mobile, só o motor em js/core/).

   Sem MShell.cached de propósito: a Sugestão de Treino é uma regra barata
   que deve recalcular a cada abertura — é uma propriedade do próprio
   conceito no GLOSSARY.md, não uma escolha de plataforma (aplicar cache só
   aqui criaria duas fontes de verdade pra mesma seção).
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-desempenho';

  const COLORS = {
    amber: '#f5d523',
    red:   '#f0523a',
    green: '#22c55e',
  };

  const CATEGORIA_LABEL = {
    'recuperacao': 'Recuperação',
    'volume':      'Volume',
    'zona-alvo':   'Zona-alvo',
  };

  function skeleton() {
    return `
      <div class="m-card">
        <div class="m-card-head">
          <span class="m-eyebrow">Sugestão de treino</span>
          <span id="m-desemp-categoria"></span>
        </div>
        <p id="m-desemp-msg"></p>
        <p id="m-desemp-historico" hidden></p>
      </div>`;
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    try {
      // fcMax antes do Promise.all — a calibração precisa dele na query
      // string (mesma ordem de js/proximo-treino.js).
      const user  = window.Storage ? Storage.getUser() : {};
      const fcMax = window.Metrics.calcFCMax(user);

      const [unified, health, zoneDist, calibracao] = await Promise.all([
        window.Api.get('/activities/unified?days=180').catch(() => ({ items: [] })),
        // 104 dias: 90 do Cruzamento sugestão×execução + margem de lookback
        // do fatigueIndex — mesmo raciocínio de js/proximo-treino.js.
        window.Api.get('/garmin/health?days=104').catch(() => []),
        window.Api.get('/garmin/zone-distribution?days=30').catch(() => null),
        fcMax ? window.Api.get('/garmin/calibration?fcMax=' + fcMax).catch(() => null) : Promise.resolve(null),
      ]);

      const activities = (unified && unified.items) || [];
      const healthArr = Array.isArray(health) ? [...health].sort((a, b) => b.data.localeCompare(a.data)) : [];
      const limiares = calibracao ? {
        zonaAltaMinPct: calibracao.zonaAltaMinPct,
        tsbSobrecarga:  calibracao.tsbSobrecarga,
      } : undefined;

      const sug = window.TrainingSuggestion.suggest({
        activities, health: healthArr, zoneDist, fcMax, limiares,
      });

      if (!sug.ok) {
        view.innerHTML = `<div class="m-empty">Sincronize com o Garmin e treine por pelo menos 7 dias para ver a sugestão aqui.</div>`;
        return;
      }

      view.innerHTML = skeleton();

      const color = COLORS[sug.token] || COLORS.green;
      const badge = document.getElementById('m-desemp-categoria');
      badge.textContent = CATEGORIA_LABEL[sug.categoria] || sug.categoria;
      badge.style.background = color + '20';
      badge.style.color = color;
      document.getElementById('m-desemp-msg').textContent = sug.msg;

      const historico = document.getElementById('m-desemp-historico');
      const limiarTss = calibracao ? calibracao.tssRecuperacaoIgnorada : undefined;
      const hist = window.SuggestionHistory.analyze({ activities, health: healthArr, fcMax, days: 90, limiarTss });
      if (hist.ok) {
        historico.hidden = false;
        historico.textContent = `Nos últimos ${hist.janelaDias} dias, você seguiu a recomendação de `
          + `recuperação em ${hist.seguiu} de ${hist.total} ocasiões (${hist.percentual}%).`;
      }
    } catch (err) {
      console.error('[desempenho-mobile]', err);
      view.innerHTML = `<div class="m-empty">Falha ao calcular a sugestão de treino.</div>`;
    }
  }

  MRouter.register({
    slug: 'desempenho',
    viewId: VIEW_ID,
    label: 'Desempenho',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Sugestão do dia', title: 'DESEMPENHO' });
      load();
    },
  });
})();
