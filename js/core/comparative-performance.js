/* ═══════════════════════════════════════════════════════════════════════
   CORE / COMPARATIVE PERFORMANCE — motor puro do Comparativo de Desempenho
   (GLOSSARY.md). Compara os últimos 30 dias contra os 30 dias imediatamente
   anteriores em 5 frentes: volume, tempo de pedal, altimetria, tempo por
   Categoria de zona, e peso corporal.

   Sem rede aqui — opera só sobre arrays já buscados (activities de
   /activities/unified, zoneItems de /garmin/zone-distribution-by-activity,
   weights de /api/weights). Diferente de js/core/performance-analysis.js
   (que compara atividades parecidas entre si, ao longo de 12 meses): aqui o
   eixo de comparação é tempo corrido, dois períodos fixos e contíguos.
═══════════════════════════════════════════════════════════════════════ */
(function () {

  const JANELA_DIAS = 30;
  const MIN_ATIVIDADES = 3;

  // Data LOCAL (não UTC) — mesmo padrão de js/core/suggestion-history.js:19.
  // new Date().toISOString() usa UTC e deslocaria a fronteira dos 30 dias
  // perto da meia-noite em fuso -03:00.
  function paraISO(d) {
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function hojeISO() {
    return paraISO(new Date());
  }

  function subDiasISO(isoBase, n) {
    const d = new Date(isoBase + 'T12:00:00');
    d.setDate(d.getDate() - n);
    return paraISO(d);
  }

  /**
   * Dois períodos fixos e contíguos: atual = [hoje-29, hoje];
   * anterior = [hoje-59, hoje-30].
   * @return {{ atualInicio, atualFim, anteriorInicio, anteriorFim }} (ISO strings)
   */
  function definirPeriodos(hojeIso) {
    const hoje = hojeIso || hojeISO();
    return {
      atualInicio:    subDiasISO(hoje, JANELA_DIAS - 1),
      atualFim:       hoje,
      anteriorInicio: subDiasISO(hoje, 2 * JANELA_DIAS - 1),
      anteriorFim:    subDiasISO(hoje, JANELA_DIAS),
    };
  }

  function dentro(dataISO, inicio, fim) {
    return !!dataISO && dataISO >= inicio && dataISO <= fim;
  }

  /**
   * @param  {Array} activities — itens de /activities/unified (.items)
   * @return {{ count:number, km:number, tempoMovH:number, elevacaoM:number }}
   */
  function agregarAtividades(activities, inicio, fim) {
    const doPeriodo = (activities || []).filter(a => dentro(a.data, inicio, fim));
    return {
      count:     doPeriodo.length,
      km:        doPeriodo.reduce((s, a) => s + (a.distanciaKm || 0), 0),
      tempoMovH: doPeriodo.reduce((s, a) => s + (a.tempoMovS || 0), 0) / 3600,
      elevacaoM: doPeriodo.reduce((s, a) => s + (a.elevacaoM || 0), 0),
    };
  }

  /**
   * Agrupa segundosPorZona ([z1..z5], zonas com dado real por atividade) em
   * 3 Categoria de zona (GLOSSARY.md): Resistência=Z1+Z2, Limiar lático=
   * Z3+Z4, Esforço máximo=Z5.
   * @param  {Array} zoneItems — itens de /garmin/zone-distribution-by-activity (.items)
   * @return {{ resistencia:number, limiarLatico:number, esforcoMaximo:number }} (segundos)
   */
  function agruparZonaCategoria(zoneItems, inicio, fim) {
    const doPeriodo = (zoneItems || []).filter(z => dentro(z.data, inicio, fim));
    const soma = [0, 0, 0, 0, 0];
    doPeriodo.forEach(z => (z.segundosPorZona || []).forEach((s, i) => { soma[i] += (s || 0); }));
    return {
      resistencia:   soma[0] + soma[1],
      limiarLatico:  soma[2] + soma[3],
      esforcoMaximo: soma[4],
    };
  }

  /**
   * @return {{ delta:number, percentual:number|null, direcao:'alta'|'baixa'|'estavel' }}
   */
  function calcularDelta(atual, anterior) {
    const delta = atual - anterior;
    const percentual = anterior > 0 ? Math.round((delta / anterior) * 100) : null;
    const direcao = delta > 0 ? 'alta' : (delta < 0 ? 'baixa' : 'estavel');
    return { delta, percentual, direcao };
  }

  /**
   * Peso: tendência contínua (sem agregação por período) — a UI desenha a
   * linha toda com uma anotação marcando a fronteira. Fonte prática: só
   * fonte==='garmin' é populada hoje (sem tela de entrada manual).
   * @param  {Array} weights — /api/weights, já filtrado por fonte='garmin' pelo chamador
   * @return {{ok:false}} | {{ok:true, pontos:Array, fronteira:string}}
   */
  function dadosPeso(weights, periodos) {
    const pontos = (weights || [])
      .filter(w => w.peso != null && dentro(w.data, periodos.anteriorInicio, periodos.atualFim))
      .sort((a, b) => a.data.localeCompare(b.data));
    if (!pontos.length) return { ok: false };
    return { ok: true, pontos, fronteira: periodos.atualInicio };
  }

  /**
   * Orquestrador puro: recebe os 3 arrays já buscados e devolve o pacote
   * pronto pra render. Gate geral (>=3 atividades em CADA período) controla
   * a seção inteira; peso tem gate próprio independente dentro do pacote.
   * @param  {Object} params
   * @param  {Array}  params.activities — /activities/unified (.items)
   * @param  {Array}  params.zoneItems  — /garmin/zone-distribution-by-activity (.items)
   * @param  {Array}  params.weights    — /api/weights (fonte='garmin')
   * @return {{ok:false}} | {{ok:true, periodos, volume, tempo, altimetria, zona, peso}}
   */
  function comparar({ activities, zoneItems, weights }) {
    const periodos = definirPeriodos();
    const atual    = agregarAtividades(activities, periodos.atualInicio, periodos.atualFim);
    const anterior = agregarAtividades(activities, periodos.anteriorInicio, periodos.anteriorFim);

    if (atual.count < MIN_ATIVIDADES || anterior.count < MIN_ATIVIDADES) {
      return { ok: false };
    }

    const zonaAtual    = agruparZonaCategoria(zoneItems, periodos.atualInicio, periodos.atualFim);
    const zonaAnterior = agruparZonaCategoria(zoneItems, periodos.anteriorInicio, periodos.anteriorFim);

    return {
      ok: true,
      periodos,
      volume:     { atual: atual.km,        anterior: anterior.km,        ...calcularDelta(atual.km, anterior.km) },
      tempo:      { atual: atual.tempoMovH, anterior: anterior.tempoMovH, ...calcularDelta(atual.tempoMovH, anterior.tempoMovH) },
      altimetria: { atual: atual.elevacaoM, anterior: anterior.elevacaoM, ...calcularDelta(atual.elevacaoM, anterior.elevacaoM) },
      zona: { atual: zonaAtual, anterior: zonaAnterior },
      peso: dadosPeso(weights, periodos),
    };
  }

  window.ComparativePerformance = {
    definirPeriodos, agregarAtividades, agruparZonaCategoria, calcularDelta, dadosPeso, comparar,
  };
})();
