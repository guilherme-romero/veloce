/* ═══════════════════════════════════════════════════════════════════════
   CORE / WEIGHT-STATS — análise de peso (regressão linear + previsão da
   meta), compartilhada pelo desktop (js/app.js#renderWeightAnalysis) e
   pela tela Perfil mobile (js/mobile/profile-mobile.js).

   Extraído VERBATIM de js/app.js na v2.8.0: a lógica é a mesma, só deixou
   de escrever direto no DOM. Quem chama decide como pintar o resultado —
   por isso `taxaPositiva` e `metaAtingida` são booleanos, nunca cores: as
   duas variantes divergem em --red/--yellow (ver css/mobile.css).

   Regras preservadas do original:
   - só pesagens tipo 'atual' entram;
   - múltiplas pesagens no mesmo dia viram a MÉDIA do dia (senão dois
     pontos em x=0 distorcem a regressão);
   - janela da regressão: dataInicioPlano → 180d → 90d → tudo, caindo para
     a próxima só enquanto houver menos de 3 pontos.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const DIA_MS = 86400000;

  /**
   * Pesagens 'atual' consolidadas por dia (média), em ordem cronológica.
   * @param  {Array} weights — Storage.getWeights()
   * @return {{data: string, peso: number}[]}
   */
  function dailyWeights(weights) {
    const raw = (weights || [])
      .filter(w => w && w.tipo === 'atual')
      .sort((a, b) => String(a.data).localeCompare(String(b.data)));

    const byDay = {};
    raw.forEach(w => {
      if (!byDay[w.data]) byDay[w.data] = [];
      byDay[w.data].push(w.peso);
    });

    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, pesos]) => ({
        data,
        peso: pesos.reduce((s, p) => s + p, 0) / pesos.length,
      }));
  }

  /**
   * Análise completa. Devolve { ok: false } quando não há base para
   * calcular (menos de 2 pesagens, sem meta, ou regressão degenerada) —
   * exatamente os casos em que o desktop escondia o card.
   *
   * @param  {Object} user    — Storage.getUser()
   * @param  {Array}  weights — Storage.getWeights()
   */
  function weightAnalysis(user, weights) {
    const u = user || {};
    const allWeights = dailyWeights(weights);

    if (allWeights.length < 2 || !u.pesoMeta) return { ok: false };

    const planStart = u.dataInicioPlano || null;
    const cutoff180 = new Date(Date.now() - 180 * DIA_MS).toISOString().slice(0, 10);
    const cutoff90  = new Date(Date.now() - 90 * DIA_MS).toISOString().slice(0, 10);

    let janela = planStart ? allWeights.filter(w => w.data >= planStart) : [];
    const planPts = janela.length;   // pesagens desde o início do plano
    if (janela.length < 3) janela = allWeights.filter(w => w.data >= cutoff180);
    if (janela.length < 3) janela = allWeights.filter(w => w.data >= cutoff90);
    if (janela.length < 3) janela = allWeights;

    const t0 = new Date(janela[0].data + 'T12:00:00').getTime();
    const pts = janela.map(w => ({
      x: (new Date(w.data + 'T12:00:00').getTime() - t0) / DIA_MS,
      y: w.peso,
    }));

    const n   = pts.length;
    const sx  = pts.reduce((s, p) => s + p.x, 0);
    const sy  = pts.reduce((s, p) => s + p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
    const denom = n * sx2 - sx * sx;
    if (denom === 0) return { ok: false };

    const slope      = (n * sxy - sx * sy) / denom;   // kg/dia
    const taxaKgSem  = +(slope * 7).toFixed(2);       // negativo = perda
    const pesoAtual  = allWeights[allWeights.length - 1].peso;
    const faltam     = +(pesoAtual - u.pesoMeta).toFixed(1);

    // Direção do objetivo é fixada pelo peso no INÍCIO DA JANELA (a mesma
    // usada na regressão, que já prioriza dataInicioPlano → 180d → 90d →
    // tudo) vs a meta — não pela posição atual, nem pelo 1º registro de toda
    // a vida da conta (uma troca de objetivo anos atrás não deve definir a
    // direção de hoje). Se fosse pela posição atual, ultrapassar a meta de
    // perda (ex.: perder mais do que o combinado) faria o sistema concluir
    // "o objetivo agora é ganhar", e penalizar quem continua progredindo na
    // mesma direção.
    const inicial       = janela[0].peso;
    const objetivoGanho = u.pesoMeta > inicial;
    const metaAtingida  = objetivoGanho ? pesoAtual >= u.pesoMeta : pesoAtual <= u.pesoMeta;
    const faltamAbs      = Math.abs(faltam);
    // Normaliza "progresso bom" pra sempre ser > 0, independente da direção.
    const slopeAlvo      = objetivoGanho ? slope : -slope;

    let previsao = '—', semanas = '—', msg = '';
    if (metaAtingida) {
      previsao = 'Meta atingida!';
      msg      = 'Parabéns! Você atingiu sua meta de peso.';
    } else if (slopeAlvo > 0) {
      const diasNecessarios = faltamAbs / Math.abs(slope);
      const semsNec = Math.ceil(diasNecessarios / 7);
      previsao = new Date(Date.now() + diasNecessarios * DIA_MS)
        .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
      semanas  = String(semsNec);
      if (semsNec > 52)      msg = 'Taxa atual lenta — considere ajustar plano.';
      else if (semsNec > 26) msg = 'Progresso consistente — mantenha o ritmo!';
      else                   msg = `Meta em ~${semsNec} semanas no ritmo atual.`;
    } else if (planPts < 4) {
      msg = 'Poucos dados desde o início do plano — registre mais pesagens para estimar a previsão.';
    } else if (Math.abs(slope) < 0.01) {
      msg = objetivoGanho
        ? 'Peso estável — sem tendência de ganho no período.'
        : 'Peso estável — sem tendência de perda no período.';
    } else {
      msg = objetivoGanho
        ? 'Tendência de perda — revise alimentação e treinos.'
        : 'Tendência de ganho — revise alimentação e treinos.';
    }

    return {
      ok: true,
      slope, taxaKgSem, pesoAtual, faltam, planPts,
      previsao, semanas, msg, objetivoGanho,
      // Semântica em vez de cor: progredir na direção do objetivo é "bom", e
      // cada variante escolhe o próprio token (lime/magenta).
      taxaPositiva: objetivoGanho ? taxaKgSem > 0 : taxaKgSem < 0,
      metaAtingida,
    };
  }

  window.WeightStats = { dailyWeights, weightAnalysis };
})();
