/* ═══════════════════════════════════════════════════════════════════════
   CORE / PERFORMANCE ANALYSIS — motor puro da Análise de Performance (Fase 4
   da evolução IDEIA-1+2; design em GLOSSARY.md — "Atividade de referência",
   "Grupo de comparação" — e docs/adr/0002-gemini-pre-calculo-local-analise-
   performance.md: este módulo faz TODA a conta; o Gemini só interpreta o
   resultado, nunca recalcula nada).

   Sem rede aqui — opera só sobre o array de atividades já buscado
   (/activities/unified?days=365). Todas as atividades do endpoint já são
   ciclismo (é um app de treino de bike), então o filtro de elegibilidade é
   só a distância mínima — não há campo confiável de "tipo de esporte" a
   filtrar (act.tipo é texto livre vindo do Strava/Garmin, ex. "Ride").
═══════════════════════════════════════════════════════════════════════ */
(function () {

  const DIST_MIN_KM = 10;
  const TOL_DISTANCIA = 0.15;   // ±15%
  const TOL_ELEVACAO  = 0.20;   // ±20%
  const JANELA_MESES  = 12;
  const GRUPO_MIN     = 3;      // incluindo a referência

  function elegivel(a) {
    return a && typeof a.distanciaKm === 'number' && a.distanciaKm >= DIST_MIN_KM;
  }

  /**
   * Atividade mais recente elegível (bike, >= 10km) — pula rolos curtos/testes
   * ao escolher o ponto de partida, mesmo que não seja a última registrada.
   */
  function selecionarReferencia(activities) {
    const elegiveis = (activities || []).filter(elegivel).sort((a, b) => b.data.localeCompare(a.data));
    return elegiveis[0] || null;
  }

  function dentroDaTolerancia(valor, alvo, tolerancia) {
    if (valor == null || alvo == null) return false;
    if (alvo === 0) return valor === 0; // rolo/pista plana — não dividir por zero
    return Math.abs(valor - alvo) / alvo <= tolerancia;
  }

  function haMenosDeNMeses(dataISO, referenciaISO, meses) {
    const d = new Date(dataISO + 'T12:00:00');
    const limite = new Date(referenciaISO + 'T12:00:00');
    limite.setMonth(limite.getMonth() - meses);
    return d >= limite;
  }

  /**
   * Outras atividades elegíveis dos últimos 12 meses, dentro de ±15%
   * distância / ±20% elevação da referência (inclui a própria referência,
   * em ordem cronológica — mais antiga primeiro, pra ler como série/tendência).
   */
  function montarGrupo(activities, referencia) {
    const grupo = (activities || []).filter(a =>
      elegivel(a) &&
      haMenosDeNMeses(a.data, referencia.data, JANELA_MESES) &&
      dentroDaTolerancia(a.distanciaKm, referencia.distanciaKm, TOL_DISTANCIA) &&
      dentroDaTolerancia(a.elevacaoM, referencia.elevacaoM, TOL_ELEVACAO)
    );
    return grupo.sort((a, b) => a.data.localeCompare(b.data));
  }

  /**
   * @param  {Object} params
   * @param  {Array}  params.activities — /activities/unified?days=365 (.items)
   * @return {Object} { ok:false } | { ok:true, referenciaId, grupo, deltas }
   *   deltas: série cronológica (mesma ordem do grupo) de velMediaKmh,
   *   tempoMovS e fcMedia — a "tendência" que o Gemini vai interpretar.
   */
  function analisar({ activities }) {
    const acts = Array.isArray(activities) ? activities : [];
    const referencia = selecionarReferencia(acts);
    if (!referencia) return { ok: false };

    const grupo = montarGrupo(acts, referencia);
    if (grupo.length < GRUPO_MIN) return { ok: false };

    return {
      ok: true,
      referenciaId: referencia.id,
      grupo: grupo.map(a => ({ id: a.id, data: a.data, distanciaKm: a.distanciaKm, elevacaoM: a.elevacaoM })),
      deltas: {
        velMediaKmh: grupo.map(a => a.velMediaKmh ?? null),
        tempoMovS:   grupo.map(a => a.tempoMovS ?? null),
        fcMedia:     grupo.map(a => a.fcMedia ?? null),
      },
    };
  }

  /**
   * Faixa min–max de velocidade/FC a partir de `deltas` (handoff_desempenho:
   * números-chave do card de Análise). Calculado localmente — nunca pelo
   * modelo de IA — pra manter a garantia do ADR-0002 (app calcula, IA só
   * interpreta). Mesma lógica duplicada em server/routes/performance-
   * analysis.js pro texto do prompt (runtime diferente, sem import possível).
   * @param  {Object} deltas — { velMediaKmh, tempoMovS, fcMedia } (arrays)
   * @return {{ velMinKmh, velMaxKmh, fcMinBpm, fcMaxBpm }} (null se a série não tiver nenhum valor)
   */
  function calcularDestaques(deltas) {
    const vel = (deltas?.velMediaKmh || []).filter(v => v != null);
    const fc  = (deltas?.fcMedia || []).filter(v => v != null);
    return {
      velMinKmh: vel.length ? Math.min(...vel) : null,
      velMaxKmh: vel.length ? Math.max(...vel) : null,
      fcMinBpm:  fc.length ? Math.min(...fc) : null,
      fcMaxBpm:  fc.length ? Math.max(...fc) : null,
    };
  }

  window.PerformanceAnalysis = { analisar, selecionarReferencia, montarGrupo, calcularDestaques };
})();
