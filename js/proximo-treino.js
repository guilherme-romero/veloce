/* ═══════════════════════════════════════════════════════════════════════
   PRÓXIMO TREINO — seção da IDEIA-1+2 (backlog). Mostra a Sugestão de
   Treino do momento, calculada por TrainingSuggestion (js/core/), a partir
   dos mesmos dados que a seção Insights já busca.

   Sem cache: recalcula a cada onEnter (decisão do design — regra é barata,
   não vale o risco de mostrar sugestão desatualizada logo após um sync).
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

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

  const EMPTY_MSG_DEFAULT = 'Sincronize com o Garmin e treine por pelo menos 7 dias para ver a sugestão aqui.';

  async function load() {
    const empty   = $('proximo-treino-empty');
    const content = $('proximo-treino-content');
    if (!empty || !content) return;

    empty.textContent = EMPTY_MSG_DEFAULT;

    try {
      const [unified, health, zoneDist] = await Promise.all([
        window.Api.get('/activities/unified?days=180').catch(() => ({ items: [] })),
        // 104 dias: os 60 originais + margem pro Cruzamento sugestão×execução
        // (janela de 90 dias, e fatigueIndex olha até 14 dias antes de cada dia
        // analisado). Não muda o card de Sugestão do dia, que só lê os
        // primeiros 7-14 itens do array.
        window.Api.get('/garmin/health?days=104').catch(() => []),
        window.Api.get('/garmin/zone-distribution?days=30').catch(() => null),
      ]);

      const activities = (unified && unified.items) || [];
      // Mesmo pré-processamento de insights.js: mais recente primeiro.
      const healthArr = Array.isArray(health) ? [...health].sort((a, b) => b.data.localeCompare(a.data)) : [];

      const user  = window.Storage ? Storage.getUser() : {};
      const fcMax = window.Metrics.calcFCMax(user);

      const sug = window.TrainingSuggestion.suggest({
        activities, health: healthArr, zoneDist, fcMax,
      });

      if (!sug.ok) {
        empty.hidden = false;
        content.hidden = true;
        const historicoVazio = $('proximo-treino-historico');
        if (historicoVazio) { historicoVazio.hidden = true; historicoVazio.textContent = ''; }
        return;
      }
      empty.hidden = true;
      content.hidden = false;

      const color = COLORS[sug.token] || COLORS.green;
      const badge = $('proximo-treino-categoria');
      if (badge) {
        badge.textContent = CATEGORIA_LABEL[sug.categoria] || sug.categoria;
        badge.style.background = color + '20';
        badge.style.color = color;
      }
      const msgEl = $('proximo-treino-msg');
      if (msgEl) msgEl.textContent = sug.msg;

      const historico = $('proximo-treino-historico');
      if (historico) {
        const hist = window.SuggestionHistory.analyze({ activities, health: healthArr, fcMax, days: 90 });
        if (hist.ok) {
          historico.hidden = false;
          historico.textContent = `Nos últimos ${hist.janelaDias} dias, você seguiu a recomendação de `
            + `recuperação em ${hist.seguiu} de ${hist.total} ocasiões (${hist.percentual}%).`;
        } else {
          historico.hidden = true;
          historico.textContent = '';
        }
      }
    } catch (err) {
      console.error('[proximo-treino]', err);
      empty.textContent = 'Falha ao calcular a sugestão de treino.';
      empty.hidden = false;
      content.hidden = true;
      const historicoErro = $('proximo-treino-historico');
      if (historicoErro) { historicoErro.hidden = true; historicoErro.textContent = ''; }
    }
  }

  window.ProximoTreino = { load };
})();
