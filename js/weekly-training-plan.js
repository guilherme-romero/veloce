/* ═══════════════════════════════════════════════════════════════════════
   TREINO IA — seção desktop, Plano de Treino Semanal (IDEIA-7, Issue #1).
   Layout 1A do handoff (treino_bike_docs/handoff_treino_ia/desktop): grid
   de 7 colunas (semana) + painel de detalhe do dia selecionado, com perfil
   de esforço (blocos por zona de FC) e segmentos de RPE.

   Cor de zona vem de window.FC_ZONES (js/utils.js, z1..z6) — fonte única
   de verdade de cor por zona no app. A distribuição semanal (resumo no
   topo) usa as 3 categorias já estabelecidas pelo Comparativo de Desempenho
   (js/comparative-performance.js: Resistência/Limiar lático/Esforço
   máximo) — granularidade mais grossa, apropriada pra um resumo da semana;
   o perfil de esforço de cada dia usa as 6 zonas finas, apropriado pra
   mostrar a estrutura real do treino.

   Totais da semana (volume, treinos, descanso, % por zona) são SEMPRE
   calculados aqui a partir de `dias[].blocos` — nunca pedidos à IA.

   Gatilho exclusivamente sob demanda (botão "Gerar novo plano") — sem job
   automático. Sem conceito de cache "vencido" por tempo — o plano vale até
   o usuário gerar outro manualmente.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = window.esc || ((s) => String(s ?? ''));

  const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
  const DOW_LABEL = { segunda: 'SEG', terca: 'TER', quarta: 'QUA', quinta: 'QUI', sexta: 'SEX', sabado: 'SÁB', domingo: 'DOM' };
  const DIA_FULL = { segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado', domingo: 'Domingo' };
  const LABEL_TIPO = { resistencia: 'Resistência', intervalado: 'Intervalado', longao: 'Longão', descanso: 'Descanso' };

  // z1..z6 → mesmos tokens CSS de window.FC_ZONES (js/utils.js).
  const ZONA_VAR = { z1: '--blue', z2: '--yellow', z3: '--green', z4: '--red', z5: '--purple', z6: '--pink' };
  // Resumo semanal: granularidade grossa, mesma de js/comparative-performance.js.
  const CATEGORIA_LABELS = ['Resistência', 'Limiar lático', 'Esforço máximo'];
  const CATEGORIA_CORES = ['var(--blue)', 'var(--amber)', 'var(--red)'];
  const ZONA_CATEGORIA = { z1: 0, z2: 0, z3: 1, z4: 1, z5: 2, z6: 2 };

  function corZonaVar(zona) { return ZONA_VAR[zona] || '--muted'; }
  function fmtData(iso) {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''); }
    catch (_) { return iso; }
  }
  function fmtDataHora(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
        + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return iso; }
  }
  function rotuloProvider(payload) {
    if (!payload.provider || !payload.model) return '';
    const nome = payload.provider === 'gemini' ? 'Gemini' : 'Groq';
    return ' · via ' + nome + ' · ' + payload.model;
  }

  let _dados = null;   // payload atual: { objetivo, dias }
  let _geradoEm = null;
  let _selIdx = 0;     // índice 0=segunda..6=domingo
  let _hoje = null;

  function diasOrdenados() {
    const porDia = {};
    (_dados.dias || []).forEach((d) => { porDia[d.dia] = d; });
    return DIAS_SEMANA.map((slug) => porDia[slug]).filter(Boolean);
  }

  function proximoTreinoIdx(dias, i) {
    for (let k = 1; k <= 7; k++) {
      const j = (i + k) % 7;
      if (!dias[j].descanso) return j;
    }
    return i;
  }

  // Cor de destaque do dia: longão sempre lime (acento, igual ao handoff);
  // descanso sempre muted; demais tipos = cor da zona com mais minutos.
  function tipoCorVar(dia) {
    if (dia.descanso) return '--muted';
    if (dia.tipo === 'longao') return '--lime';
    const porZona = {};
    (dia.blocos || []).forEach((b) => { porZona[b.zona] = (porZona[b.zona] || 0) + b.min; });
    let zonaDom = null, max = -1;
    for (const z in porZona) if (porZona[z] > max) { max = porZona[z]; zonaDom = z; }
    return zonaDom ? ZONA_VAR[zonaDom] : '--blue';
  }

  function blocosHTML(blocos) {
    return (blocos || []).map((b) => {
      const op = /aquec|desaq/i.test(b.rotulo || '') ? '.6' : '1';
      return `<span style="flex-grow:${Math.max(1, b.min)};height:${Math.round((b.intensidade || 0) * 100)}%;background:var(${corZonaVar(b.zona)});opacity:${op}"></span>`;
    }).join('');
  }

  function blocosLegendaTexto(blocos) {
    return (blocos || []).map((b) => (b.rotulo ? b.rotulo + ' ' : '') + b.min + '′').join(' · ');
  }

  function diaCardHTML(dia, i, selIdx) {
    const selected = i === selIdx;
    const classes = ['tia-day'];
    if (dia.descanso) classes.push('is-rest');
    if (selected) classes.push('is-selected');
    const hoje = dia.data === _hoje;
    const head = `<div class="tia-day-head">
      <div><div class="tia-day-dow">${esc(DOW_LABEL[dia.dia])}</div><div class="tia-day-date">${esc(fmtData(dia.data))}</div></div>
      ${hoje ? '<span class="tia-day-today">HOJE</span>' : ''}
    </div>`;

    if (dia.descanso) {
      return `<div class="${classes.join(' ')}" role="button" aria-pressed="${selected}" tabindex="0" data-idx="${i}">
        ${head}
        <div class="tia-day-rest-body"><i class="fa-solid fa-bed"></i><span class="tia-day-rest-label">DESCANSO</span></div>
        <p class="tia-day-resumo">${esc(dia.resumo)}</p>
      </div>`;
    }

    const rpeHi = dia.rpe[1];
    const chipClass = rpeHi >= 7 ? 'tia-rpe-chip tia-rpe-chip--hi' : 'tia-rpe-chip';
    return `<div class="${classes.join(' ')}" role="button" aria-pressed="${selected}" tabindex="0" data-idx="${i}">
      ${head}
      <div class="tia-day-type" style="color:var(${tipoCorVar(dia)})">${esc(LABEL_TIPO[dia.tipo] || dia.tipo)}</div>
      <div class="tia-day-duration">${dia.duracaoMin}<small>MIN</small></div>
      <span class="${chipClass}">RPE ${dia.rpe[0]}–${dia.rpe[1]}</span>
      <p class="tia-day-resumo tia-day-resumo--train">${esc(dia.resumo)}</p>
      <div class="tia-miniprofile">${blocosHTML(dia.blocos)}</div>
    </div>`;
  }

  function detailHTML(dia, next) {
    const hoje = dia.data === _hoje;
    const dayPill = hoje ? `Hoje · ${DIA_FULL[dia.dia]}` : `${DIA_FULL[dia.dia]} · ${fmtData(dia.data)}`;
    const dayPillClass = hoje ? 'tia-pill tia-pill--day-today' : 'tia-pill tia-pill--day';
    const tipoLabel = LABEL_TIPO[dia.tipo] || dia.tipo;
    const corVar = tipoCorVar(dia);
    const hlA = dia.descanso ? 'DIA DE' : dia.titulo.a;
    const hlB = dia.descanso ? 'DESCANSO' : dia.titulo.b;

    const bodyHTML = dia.descanso
      ? `<div class="tia-rest-tips">
          <div class="tia-rest-tip"><i class="fa-solid fa-bed"></i>Sono de qualidade</div>
          <div class="tia-rest-tip"><i class="fa-solid fa-person-walking"></i>Caminhada leve opcional</div>
          <div class="tia-rest-tip"><i class="fa-solid fa-droplet"></i>Hidratação e alimentação</div>
        </div>`
      : `<div>
          <div class="tia-effort"><div class="tia-effort-line"></div>${blocosHTML(dia.blocos)}</div>
          <div class="tia-effort-legend"><span>0′</span><span style="text-align:center">${esc(blocosLegendaTexto(dia.blocos))}</span><span>${dia.duracaoMin}′</span></div>
        </div>`;

    const durVal = dia.descanso ? '0' : (dia.duracaoMin >= 60 ? String(dia.duracaoMin / 60).replace('.', ',') : String(dia.duracaoMin));
    const durUnit = dia.descanso ? 'MIN' : (dia.duracaoMin >= 60 ? 'H' : 'MIN');
    const rpeShow = dia.descanso ? '0' : `${dia.rpe[0]}–${dia.rpe[1]}`;
    const rpeHi = dia.rpe[1];
    const rpeSegs = Array.from({ length: 10 }, (_, k) => {
      let bg = 'var(--border)';
      if (!dia.descanso && k < rpeHi) bg = rpeHi >= 7 ? (k < 4 ? 'var(--blue)' : 'var(--red)') : `var(${corVar})`;
      return `<span class="tia-rpe-seg" style="background:${bg}"></span>`;
    }).join('');

    return `
      <div class="tia-detail-left">
        <div class="tia-pills">
          <span class="${dayPillClass}">${esc(dayPill)}</span>
          <span class="tia-pill" style="background:color-mix(in srgb, var(${corVar}) 16%, transparent);color:var(${corVar})">${esc(tipoLabel)}</span>
        </div>
        <div class="tia-title">${esc(hlA)} <span style="color:var(${corVar})">${esc(hlB)}</span></div>
        <p class="tia-desc">${esc(dia.descricao)}</p>
        ${bodyHTML}
      </div>
      <div class="tia-detail-right">
        <div class="tia-side-card"><div class="tia-side-label">Duração</div><div class="tia-side-value">${esc(durVal)}<small>${durUnit}</small></div></div>
        <div class="tia-side-card">
          <div class="tia-side-label">Esforço percebido</div>
          <div class="tia-side-value">${esc(rpeShow)}<small>/10</small></div>
          <div class="tia-rpe-grid">${rpeSegs}</div>
        </div>
        <div class="tia-side-card tia-next-card" data-next="1">
          <div class="tia-side-label"><span>Próximo treino</span><i class="fa-solid fa-arrow-right"></i></div>
          <div class="tia-next-label">${esc(DIA_FULL[next.dia])} · ${esc(LABEL_TIPO[next.tipo] || next.tipo)}</div>
          <div class="tia-next-sub" style="color:var(${tipoCorVar(next)})">${next.descanso ? 'Descanso' : next.duracaoMin + '′ · RPE ' + next.rpe[0] + '–' + next.rpe[1]}</div>
        </div>
      </div>
    `;
  }

  function resumoSemanaHTML(dias) {
    const volumeMin = dias.reduce((s, d) => s + (d.duracaoMin || 0), 0);
    const treinos = dias.filter((d) => !d.descanso).length;
    const descansoCount = 7 - treinos;
    const volumeH = Math.round((volumeMin / 60) * 10) / 10;

    const porCategoria = [0, 0, 0];
    dias.forEach((d) => (d.blocos || []).forEach((b) => { porCategoria[ZONA_CATEGORIA[b.zona] ?? 0] += b.min; }));
    const totalZona = porCategoria.reduce((a, b) => a + b, 0);
    const pct = porCategoria.map((v) => (totalZona ? Math.round((v / totalZona) * 100) : 0));

    const barraHTML = CATEGORIA_LABELS.map((_, i) => (pct[i] > 0 ? `<span style="width:${pct[i]}%;background:${CATEGORIA_CORES[i]}"></span>` : '')).join('');
    const legendaHTML = totalZona
      ? CATEGORIA_LABELS.map((lbl, i) => (pct[i] > 0 ? `<span><span class="tia-zonabar-dot" style="background:${CATEGORIA_CORES[i]}"></span>${esc(lbl)} ${pct[i]}%</span>` : '')).join('')
      : '<span>Sem dados de zona.</span>';

    return `
      <div class="tia-stat"><div class="tia-stat-label tia-stat-label--accent">Objetivo da semana</div><p class="tia-objetivo-text">${esc(_dados.objetivo)}</p></div>
      <div class="tia-stat"><div class="tia-stat-label">Volume</div><div class="tia-stat-value">${volumeH}<small>H</small></div></div>
      <div class="tia-stat"><div class="tia-stat-label">Treinos</div><div class="tia-stat-value">${treinos}</div></div>
      <div class="tia-stat"><div class="tia-stat-label">Descanso</div><div class="tia-stat-value" style="color:var(--muted)">${descansoCount}</div></div>
      <div class="tia-stat">
        <div class="tia-stat-label">Distribuição de zonas</div>
        <div class="tia-zonabar">${barraHTML}</div>
        <div class="tia-zonabar-legend">${legendaHTML}</div>
      </div>
    `;
  }

  function render() {
    const body = $('treino-ia-body');
    if (!body || !_dados) return;
    const dias = diasOrdenados();
    if (dias.length !== 7) { mostrarVazio('Plano incompleto — gere um novo.'); return; }
    if (_selIdx < 0) _selIdx = 6;
    if (_selIdx > 6) _selIdx = 0;
    const sel = dias[_selIdx];
    const nextIdx = proximoTreinoIdx(dias, _selIdx);
    const next = dias[nextIdx];
    const weekLabel = `Semana · ${fmtData(dias[0].data)}–${fmtData(dias[6].data)}`;

    body.innerHTML = `
      <div class="tia-summary">${resumoSemanaHTML(dias)}</div>
      <div class="tia-week-label"><span>${esc(weekLabel)}</span><span class="tia-week-hint"><i class="fa-solid fa-hand-pointer"></i> Clique em um dia para ver o detalhe</span></div>
      <div class="tia-week"><div class="tia-week-grid">${dias.map((d, i) => diaCardHTML(d, i, _selIdx)).join('')}</div></div>
      <div class="tia-detail">
        <div class="tia-detail-stripe"></div>
        <div class="tia-detail-caret" style="left:calc(${((_selIdx + 0.5) / 7) * 100}% - 8px)"></div>
        ${detailHTML(sel, next)}
      </div>
      <div class="tia-footer">
        <span>Gerado em ${esc(fmtDataHora(_geradoEm))}${esc(rotuloProvider(_dados))}</span>
        <span style="display:flex;gap:8px">
          <button type="button" class="tia-chevron" id="tia-prev-day"><i class="fa-solid fa-chevron-left"></i></button>
          <button type="button" class="tia-chevron" id="tia-next-day"><i class="fa-solid fa-chevron-right"></i></button>
        </span>
      </div>
    `;

    body.querySelectorAll('.tia-day').forEach((el) => {
      const ir = () => { _selIdx = parseInt(el.dataset.idx, 10); render(); };
      el.addEventListener('click', ir);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
    });
    body.querySelector('[data-next="1"]')?.addEventListener('click', () => { _selIdx = nextIdx; render(); });
    $('tia-prev-day')?.addEventListener('click', () => { _selIdx = (_selIdx + 6) % 7; render(); });
    $('tia-next-day')?.addEventListener('click', () => { _selIdx = (_selIdx + 1) % 7; render(); });
  }

  function mostrarVazio(msg) {
    const empty = $('treino-ia-empty');
    const body = $('treino-ia-body');
    if (!empty || !body) return;
    empty.hidden = false;
    if (msg) empty.textContent = msg;
    body.hidden = true;
    _dados = null;
  }

  function mostrarResultado(payload, geradoEm) {
    const empty = $('treino-ia-empty');
    const body = $('treino-ia-body');
    if (!empty || !body) return;
    empty.hidden = true;
    body.hidden = false;
    _dados = payload;
    _geradoEm = geradoEm;
    _hoje = new Date().toISOString().slice(0, 10);
    const dias = diasOrdenados();
    const idxHoje = dias.findIndex((d) => d.data === _hoje);
    _selIdx = idxHoje >= 0 ? idxHoje : 0;
    render();
  }

  // ── Navegação por teclado (só quando a seção está visível) ─────────────
  function onKeydown(e) {
    if (!_dados) return;
    const section = $('treino-ia');
    if (!section || section.style.display === 'none') return;
    if (e.key === 'ArrowLeft') { _selIdx = (_selIdx + 6) % 7; render(); }
    else if (e.key === 'ArrowRight') { _selIdx = (_selIdx + 1) % 7; render(); }
  }

  // ── Intake + geração (perfil, insumos, POST) ────────────────────────────
  function perfilCompleto(u) {
    return Array.isArray(u.objetivosPrioridade) && u.objetivosPrioridade.length > 0
      && Array.isArray(u.diasDisponiveis) && u.diasDisponiveis.length > 0
      && !!u.duracaoSessaoMin && !!u.diaLongao && !!u.nivelExperiencia;
  }

  // Insumos 100% calculados no frontend — a IA nunca recebe dados brutos pra
  // recalcular (ADR-0002/0004, mesma regra da Análise de Performance).
  async function montarInsumos(u) {
    const unified = await window.Api.get('/activities/unified?days=365').catch(() => ({ items: [] }));
    const activities = (unified && unified.items) || [];
    const { ctl, atl, tsb } = window.Metrics.calcTSBMetrics(activities, u.fcMax);

    const pesoAnalise = window.WeightStats.weightAnalysis(u, window.Storage.getWeights());
    const tendenciaPeso = pesoAnalise.ok ? { taxaKgSem: pesoAnalise.taxaKgSem, msg: pesoAnalise.msg } : null;

    const calib = u.fcMax ? await window.Api.get('/garmin/calibration?fcMax=' + u.fcMax).catch(() => null) : null;
    const limiares = calib ? {
      zonaAltaMinPct: calib.zonaAltaMinPct,
      tssRecuperacaoIgnorada: calib.tssRecuperacaoIgnorada,
      tsbSobrecarga: calib.tsbSobrecarga,
      fallback: calib.fallback,
    } : null;

    return { ctl, atl, tsb, tendenciaPeso, limiares };
  }

  async function gerar() {
    const btn = $('treino-ia-btn-gerar');
    if (!btn || btn.disabled) return;
    const u = window.Storage.getUser();

    if (!perfilCompleto(u)) {
      window.toast?.('Complete suas preferências de Treino IA no perfil antes de gerar um plano', { kind: 'error' });
      window.openProfileModal?.();
      return;
    }

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando…';

    try {
      const insumos = await montarInsumos(u);
      // O backend lê o perfil (objetivos/dias/duração/...) direto do perfil já
      // validado no banco — o corpo do POST só leva `insumos`.
      const resp = await window.Api.post('/weekly-training-plan', { insumos });
      if (resp && resp.ok) {
        mostrarResultado(resp.payload, resp.geradoEm);
        window.toast?.('Plano gerado');
      }
    } catch (err) {
      console.error('[weekly-training-plan]', err);
      const corpo = err && err.body;
      if (corpo && corpo.cache) {
        mostrarResultado(corpo.cache.payload, corpo.cache.geradoEm);
        window.toast?.('Não foi possível gerar um novo plano agora — mostrando o último salvo', { kind: 'error' });
      } else {
        mostrarVazio((corpo && corpo.error) || err.message || 'Plano indisponível no momento.');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  // ── Popup "Planos anteriores" (Modals.open) ─────────────────────────────
  // Selecionar reativa o plano (ativo=1, desativa o atual); excluir e
  // "limpar histórico" nunca tocam no plano ativo — a API já garante isso
  // (server/services/weekly-training-plan.js), aqui só desabilita os
  // controles pra não dar a falsa impressão de que dá pra tentar.
  function historicoLinhaHTML(it) {
    const desabilitado = it.ativo ? 'disabled' : '';
    return `<div class="tia-hist-row" data-id="${it.id}">
      <div class="tia-hist-info">
        <div class="tia-hist-data">${esc(fmtDataHora(it.geradoEm))}${it.ativo ? ' <span class="tia-hist-badge">ATUAL</span>' : ''}</div>
        <div class="tia-hist-objetivo">${esc(it.objetivo || '(sem objetivo registrado)')}</div>
      </div>
      <div class="tia-hist-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="selecionar" ${desabilitado}>Selecionar</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="excluir" ${desabilitado}>Excluir</button>
      </div>
    </div>`;
  }

  async function buscarHistoricoItens() {
    const resp = await window.Api.get('/weekly-training-plan/historico').catch(() => ({ ok: false }));
    return (resp && resp.ok && resp.itens) || [];
  }

  function historicoBodyHTML(itens) {
    const temInativos = itens.some((it) => !it.ativo);
    const lista = itens.length
      ? itens.map(historicoLinhaHTML).join('')
      : '<p style="color:var(--muted2);">Nenhum plano gerado ainda.</p>';
    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button type="button" class="btn btn-danger btn-sm" id="tia-hist-limpar" ${temInativos ? '' : 'disabled'}>Limpar histórico</button>
      </div>
      <div id="tia-hist-lista" style="display:flex;flex-direction:column;gap:10px;">${lista}</div>
    `;
  }

  function wireHistoricoModal(modal) {
    modal.querySelector('#tia-hist-limpar')?.addEventListener('click', async () => {
      const ok = await window.Modals.confirm({
        title: 'Excluir todos os planos anteriores?',
        message: 'O plano atual é preservado — só os planos inativos são excluídos.',
        confirmLabel: 'Limpar histórico',
        danger: true,
      });
      if (!ok) return;
      const resp = await window.Api.del('/weekly-training-plan/historico').catch(() => null);
      if (!resp || !resp.ok) { window.toast?.('Falha ao limpar histórico', { kind: 'error' }); return; }
      window.toast?.(resp.excluidos + ' plano(s) excluído(s)');
      abrirHistorico();
    });

    modal.querySelectorAll('.tia-hist-row').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-act="selecionar"]')?.addEventListener('click', async () => {
        const resp = await window.Api.post('/weekly-training-plan/' + id + '/ativar', {}).catch(() => null);
        if (!resp || !resp.ok) { window.toast?.('Falha ao selecionar o plano', { kind: 'error' }); return; }
        window.Modals.close();
        mostrarResultado(resp.payload, resp.geradoEm);
        window.toast?.('Plano reativado');
      });
      row.querySelector('[data-act="excluir"]')?.addEventListener('click', async () => {
        const ok = await window.Modals.confirm({
          title: 'Excluir este plano?',
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        const resp = await window.Api.del('/weekly-training-plan/' + id).catch(() => null);
        if (!resp || !resp.ok) { window.toast?.((resp && resp.error) || 'Falha ao excluir o plano', { kind: 'error' }); return; }
        window.toast?.('Plano excluído');
        abrirHistorico();
      });
    });
  }

  async function abrirHistorico() {
    const itens = await buscarHistoricoItens();
    window.Modals.open({
      tag: 'Treino IA',
      title: 'Planos anteriores',
      bodyHTML: historicoBodyHTML(itens),
      actions: [{ label: 'Fechar', kind: 'ghost', onClick: () => window.Modals.close() }],
      onMount: (modal) => wireHistoricoModal(modal),
    });
  }

  async function load() {
    const btn = $('treino-ia-btn-gerar');
    if (btn && !btn._wiredWeeklyTrainingPlan) {
      btn._wiredWeeklyTrainingPlan = true;
      btn.addEventListener('click', gerar);
    }
    const histBtn = $('treino-ia-historico-toggle');
    if (histBtn && !histBtn._wiredWeeklyTrainingPlan) {
      histBtn._wiredWeeklyTrainingPlan = true;
      histBtn.addEventListener('click', abrirHistorico);
    }
    if (!document._wiredWeeklyTrainingPlanKeydown) {
      document._wiredWeeklyTrainingPlanKeydown = true;
      document.addEventListener('keydown', onKeydown);
    }

    try {
      const resp = await window.Api.get('/weekly-training-plan').catch(() => ({ ok: false }));
      if (resp && resp.ok) {
        mostrarResultado(resp.payload, resp.geradoEm);
      } else {
        mostrarVazio();
      }
    } catch (err) {
      console.error('[weekly-training-plan]', err);
      mostrarVazio('Falha ao carregar o plano de treino.');
    }
  }

  window.WeeklyTrainingPlanUI = { load };
})();
