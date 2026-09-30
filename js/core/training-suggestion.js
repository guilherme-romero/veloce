/* ═══════════════════════════════════════════════════════════════════════
   CORE / TRAINING SUGGESTION — motor de regras da seção "Próximo Treino"
   (IDEIA-1+2 do backlog; design em GLOSSARY.md e
   docs/adr/0001-prioridade-fixa-entre-categorias-de-sugestao.md).

   100% regras locais, sem LLM. Reaproveita Fatigue.fatigueIndex e
   Metrics.calcTSBMetrics/tsbStatus — só a checagem de histórico mínimo e o
   sinal de zona-alvo (nenhum dos dois existe em outro lugar) são novos.

   Categoria de sugestão é uma de três, prioridade fixa quando mais de uma
   se justifica: RECUPERAÇÃO > VOLUME > ZONA-ALVO (ADR-0001). Se nenhum
   sinal negativo disparar, cai num fallback neutro de zona-alvo (Z2) —
   a seção sempre mostra uma sugestão quando há dado suficiente, nunca fica
   vazia por "tudo em ordem".

   Como em Fatigue/Metrics, o token de cor é um NOME ('green'|'amber'|'red'),
   nunca hex — --red/--amber divergem entre css/style.css e css/mobile.css.
═══════════════════════════════════════════════════════════════════════ */
(function () {

  // Limiar novo (sem precedente no código): pouco tempo em Z4+Z5 nos
  // últimos 30 dias sugere subir intensidade. Primeira estimativa — como o
  // TTL de cache, calibrar depois contra o histórico real de uso.
  const ZONA_ALTA_MIN_PCT = 0.10;

  // Histórico curto demais pra confiar no ATL de 7 dias / warm-up do TSB.
  const HISTORICO_MIN_DIAS = 7;

  /**
   * Data (YYYY-MM-DD) da atividade mais antiga em `activities`, ou null.
   */
  function dataMaisAntiga(activities) {
    let min = null;
    for (const a of activities) {
      if (a.data && (min == null || a.data < min)) min = a.data;
    }
    return min;
  }

  function diasDesde(iso) {
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return 0;
    return Math.floor((Date.now() - d.getTime()) / 86400_000);
  }

  /**
   * Decide a Sugestão de Treino do momento a partir dos mesmos dados que a
   * seção Insights já busca.
   *
   * @param  {Object} params
   * @param  {Array}  params.activities — /activities/unified?days=180 (.items)
   * @param  {Array}  params.health     — /garmin/health?days=60, MAIS RECENTE
   *                                      PRIMEIRO (mesmo pré-processamento de
   *                                      insights.js antes de chamar Fatigue)
   * @param  {Object} params.zoneDist   — /garmin/zone-distribution?days=30
   * @param  {number} params.fcMax      — Metrics.calcFCMax(user)
   * @return {Object} { ok:false } | { ok:true, categoria, msg, token }
   *                  categoria ∈ 'recuperacao' | 'volume' | 'zona-alvo'
   */
  function suggest({ activities, health, zoneDist, fcMax }) {
    const acts = Array.isArray(activities) ? activities : [];

    // 1. Dado insuficiente → seção fica ausente, nunca chuta.
    const fadiga = window.Fatigue.fatigueIndex(health);
    if (!fadiga.ok) return { ok: false };

    const antiga = dataMaisAntiga(acts);
    if (!antiga || diasDesde(antiga) < HISTORICO_MIN_DIAS) return { ok: false };

    // 2. Sinal de recuperação — vence tudo, reaproveita fatigue.js.
    if (fadiga.status === 'Fadigado') {
      return {
        ok: true, categoria: 'recuperacao', token: fadiga.token,
        msg: 'Índice de fadiga alto — hoje é dia de descanso ou atividade leve.',
      };
    }

    // 3. Sinal de volume — reaproveita metrics.js (TSB).
    if (fcMax) {
      const { tsb } = window.Metrics.calcTSBMetrics(acts, fcMax);
      const tsbInfo = window.Metrics.tsbStatus(tsb);
      if (tsbInfo.status === 'Sobrecarga') {
        return {
          ok: true, categoria: 'volume', token: tsbInfo.token,
          msg: 'TSB em sobrecarga — reduza o volume nos próximos dias.',
        };
      }
    }

    // 4. Sinal de zona-alvo — novo, sem precedente. Pouco tempo em Z4/Z5.
    const seg   = (zoneDist && zoneDist.segundosPorZona) || [];
    const total = (zoneDist && zoneDist.totalSegundos) || 0;
    if (total > 0) {
      const altaPct = ((seg[3] || 0) + (seg[4] || 0)) / total;
      if (altaPct < ZONA_ALTA_MIN_PCT) {
        return {
          ok: true, categoria: 'zona-alvo', token: 'amber',
          msg: 'Pouco tempo em zonas altas nos últimos 30 dias — hoje é um bom dia para Z4.',
        };
      }
    }

    // 5. Nenhum sinal negativo: fallback neutro (decisão explícita — a
    // seção sempre mostra algo quando há dado suficiente).
    return {
      ok: true, categoria: 'zona-alvo', token: 'green',
      msg: 'Forma equilibrada — siga o plano, foco em Z2 para manter a base.',
    };
  }

  window.TrainingSuggestion = { suggest };
})();
