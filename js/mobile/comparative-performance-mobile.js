/* ═══════════════════════════════════════════════════════════════════════
   COMPARATIVO DE DESEMPENHO MOBILE — espelha js/comparative-performance.js
   (desktop), trocando os ids por m-comp-* e o grid de 5 colunas por um
   carrossel horizontal com scroll-snap (handoff_desempenho_mobile/README.md)
   + um card de "Tempo por zona" separado, fora do carrossel. Mesmo motor
   puro (window.ComparativePerformance, js/core/) e os mesmos 3 GETs do
   desktop — não existe endpoint HTTP próprio de Comparativo, tudo é
   calculado no cliente.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  const CATEGORIA_CORES = ['var(--blue)', 'var(--amber)', 'var(--red)'];

  // Mesma regra de larguras do desktop (handoff_desempenho §3.4).
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

  function textoDelta(elId, anteriorFmt, metrica) {
    const el = $(elId);
    if (!el) return;
    el.replaceChildren();
    el.append(`era ${anteriorFmt} · `);
    const span = document.createElement('span');
    const seta = metrica.direcao === 'alta' ? '↑' : (metrica.direcao === 'baixa' ? '↓' : '—');
    const pct = metrica.percentual != null ? Math.abs(metrica.percentual) + '%' : String(Math.round(Math.abs(metrica.delta) * 10) / 10);
    span.className = metrica.direcao === 'alta' ? 'mdesemp-delta-up' : (metrica.direcao === 'baixa' ? 'mdesemp-delta-down' : '');
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
    renderNumeroTile('m-comp-volume-value', Math.round(r.volume.atual), 'KM');
    textoDelta('m-comp-volume-delta', Math.round(r.volume.anterior) + ' km', r.volume);
    setBar('m-comp-volume-bar-anterior', 'm-comp-volume-bar-atual', r.volume.atual, r.volume.anterior);

    const tempoAtual = Math.round(r.tempo.atual * 10) / 10;
    const tempoAnterior = Math.round(r.tempo.anterior * 10) / 10;
    renderNumeroTile('m-comp-tempo-value', String(tempoAtual).replace('.', ','), 'H');
    textoDelta('m-comp-tempo-delta', String(tempoAnterior).replace('.', ',') + ' h', r.tempo);
    setBar('m-comp-tempo-bar-anterior', 'm-comp-tempo-bar-atual', r.tempo.atual, r.tempo.anterior);

    renderNumeroTile('m-comp-altimetria-value', Math.round(r.altimetria.atual), 'M');
    textoDelta('m-comp-altimetria-delta', Math.round(r.altimetria.anterior) + ' m', r.altimetria);
    setBar('m-comp-altimetria-bar-anterior', 'm-comp-altimetria-bar-atual', r.altimetria.atual, r.altimetria.anterior);
  }

  function montarBarraZona(containerId, segundosPorZona, totalBarraPct) {
    const el = $(containerId);
    if (!el) return;
    el.replaceChildren();
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

    montarBarraZona('m-comp-zona-anterior-bar', segAnterior, anteriorPct);
    montarBarraZona('m-comp-zona-atual-bar', segAtual, atualPct);

    const totalAnteriorEl = $('m-comp-zona-anterior-total');
    if (totalAnteriorEl) totalAnteriorEl.textContent = paraHoras(totalAnteriorSeg) + 'h';
    const totalAtualEl = $('m-comp-zona-atual-total');
    if (totalAtualEl) totalAtualEl.textContent = paraHoras(totalAtualSeg) + 'h';
  }

  function renderPeso(dadosPeso) {
    const card = $('m-comp-peso-card');
    if (!dadosPeso || !dadosPeso.ok) {
      if (card) card.hidden = true;
      return;
    }
    if (card) card.hidden = false;

    const pontos = dadosPeso.pontos;
    const primeiro = pontos[0].peso;
    const ultimo = pontos[pontos.length - 1].peso;
    const deltaKg = Math.round((ultimo - primeiro) * 10) / 10;

    renderNumeroTile('m-comp-peso-value', String(ultimo).replace('.', ','), 'KG');
    const deltaEl = $('m-comp-peso-delta');
    if (deltaEl) {
      deltaEl.replaceChildren();
      const span = document.createElement('span');
      span.className = deltaKg > 0 ? 'mdesemp-delta-up' : (deltaKg < 0 ? 'mdesemp-delta-down' : '');
      span.textContent = (deltaKg >= 0 ? '+' : '') + String(deltaKg).replace('.', ',') + ' kg';
      deltaEl.append(span, ` em ${pontos.length} medições`);
    }

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
    const linha = $('m-comp-peso-line');
    if (linha) linha.setAttribute('points', coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '));
    const dot = $('m-comp-peso-dot');
    if (dot) {
      const ultimoPonto = coords[coords.length - 1];
      dot.setAttribute('cx', ultimoPonto.x.toFixed(1));
      dot.setAttribute('cy', ultimoPonto.y.toFixed(1));
    }
  }

  function renderTiles(r) {
    renderBarrasVolumeTempoAltimetria(r);
    renderZona(r.zona.atual, r.zona.anterior);
    renderPeso(r.peso);
  }

  // BUG-078 (mesmo padrão de insights-mobile.js): sem rota própria no
  // MRouter — desempenho-mobile.js invalida via invalidate() no onLeave,
  // evitando que uma busca antiga sobrescreva um resultado mais recente.
  let _gen = 0;
  function invalidate() { _gen++; }

  async function load() {
    const empty   = $('m-comp-empty');
    const content = $('m-comp-content');
    if (!empty || !content) return;
    const gen = ++_gen;

    try {
      const [unified, zoneDist, weights] = await Promise.all([
        window.Api.get('/activities/unified?days=61').catch(() => ({ items: [] })),
        window.Api.get('/garmin/zone-distribution-by-activity?days=61').catch(() => ({ items: [] })),
        window.Api.get('/weights').catch(() => []),
      ]);
      if (gen !== _gen) return;

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
      if (gen !== _gen) return;
      console.error('[comparative-performance-mobile]', err);
      empty.hidden = false;
      content.hidden = true;
    }
  }

  window.ComparativePerformanceMobile = { load, invalidate };
})();
