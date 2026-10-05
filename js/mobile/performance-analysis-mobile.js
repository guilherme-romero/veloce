/* ═══════════════════════════════════════════════════════════════════════
   ANÁLISE DE PERFORMANCE MOBILE — espelha js/performance-analysis.js
   (desktop), trocando os ids por m-pa-* e o markup por tiles em grid 2
   colunas (handoff_desempenho_mobile/README.md). Mesmo motor puro
   (window.PerformanceAnalysis, js/core/) e os mesmos 2 endpoints HTTP do
   desktop — nenhuma lógica nova aqui, só camada de apresentação.

   Diferente do desktop (v2.9.18, botão virou ícone-só porque a análise já
   roda sozinha às 6h): no mobile o botão "Analisar de novo" continua com
   texto — o espaço vertical da tela comporta, decisão do handoff mobile.
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

  // Sem innerHTML pro texto da IA — mesma disciplina de XSS do desktop.
  function renderTexto(container, texto) {
    container.replaceChildren();
    String(texto || '').split('\n').filter(l => l.trim()).forEach(linha => {
      const p = document.createElement('p');
      p.className = 'mdesemp-obs';
      p.textContent = linha;
      container.appendChild(p);
    });
  }

  function rotuloProvider(payload) {
    if (!payload.provider || !payload.model) return '';
    const nome = payload.provider === 'gemini' ? 'Gemini' : 'Groq';
    return ' · gerado via ' + nome + ' · ' + payload.model;
  }

  function fmtFaixa(min, max, casasDecimais) {
    if (min == null || max == null) return '—';
    const f = (v) => casasDecimais ? v.toFixed(1).replace('.', ',') : Math.round(v);
    return min === max ? String(f(min)) : `${f(min)}–${f(max)}`;
  }

  function mostrarResultado(payload, geradoEm, vencida) {
    const empty   = $('m-pa-empty');
    const content = $('m-pa-content');
    if (!empty || !content) return;
    empty.hidden = true;
    content.hidden = false;

    const observacao = payload.observacao ?? payload.texto;
    renderTexto($('m-pa-texto'), observacao);

    const destaques = window.PerformanceAnalysis.calcularDestaques(payload.deltas || {});
    const velEl = $('m-pa-stat-vel');
    if (velEl) velEl.textContent = fmtFaixa(destaques.velMinKmh, destaques.velMaxKmh, true);
    const fcEl = $('m-pa-stat-fc');
    if (fcEl) fcEl.textContent = fmtFaixa(destaques.fcMinBpm, destaques.fcMaxBpm, false);

    const focoBox  = $('m-pa-foco');
    const focoText = $('m-pa-foco-text');
    if (payload.foco) {
      if (focoText) focoText.textContent = payload.foco;
      if (focoBox) focoBox.hidden = false;
    } else if (focoBox) {
      focoBox.hidden = true;
    }

    const label = $('m-pa-label');
    if (label) {
      const n = payload.grupoResumo?.tamanho;
      label.textContent = 'Análise · ' + (n ? `${n} saídas` : '—');
    }

    const meta = $('m-pa-meta');
    if (meta) {
      meta.textContent = 'Gerada em ' + fmtDataHora(geradoEm) + rotuloProvider(payload);
      meta.style.color = '';
      if (vencida) {
        meta.textContent += ' — desatualizada, toque em Analisar pra atualizar';
        meta.style.color = 'var(--amber)';
      }
    }
  }

  function mostrarVazio(msg) {
    const empty   = $('m-pa-empty');
    const content = $('m-pa-content');
    if (!empty || !content) return;
    empty.hidden = false;
    empty.textContent = msg;
    content.hidden = true;
  }

  let _analiseAtual = null; // { referenciaId, deltas, grupoResumo } — insumo pro clique do botão

  // BUG-078 (mesmo padrão de insights-mobile.js): esta view não tem rota
  // própria no MRouter — é chamada por desempenho-mobile.js, que invalida
  // via invalidate() no onLeave. Sem isso, trocar rápido pra Insights e
  // voltar antes da resposta chegar deixaria uma busca antiga sobrescrever
  // o resultado mais recente.
  let _gen = 0;
  function invalidate() { _gen++; }

  // activitiesPreCarregadas: desempenho-mobile.js já busca /activities/
  // unified?days=365 (superconjunto desta janela) e repassa o array direto,
  // evitando um segundo fetch idêntico. Sem o parâmetro (uso standalone),
  // busca por conta própria — mantém o contrato antigo como fallback.
  async function load(activitiesPreCarregadas) {
    const btn = $('m-pa-btn');
    if (!btn) return;
    const gen = ++_gen;

    // Vincula só uma vez — load() é re-chamado a cada visita à seção.
    if (!btn._wiredPerformanceAnalysisMobile) {
      btn._wiredPerformanceAnalysisMobile = true;
      btn.addEventListener('click', analisar);
    }

    btn.hidden = true;
    _analiseAtual = null;

    try {
      let activities = activitiesPreCarregadas;
      if (!activities) {
        const unified = await window.Api.get('/activities/unified?days=365').catch(() => ({ items: [] }));
        if (gen !== _gen) return;
        activities = (unified && unified.items) || [];
      }

      const resultado = window.PerformanceAnalysis.analisar({ activities });
      if (!resultado.ok) {
        mostrarVazio('Ainda não há saídas parecidas o suficiente pra comparar — pedale mais e volte aqui.');
        return;
      }

      const ultima = resultado.grupo[resultado.grupo.length - 1];
      const grupoResumo = {
        tamanho:     resultado.grupo.length,
        distanciaKm: Math.round(ultima.distanciaKm),
        elevacaoM:   Math.round(ultima.elevacaoM || 0),
      };
      _analiseAtual = { referenciaId: resultado.referenciaId, deltas: resultado.deltas, grupoResumo };
      btn.hidden = false;
      const label = $('m-pa-label');
      if (label) label.textContent = `Análise · ${grupoResumo.tamanho} saídas`;

      const cache = await window.Api.get('/performance-analysis?referenciaId=' + encodeURIComponent(resultado.referenciaId)).catch(() => null);
      if (gen !== _gen) return;
      if (cache && cache.ok) {
        mostrarResultado(cache.payload, cache.geradoEm, cache.vencida);
      } else {
        mostrarVazio('A análise é gerada automaticamente às 6h — toque em "Analisar de novo" pra forçar agora.');
      }
    } catch (err) {
      if (gen !== _gen) return;
      console.error('[performance-analysis-mobile]', err);
      mostrarVazio('Falha ao calcular o grupo de comparação.');
    }
  }

  async function analisar() {
    if (!_analiseAtual) return;
    const btn = $('m-pa-btn');
    if (!btn || btn.disabled) return;
    const gen = _gen; // clique só acontece com a view ativa — não cria geração nova

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const resp = await window.Api.post('/performance-analysis', _analiseAtual);
      if (gen !== _gen) return;
      if (resp && resp.ok) {
        mostrarResultado(resp.payload, resp.geradoEm, false);
      }
    } catch (err) {
      if (gen !== _gen) return;
      console.error('[performance-analysis-mobile]', err);
      const corpo = err && err.body;
      if (corpo && corpo.cache) {
        mostrarResultado(corpo.cache.payload, corpo.cache.geradoEm, true);
      } else {
        mostrarVazio((corpo && corpo.error) || err.message || 'Análise indisponível no momento.');
      }
    } finally {
      if (gen === _gen) {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    }
  }

  window.PerformanceAnalysisMobile = { load, invalidate };
})();
