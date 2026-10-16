/* ═══════════════════════════════════════════════════════════════════════
   COMPARATIVO DE DESEMPENHO — bloco da seção Desempenho, abaixo da Análise
   de Performance (GLOSSARY.md "Comparativo de Desempenho"). Reaproveita o
   motor puro ComparativePerformance (js/core/) e renderiza 5 tiles via
   CSS/SVG puro (handoff_desempenho) — sem Chart.js nesse bloco.

   Versão desktop. Espelhada no mobile por js/mobile/comparative-performance-
   mobile.js (carrossel em vez de grid de 5 colunas) — mesmo motor puro
   (js/core/comparative-performance.js), cada plataforma só duplica a
   camada de apresentação.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  const CATEGORIA_LABELS = ['Resistência', 'Limiar lático', 'Esforço máximo'];
  // Tokens já existentes no :root (css/style.css) — nunca hex literal.
  const CATEGORIA_CORES = ['var(--blue)', 'var(--amber)', 'var(--red)'];

  // Larguras das 2 barrinhas "anterior/atual" (handoff_desempenho §3.4):
  // anterior = 100% normalmente; atual = atual/anterior×100% com teto de
  // 100%. Se atual > anterior, inverte a referência (atual vira 100%) pra
  // nunca estourar a barra.
  function larguras(atual, anterior) {
    if (anterior <= 0 && atual <= 0) return { anteriorPct: 0, atualPct: 0 };
    if (anterior <= 0) return { anteriorPct: 0, atualPct: 100 };
    if (atual <= anterior) return { anteriorPct: 100, atualPct: Math.min(100, (atual / anterior) * 100) };
    return { anteriorPct: Math.max(0, (anterior / atual) * 100), atualPct: 100 };
  }

  function setBar(idAnterior, idAtual, atual, anterior) {
    const { anteriorPct, atualPct } = larguras(atual, anterior);
    const elAnterior = $(idAnterior);
    const elAtual = $(idAtual);
    if (elAnterior) elAnterior.style.width = anteriorPct + '%';
    if (elAtual) elAtual.style.width = atualPct + '%';
  }

  // Texto "era {anterior} · {seta}{pct}%" — seta/cor neutra de direção só
  // pros 3 tiles de alta/baixa (Volume/Tempo/Altimetria); Zona/Peso usam
  // texto sem juízo de valor (ver renderZona/renderPeso).
  function textoDelta(elId, anteriorFmt, metrica) {
    const el = $(elId);
    if (!el) return;
    el.replaceChildren();
    el.append(`era ${anteriorFmt} · `);
    const span = document.createElement('span');
    const seta = metrica.direcao === 'alta' ? '↑' : (metrica.direcao === 'baixa' ? '↓' : '—');
    // percentual é null quando o período anterior foi 0 (divisão por zero
    // evitada) — mostra o delta absoluto em vez de deixar a seta sem número.
    const pct = metrica.percentual != null ? Math.abs(metrica.percentual) + '%' : String(Math.round(Math.abs(metrica.delta) * 10) / 10);
    span.className = metrica.direcao === 'alta' ? 'desemp-delta-up' : (metrica.direcao === 'baixa' ? 'desemp-delta-down' : '');
    span.textContent = seta + pct;
    el.append(span);
  }

  function renderNumeroTile(valorElId, valor, unidade) {
    const el = $(valorElId);
    if (!el) return;
    el.replaceChildren(document.createTextNode(valor));
    const small = document.createElement('small');
    small.textContent = unidade;
    el.append(small);
  }

  function renderBarrasVolumeTempoAltimetria(r) {
    renderNumeroTile('compVolumeValue', Math.round(r.volume.atual), 'KM');
    textoDelta('compVolumeDelta', Math.round(r.volume.anterior) + ' km', r.volume);
    setBar('compVolumeBarAnterior', 'compVolumeBarAtual', r.volume.atual, r.volume.anterior);

    const tempoAtual = Math.round(r.tempo.atual * 10) / 10;
    const tempoAnterior = Math.round(r.tempo.anterior * 10) / 10;
    renderNumeroTile('compTempoValue', String(tempoAtual).replace('.', ','), 'H');
    textoDelta('compTempoDelta', String(tempoAnterior).replace('.', ',') + ' h', r.tempo);
    setBar('compTempoBarAnterior', 'compTempoBarAtual', r.tempo.atual, r.tempo.anterior);

    renderNumeroTile('compAltimetriaValue', Math.round(r.altimetria.atual), 'M');
    textoDelta('compAltimetriaDelta', Math.round(r.altimetria.anterior) + ' m', r.altimetria);
    setBar('compAltimetriaBarAnterior', 'compAltimetriaBarAtual', r.altimetria.atual, r.altimetria.anterior);
  }

  // Barra "Anterior" sempre 100% de largura; barra "Atual" é proporcional
  // (atual/anterior, capada em 100%) — as fatias internas de cada barra são
  // o % de cada Categoria de zona dentro do total DAQUELA barra.
  function montarBarraZona(containerId, segundosPorZona, totalBarraPct) {
    const el = $(containerId);
    if (!el) return;
    el.replaceChildren();
    // O container (.desemp-zone-row__bar) é flex:1 — sempre ocupa a trilha
    // inteira da linha. Quem recebe a largura percentual é este wrapper
    // interno (não tem flex-grow, então `width` funciona normalmente).
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `width:${totalBarraPct}%;height:100%;display:flex;`;
    el.appendChild(wrapper);
    const total = segundosPorZona.reduce((s, v) => s + v, 0);
    if (total <= 0) return;
    segundosPorZona.forEach((seg, i) => {
      const span = document.createElement('span');
      span.style.width = (seg / total) * 100 + '%';
      span.style.background = CATEGORIA_CORES[i];
      wrapper.appendChild(span);
    });
  }

  function paraHoras(segundos) {
    return Math.round(segundos / 3600 * 10) / 10;
  }

  function renderZona(zonaAtual, zonaAnterior) {
    const segAnterior = [zonaAnterior.resistencia, zonaAnterior.limiarLatico, zonaAnterior.esforcoMaximo];
    const segAtual    = [zonaAtual.resistencia, zonaAtual.limiarLatico, zonaAtual.esforcoMaximo];
    const totalAnteriorSeg = segAnterior.reduce((s, v) => s + v, 0);
    const totalAtualSeg    = segAtual.reduce((s, v) => s + v, 0);
    const { anteriorPct, atualPct } = larguras(totalAtualSeg, totalAnteriorSeg);

    montarBarraZona('compZonaAnteriorBar', segAnterior, anteriorPct);
    montarBarraZona('compZonaAtualBar', segAtual, atualPct);

    const totalAnteriorEl = $('compZonaAnteriorTotal');
    if (totalAnteriorEl) totalAnteriorEl.textContent = paraHoras(totalAnteriorSeg) + 'h';
    const totalAtualEl = $('compZonaAtualTotal');
    if (totalAtualEl) totalAtualEl.textContent = paraHoras(totalAtualSeg) + 'h';
  }

  function renderPeso(dadosPeso) {
    const card = $('compPesoCard');
    if (!dadosPeso || !dadosPeso.ok) {
      if (card) card.hidden = true;
      return;
    }
    if (card) card.hidden = false;

    const pontos = dadosPeso.pontos;
    const primeiro = pontos[0].peso;
    const ultimo = pontos[pontos.length - 1].peso;
    const deltaKg = Math.round((ultimo - primeiro) * 10) / 10;

    renderNumeroTile('compPesoValue', String(ultimo).replace('.', ','), 'KG');
    const deltaEl = $('compPesoDelta');
    if (deltaEl) {
      deltaEl.replaceChildren();
      const span = document.createElement('span');
      span.className = deltaKg > 0 ? 'desemp-delta-up' : (deltaKg < 0 ? 'desemp-delta-down' : '');
      span.textContent = (deltaKg >= 0 ? '+' : '') + String(deltaKg).replace('.', ',') + ' kg';
      deltaEl.append(span, ` em ${pontos.length} medições`);
    }

    // Sparkline: normaliza os pontos num viewBox fixo (0 0 160 40, mesmo do
    // handoff) — x distribuído uniformemente, y invertido (peso maior = mais
    // acima) dentro da faixa min–max da própria série.
    const n = pontos.length;
    const pesos = pontos.map((p) => p.peso);
    const min = Math.min(...pesos);
    const max = Math.max(...pesos);
    const faixa = (max - min) || 1;
    const coords = pontos.map((p, i) => {
      const x = n > 1 ? 4 + (i / (n - 1)) * 152 : 80;
      const y = 8 + (1 - (p.peso - min) / faixa) * 26;
      return { x, y };
    });
    const linha = $('compPesoLine');
    if (linha) linha.setAttribute('points', coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '));
    const dot = $('compPesoDot');
    if (dot) {
      const ultimoPonto = coords[coords.length - 1];
      dot.setAttribute('cx', ultimoPonto.x.toFixed(1));
      dot.setAttribute('cy', ultimoPonto.y.toFixed(1));
    }
  }

  // Rótulos de mês (#114): card-label, legenda e labels de zona passam a
  // mostrar os nomes dos meses. A nota de parcialidade só aparece enquanto o
  // mês atual não fechou (compara os primeiros N dias de cada mês).
  function renderRotulos(p) {
    if (!p) return;
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set('compPeriodoLabel', `— ${p.mesAnteriorNome} vs ${p.mesAtualNome}`);
    set('compLegendAnterior', p.mesAnteriorNome);
    set('compLegendAtual', p.mesAtualNome);
    set('compZonaAnteriorLabel', p.mesAnteriorNome);
    set('compZonaAtualLabel', p.mesAtualNome);
    const nota = $('compPeriodoNota');
    if (nota) {
      if (p.parcial) {
        nota.textContent = `Comparando os primeiros ${p.diaCorte} dias de cada mês (mês atual em curso).`;
        nota.hidden = false;
      } else {
        nota.hidden = true;
      }
    }
  }

  function renderTiles(r) {
    renderRotulos(r.periodos);
    renderBarrasVolumeTempoAltimetria(r);
    renderZona(r.zona.atual, r.zona.anterior);
    renderPeso(r.peso);
  }

  async function load() {
    const empty   = $('comparative-performance-empty');
    const content = $('comparative-performance-content');
    if (!empty || !content) return;

    try {
      const [unified, zoneDist, weights] = await Promise.all([
        window.UnifiedActivities.get(70).catch(() => ({ items: [] })),
        window.Api.get('/garmin/zone-distribution-by-activity?days=70').catch(() => ({ items: [] })),
        window.Api.get('/weights').catch(() => []),
      ]);

      const resultado = window.ComparativePerformance.comparar({
        activities: (unified && unified.items) || [],
        zoneItems:  (zoneDist && zoneDist.items) || [],
        weights:    (weights || []).filter((w) => w.fonte === 'garmin'),
      });

      if (!resultado.ok) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;
      renderTiles(resultado);
    } catch (err) {
      console.error('[comparative-performance]', err);
      empty.hidden = false;
      content.hidden = true;
    }
  }

  window.ComparativePerformanceUI = { load };
})();
