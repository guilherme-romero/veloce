/* ═══════════════════════════════════════════════════════════════════════
   TREINO IA MOBILE — Plano de Treino Semanal (IDEIA-7, Issue #1).
   Layout do handoff (treino_bike_docs/handoff_treino_ia/mobile): faixa
   compacta de 7 dias + card de detalhe com swipe, acessado pelo seletor
   segmentado "Treino IA | Histórico" dentro da tab Atividades (ver
   activities-mobile.js, MShell.segmentAtividades) — não há tab própria na
   tab bar; o ícone "Ativid." fica aceso (tab: 'atividades' no registro).

   Mesmo motor/contrato de dados do desktop (js/weekly-training-plan.js):
   nenhuma lógica de domínio nova aqui, só a camada de apresentação —
   mesma decisão de duplicar (não compartilhar) já usada entre as versões
   desktop/mobile do resto da seção Desempenho.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-treino-ia';
  const esc = MShell.esc;

  const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
  const DOW_LABEL = { segunda: 'SEG', terca: 'TER', quarta: 'QUA', quinta: 'QUI', sexta: 'SEX', sabado: 'SÁB', domingo: 'DOM' };
  const DIA_FULL = { segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado', domingo: 'Domingo' };
  const LABEL_TIPO = { resistencia: 'Resistência', intervalado: 'Intervalado', longao: 'Longão', descanso: 'Descanso' };
  const ZONA_VAR = { z1: '--blue', z2: '--yellow', z3: '--green', z4: '--red', z5: '--purple', z6: '--pink' };
  const CATEGORIA_LABELS = ['Resistência', 'Limiar lático', 'Esforço máximo'];
  const CATEGORIA_CORES = ['var(--blue)', 'var(--amber)', 'var(--red)'];
  const ZONA_CATEGORIA = { z1: 0, z2: 0, z3: 1, z4: 1, z5: 2, z6: 2 };

  function fmtData(iso) {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''); }
    catch (_) { return iso; }
  }
  // `gerado_em` vem do SQLite como "YYYY-MM-DD HH:MM:SS" (CURRENT_TIMESTAMP,
  // sempre UTC), sem indicador de fuso — normaliza pra ISO com "Z" explícito
  // antes de formatar, e exibe em UTC (não no fuso do aparelho) pra bater
  // sempre com o que está no banco.
  function fmtDataHora(iso) {
    try {
      const isoUtc = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z';
      const d = new Date(isoUtc);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '')
        + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
    } catch (_) { return iso; }
  }
  function rotuloProvider(payload) {
    if (!payload.provider || !payload.model) return '';
    const nome = payload.provider === 'gemini' ? 'Gemini' : 'Groq';
    return ' · via ' + nome + ' · ' + payload.model;
  }

  let _dados = null;
  let _geradoEm = null;
  let _selIdx = 0;
  let _hoje = null;
  let _gen = 0;

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
      return `<span style="flex-grow:${Math.max(1, b.min)};height:${Math.round((b.intensidade || 0) * 100)}%;background:var(${ZONA_VAR[b.zona] || '--muted'});opacity:${op}"></span>`;
    }).join('');
  }
  function blocosLegendaTexto(blocos) {
    return (blocos || []).map((b) => (b.rotulo ? b.rotulo + ' ' : '') + b.min + '′').join(' · ');
  }

  function stripHTML(dias, selIdx) {
    return dias.map((dia, i) => {
      const selected = i === selIdx;
      const hoje = dia.data === _hoje;
      const classes = ['mtia-chip'];
      if (dia.descanso) classes.push('is-rest');
      if (selected) classes.push('is-selected');
      else if (hoje) classes.push('is-today');
      const barVar = dia.descanso ? '--border' : tipoCorVar(dia);
      return `<div class="${classes.join(' ')}" data-idx="${i}" role="button" aria-pressed="${selected}">
        <span class="mtia-chip-dow">${esc(DOW_LABEL[dia.dia])}</span>
        <span class="mtia-chip-num">${esc(fmtData(dia.data).slice(0, 2))}</span>
        <span class="mtia-chip-bar" style="background:var(${barVar})"></span>
      </div>`;
    }).join('');
  }

  function detailHTML(dia, next) {
    const hoje = dia.data === _hoje;
    const dayPill = hoje ? `Hoje · ${DOW_LABEL[dia.dia]}` : `${DOW_LABEL[dia.dia]} · ${fmtData(dia.data)}`;
    const dayPillClass = hoje ? 'mtia-pill mtia-pill--day-today' : 'mtia-pill mtia-pill--day';
    const corVar = tipoCorVar(dia);
    const tipoLabel = LABEL_TIPO[dia.tipo] || dia.tipo;
    const hlA = dia.descanso ? 'DIA DE' : dia.titulo.a;
    const hlB = dia.descanso ? 'DESCANSO' : dia.titulo.b;

    const bodyHTML = dia.descanso
      ? `<div class="mtia-rest-tips">
          <div class="mtia-rest-tip"><i class="fa-solid fa-bed"></i>Sono de qualidade</div>
          <div class="mtia-rest-tip"><i class="fa-solid fa-person-walking"></i>Caminhada leve opcional</div>
          <div class="mtia-rest-tip"><i class="fa-solid fa-droplet"></i>Hidratação e alimentação</div>
        </div>`
      : `<div>
          <div class="mtia-effort"><div class="mtia-effort-line"></div>${blocosHTML(dia.blocos)}</div>
          <div class="mtia-effort-legend">${esc(blocosLegendaTexto(dia.blocos))}</div>
        </div>`;

    const durVal = dia.descanso ? '0' : (dia.duracaoMin >= 60 ? String(dia.duracaoMin / 60).replace('.', ',') : String(dia.duracaoMin));
    const durUnit = dia.descanso ? 'MIN' : (dia.duracaoMin >= 60 ? 'H' : 'MIN');
    const rpeShow = dia.descanso ? '0' : `${dia.rpe[0]}–${dia.rpe[1]}`;
    const rpeHi = dia.rpe[1];
    const rpeSegs = Array.from({ length: 10 }, (_, k) => {
      let bg = 'var(--border)';
      if (!dia.descanso && k < rpeHi) bg = rpeHi >= 7 ? (k < 4 ? 'var(--blue)' : 'var(--red)') : `var(${corVar})`;
      return `<span class="mtia-rpe-seg" style="background:${bg}"></span>`;
    }).join('');

    return `
      <div class="mtia-detail-stripe"></div>
      <div class="mtia-detail-top">
        <div class="mtia-pills">
          <span class="${dayPillClass}">${esc(dayPill)}</span>
          <span class="mtia-pill" style="background:color-mix(in srgb, var(${corVar}) 16%, transparent);color:var(${corVar})">${esc(tipoLabel)}</span>
        </div>
        <div class="mtia-detail-arrows">
          <button type="button" class="mtia-arrow" id="mtia-prev-day"><i class="fa-solid fa-chevron-left"></i></button>
          <button type="button" class="mtia-arrow" id="mtia-next-day"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
      </div>
      <div class="mtia-title">${esc(hlA)} <span style="color:var(${corVar})">${esc(hlB)}</span></div>
      <p class="mtia-desc">${esc(dia.descricao)}</p>
      ${bodyHTML}
      <div class="mtia-grid2">
        <div class="mtia-side-card"><div class="mtia-side-label">Duração</div><div class="mtia-side-value">${esc(durVal)}<small>${durUnit}</small></div></div>
        <div class="mtia-side-card">
          <div class="mtia-side-label">Esforço</div>
          <div class="mtia-side-value">${esc(rpeShow)}<small>/10</small></div>
          <div class="mtia-rpe-grid">${rpeSegs}</div>
        </div>
      </div>
      <div class="mtia-next-card" data-next="1">
        <div class="mtia-next-info">
          <div class="mtia-side-label">Próximo treino</div>
          <div class="mtia-next-label">${esc(DIA_FULL[next.dia])} · ${esc(LABEL_TIPO[next.tipo] || next.tipo)}</div>
        </div>
        <span class="mtia-next-sub" style="color:var(${tipoCorVar(next)})">${next.descanso ? 'Descanso' : next.duracaoMin + '′ · RPE ' + next.rpe[0] + '–' + next.rpe[1]}</span>
        <i class="fa-solid fa-arrow-right" style="color:var(--muted)"></i>
      </div>
    `;
  }

  function objetivoHTML(dias) {
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
      ? CATEGORIA_LABELS.map((lbl, i) => (pct[i] > 0 ? `<span class="mdesemp-zone-legend__item"><span class="mdesemp-zone-legend__swatch" style="background:${CATEGORIA_CORES[i]}"></span>${esc(lbl)} ${pct[i]}%</span>` : '')).join('')
      : '<span class="mdesemp-zone-legend__item">Sem dados de zona.</span>';

    return `
      <div class="m-eyebrow" style="color:var(--lime);margin-bottom:8px;">Objetivo da semana</div>
      <p class="mtia-objetivo-text">${esc(_dados.objetivo)}</p>
      <div class="mtia-stats3">
        <div><div class="m-num m-num-sm">${volumeH}<small class="m-unit">H</small></div><div class="mtia-stat-label">volume</div></div>
        <div><div class="m-num m-num-sm">${treinos}</div><div class="mtia-stat-label">treinos</div></div>
        <div><div class="m-num m-num-sm" style="color:var(--muted)">${descansoCount}</div><div class="mtia-stat-label">descanso</div></div>
      </div>
      <div class="mtia-zonabar">${barraHTML}</div>
      <div class="mdesemp-zone-legend">${legendaHTML}</div>
    `;
  }

  function render() {
    const view = document.getElementById(VIEW_ID);
    if (!view || !_dados) return;
    const dias = diasOrdenados();
    if (dias.length !== 7) { mostrarVazio('Plano incompleto — gere um novo.'); return; }
    if (_selIdx < 0) _selIdx = 6;
    if (_selIdx > 6) _selIdx = 0;
    const sel = dias[_selIdx];
    const nextIdx = proximoTreinoIdx(dias, _selIdx);
    const next = dias[nextIdx];

    const strip = view.querySelector('#mtia-strip');
    if (strip) strip.innerHTML = stripHTML(dias, _selIdx);
    const detail = view.querySelector('#mtia-detail');
    if (detail) detail.innerHTML = detailHTML(sel, next);
    const objetivo = view.querySelector('#mtia-objetivo');
    if (objetivo) objetivo.innerHTML = objetivoHTML(dias);
    const meta = view.querySelector('#mtia-meta');
    if (meta) meta.textContent = 'Gerado em ' + fmtDataHora(_geradoEm) + rotuloProvider(_dados);

    strip?.querySelectorAll('.mtia-chip').forEach((el) => {
      el.addEventListener('click', () => { _selIdx = parseInt(el.dataset.idx, 10); render(); });
    });
    detail?.querySelector('[data-next="1"]')?.addEventListener('click', () => { _selIdx = nextIdx; render(); });
    view.querySelector('#mtia-prev-day')?.addEventListener('click', () => { _selIdx = (_selIdx + 6) % 7; render(); });
    view.querySelector('#mtia-next-day')?.addEventListener('click', () => { _selIdx = (_selIdx + 1) % 7; render(); });
    wireSwipe(detail);
  }

  // Swipe horizontal no card de detalhe — limiar de 50px (handoff mobile).
  // render() só troca o innerHTML do card (não recria o nó #mtia-detail),
  // e render() chama wireSwipe() a cada navegação — sem este guard, cada
  // chamada empilharia um novo par de listeners no mesmo elemento.
  function wireSwipe(detail) {
    if (!detail || detail._wiredSwipe) return;
    detail._wiredSwipe = true;
    let startX = null, startY = null;
    detail.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
    }, { passive: true });
    detail.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX, dy = t.clientY - startY;
      startX = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      _selIdx = dx > 0 ? (_selIdx + 6) % 7 : (_selIdx + 1) % 7;
      render();
    }, { passive: true });
  }

  function skeleton() {
    return `
      ${MShell.segmentAtividades('treino-ia')}
      <div id="mtia-empty" class="m-empty">Nenhum plano gerado ainda — toque em "Gerar" para criar sua primeira semana padrão.</div>
      <div id="mtia-body" hidden>
        <div id="mtia-strip" class="mtia-strip"></div>
        <div class="m-card mtia-detail" id="mtia-detail"></div>
        <div class="m-card" id="mtia-objetivo" style="margin-top:14px;"></div>
        <p class="m-sub" id="mtia-meta" style="text-align:center;margin-top:10px;"></p>
      </div>
      <div id="mtia-historico" hidden style="margin-top:14px;"></div>
    `;
  }

  function mostrarVazio(msg) {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const empty = view.querySelector('#mtia-empty');
    const body = view.querySelector('#mtia-body');
    if (empty) { empty.hidden = false; if (msg) empty.textContent = msg; }
    if (body) body.hidden = true;
    _dados = null;
  }

  function mostrarResultado(payload, geradoEm) {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const empty = view.querySelector('#mtia-empty');
    const body = view.querySelector('#mtia-body');
    if (empty) empty.hidden = true;
    if (body) body.hidden = false;
    _dados = payload;
    _geradoEm = geradoEm;
    _hoje = new Date().toISOString().slice(0, 10);
    const dias = diasOrdenados();
    const idxHoje = dias.findIndex((d) => d.data === _hoje);
    _selIdx = idxHoje >= 0 ? idxHoje : 0;
    render();
  }

  function perfilCompleto(u) {
    return Array.isArray(u.objetivosPrioridade) && u.objetivosPrioridade.length > 0
      && Array.isArray(u.diasDisponiveis) && u.diasDisponiveis.length > 0
      && !!u.duracaoSessaoMin && !!u.diaLongao && !!u.nivelExperiencia;
  }

  async function montarInsumos(u) {
    const unified = await window.UnifiedActivities.get(365).catch(() => ({ items: [] }));
    const activities = (unified && unified.items) || [];
    const { ctl, atl, tsb } = Metrics.calcTSBMetrics(activities, u.fcMax);
    const pesoAnalise = WeightStats.weightAnalysis(u, Storage.getWeights());
    const tendenciaPeso = pesoAnalise.ok ? { taxaKgSem: pesoAnalise.taxaKgSem, msg: pesoAnalise.msg } : null;
    const calib = u.fcMax ? await Api.get('/garmin/calibration?fcMax=' + u.fcMax).catch(() => null) : null;
    const limiares = calib ? {
      zonaAltaMinPct: calib.zonaAltaMinPct,
      tssRecuperacaoIgnorada: calib.tssRecuperacaoIgnorada,
      tsbSobrecarga: calib.tsbSobrecarga,
      fallback: calib.fallback,
    } : null;
    return { ctl, atl, tsb, tendenciaPeso, limiares };
  }

  async function gerar() {
    const view = document.getElementById(VIEW_ID);
    const btn = view?.querySelector('#mtia-btn-gerar');
    if (!btn || btn.disabled) return;
    const u = Storage.getUser();

    if (!perfilCompleto(u)) {
      window.toast?.('Complete suas preferências de Treino no perfil (desktop) antes de gerar um plano', { kind: 'error' });
      return;
    }

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const insumos = await montarInsumos(u);
      const resp = await Api.post('/weekly-training-plan', { insumos });
      if (resp && resp.ok) {
        mostrarResultado(resp.payload, resp.geradoEm);
        window.toast?.('Plano gerado');
      }
    } catch (err) {
      console.error('[treino-ia-mobile]', err);
      const corpo = err && err.body;
      if (corpo && corpo.cache) {
        mostrarResultado(corpo.cache.payload, corpo.cache.geradoEm);
        window.toast?.('Não foi possível gerar — mostrando o último plano salvo', { kind: 'error' });
      } else {
        mostrarVazio((corpo && corpo.error) || err.message || 'Plano indisponível no momento.');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  async function carregarHistorico() {
    const view = document.getElementById(VIEW_ID);
    const el = view?.querySelector('#mtia-historico');
    if (!el) return;
    el.hidden = !el.hidden;
    if (el.hidden || el.dataset.loaded) return;
    const resp = await Api.get('/weekly-training-plan/historico').catch(() => ({ ok: false }));
    el.replaceChildren();
    const itens = (resp && resp.ok && resp.itens) || [];
    if (!itens.length) {
      el.textContent = 'Nenhum plano anterior.';
    } else {
      itens.forEach((it) => {
        const p = document.createElement('p');
        p.className = 'm-sub';
        p.textContent = 'Plano #' + it.id + ' — ' + fmtDataHora(it.geradoEm);
        el.appendChild(p);
      });
    }
    el.dataset.loaded = '1';
  }

  function headerActions() {
    return `
      <button type="button" class="m-iconbtn" id="mtia-btn-historico" aria-label="Planos anteriores"><i class="fa-solid fa-clock-rotate-left"></i></button>
      <button type="button" class="m-btn m-btn-primary" id="mtia-btn-gerar"><i class="fa-solid fa-wand-magic-sparkles"></i> Gerar</button>
    `;
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const gen = ++_gen;
    view.innerHTML = skeleton();
    MShell.wireSegment(view);
    view.querySelector('#mtia-btn-gerar')?.addEventListener('click', gerar);
    view.querySelector('#mtia-btn-historico')?.addEventListener('click', carregarHistorico);

    try {
      const resp = await Api.get('/weekly-training-plan').catch(() => ({ ok: false }));
      if (gen !== _gen) return;
      if (resp && resp.ok) mostrarResultado(resp.payload, resp.geradoEm);
      else mostrarVazio();
    } catch (err) {
      if (gen !== _gen) return;
      console.error('[treino-ia-mobile]', err);
      mostrarVazio('Falha ao carregar o plano de treino.');
    }
  }

  MRouter.register({
    slug: 'treino-ia',
    tab: 'atividades',
    viewId: VIEW_ID,
    label: 'Treino',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Semana padrão via IA', title: 'TREINO', actions: headerActions() });
      load();
    },
    onLeave: () => { _gen++; },
  });
})();
