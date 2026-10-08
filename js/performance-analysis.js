/* ═══════════════════════════════════════════════════════════════════════
   ANÁLISE DE PERFORMANCE — bloco da Fase 4 (IDEIA-1+2), dentro da seção
   Desempenho, abaixo do card de Sugestão do dia. Reaproveita o motor puro
   PerformanceAnalysis (js/core/) pra achar a Atividade de referência e o
   Grupo de comparação, e delega a interpretação pro backend (que chama o
   Gemini) — nunca faz a análise no frontend.

   Diferente de js/proximo-treino.js: não recalcula tudo a cada onEnter — só
   BUSCA o cache existente (GET, sem custo) automaticamente. Gerar uma
   análise nova (POST, chama a IA de verdade e gasta cota) roda sozinho todo
   dia às 6h (server/scheduler.js) — o botão (ícone, não mais CTA principal)
   só força isso manualmente fora do horário.
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

  // Sem innerHTML pro texto da IA, mesmo sendo API "confiável" — mesma
  // disciplina de XSS do resto do projeto. Um <p> por linha, via textContent.
  function renderTexto(container, texto) {
    container.replaceChildren();
    String(texto || '').split('\n').filter(l => l.trim()).forEach(linha => {
      const p = document.createElement('p');
      p.className = 'desemp-obs';
      p.textContent = linha;
      container.appendChild(p);
    });
  }

  // Payloads antigos (gerados antes da Rotação de modelo de IA, ADR-0004)
  // não têm provider/model — trata como opcional.
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
    const empty   = $('performance-analysis-empty');
    const content = $('performance-analysis-content');
    empty.hidden = true;
    content.hidden = false;

    // Payload antigo (pré-handoff_desempenho) só tinha `texto` — trata como
    // "observacao" sem "foco", pra não quebrar análises já cacheadas.
    const observacao = payload.observacao ?? payload.texto;
    renderTexto($('performance-analysis-texto'), observacao);

    const destaques = window.PerformanceAnalysis.calcularDestaques(payload.deltas || {});
    const velEl = $('pa-stat-vel');
    if (velEl) velEl.textContent = fmtFaixa(destaques.velMinKmh, destaques.velMaxKmh, true);
    const fcEl = $('pa-stat-fc');
    if (fcEl) fcEl.textContent = fmtFaixa(destaques.fcMinBpm, destaques.fcMaxBpm, false);

    const focoBox  = $('performance-analysis-foco');
    const focoText = $('performance-analysis-foco-text');
    if (payload.foco) {
      if (focoText) focoText.textContent = payload.foco;
      if (focoBox) focoBox.hidden = false;
    } else if (focoBox) {
      focoBox.hidden = true;
    }

    const label = $('performance-analysis-label');
    if (label) {
      const n = payload.grupoResumo?.tamanho;
      label.textContent = 'Análise de performance' + (n ? ` · ${n} saídas` : '');
    }

    const meta = $('performance-analysis-meta');
    meta.textContent = 'Gerada em ' + fmtDataHora(geradoEm) + rotuloProvider(payload);
    meta.style.color = '';
    if (vencida) {
      meta.textContent += ' — desatualizada, toque em Analisar pra atualizar';
      meta.style.color = 'var(--amber, #f5d523)';
    }
  }

  function mostrarVazio(msg) {
    const empty   = $('performance-analysis-empty');
    const content = $('performance-analysis-content');
    empty.hidden = false;
    empty.textContent = msg;
    content.hidden = true;
  }

  let _analiseAtual = null; // { referenciaId, deltas, grupoResumo } — insumo pro clique do botão

  async function load() {
    const btn = $('performance-analysis-btn');
    if (!btn) return;

    // Vincula só uma vez — load() é re-chamado a cada visita à seção.
    if (!btn._wiredPerformanceAnalysis) {
      btn._wiredPerformanceAnalysis = true;
      btn.addEventListener('click', analisar);
    }

    btn.hidden = true;
    _analiseAtual = null;

    try {
      const unified = await window.UnifiedActivities.get(365).catch(() => ({ items: [] }));
      const activities = (unified && unified.items) || [];

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
      const label = $('performance-analysis-label');
      if (label) label.textContent = `Análise de performance · ${grupoResumo.tamanho} saídas`;

      const cache = await window.Api.get('/performance-analysis?referenciaId=' + encodeURIComponent(resultado.referenciaId)).catch(() => null);
      if (cache && cache.ok) {
        mostrarResultado(cache.payload, cache.geradoEm, cache.vencida);
      } else {
        mostrarVazio('A análise é gerada automaticamente às 6h — toque no ícone pra forçar agora.');
      }
    } catch (err) {
      console.error('[performance-analysis]', err);
      mostrarVazio('Falha ao calcular o grupo de comparação.');
    }
  }

  async function analisar() {
    if (!_analiseAtual) return;
    const btn = $('performance-analysis-btn');
    if (!btn || btn.disabled) return;

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const resp = await window.Api.post('/performance-analysis', _analiseAtual);
      if (resp && resp.ok) {
        mostrarResultado(resp.payload, resp.geradoEm, false);
      }
    } catch (err) {
      console.error('[performance-analysis]', err);
      const corpo = err && err.body;
      if (corpo && corpo.cache) {
        mostrarResultado(corpo.cache.payload, corpo.cache.geradoEm, true);
      } else {
        mostrarVazio((corpo && corpo.error) || err.message || 'Análise indisponível no momento.');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  window.PerformanceAnalysisUI = { load };
})();
