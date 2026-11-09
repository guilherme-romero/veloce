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
  // #158: delega no helper único de js/utils.js. Havia QUATRO cópias desta
  // função e elas divergiram: duas rotulavam " UTC" (certo, mas ilegível) e
  // duas liam o timestamp do SQLite como hora local, mostrando 3h errado sem
  // nenhum rótulo. Utils.fmtDataHoraLocal resolve as duas no mesmo lugar.
  function fmtDataHora(iso) { return Utils.fmtDataHoraLocal(iso); }
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
  // Trava de reentrada da geração. Não basta o `disabled` do botão: o header
  // é recriado a cada onEnter, então sair e voltar à aba no meio de uma
  // geração entregaria um botão novo, habilitado, e permitiria disparar outra
  // chamada em paralelo (Issue #133).
  let _gerando = false;

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

    // #160: aviso de plano vencido, mesmo critério do desktop. O texto sai das
    // DATAS do plano — não afirma nada sobre falha de geração, porque a trilha
    // de tentativas falhas é só para diagnóstico e não alimenta a interface.
    const aviso = view.querySelector('#mtia-vencido');
    if (aviso) {
      const vencido = dias[0].data !== Utils.segundaDaSemanaISO();
      aviso.hidden = !vencido;
      aviso.innerHTML = vencido ? `
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div>
          <strong>Plano de ${esc(fmtData(dias[0].data))}–${esc(fmtData(dias[6].data))}</strong>
          <span>Não há plano para a semana atual.</span>
        </div>` : '';
    }

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
        <div id="mtia-vencido" class="mtia-vencido" hidden role="status"></div>
        <div id="mtia-strip" class="mtia-strip"></div>
        <div class="m-card mtia-detail" id="mtia-detail"></div>
        <div class="m-card" id="mtia-objetivo" style="margin-top:14px;"></div>
        <p class="m-sub" id="mtia-meta" style="text-align:center;margin-top:10px;"></p>
      </div>
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
    const _h = new Date();
    _hoje = window.Utils.dataLocalISO(_h);   // #151 — fonte única (local, não UTC)
    const dias = diasOrdenados();
    // Seleciona pelo dia-da-semana real (não pela data exata): o plano pode
    // estar cacheado com as datas da semana em que foi gerado, então casar por
    // data falharia e cairia sempre em SEG. O highlight is-today segue por _hoje.
    const dowNome = DIAS_SEMANA[(_h.getDay() + 6) % 7]; // domingo=0 → índice 6
    const idxHoje = dias.findIndex((d) => d.dia === dowNome);
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

  // Conteúdo padrão do botão Gerar, compartilhado entre o markup do header e a
  // restauração pós-geração — um só lugar para mudar o rótulo/ícone.
  const BTN_GERAR_HTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar';

  function marcarGerando(btn) {
    if (!btn) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    // No loading sobra só o spinner, sem texto: sem rótulo explícito o botão
    // fica sem anúncio nenhum em leitor de tela.
    btn.setAttribute('aria-label', 'Gerando plano');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }

  function desmarcarGerando(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-label');
    btn.innerHTML = BTN_GERAR_HTML;
  }

  async function gerar() {
    // Os botões desta tela vivem no header do shell (#m-header-actions), que
    // é IRMÃO da view — nunca descendente. Buscar pela view devolve null e o
    // clique morre em silêncio (BUG da Issue #131): sempre getElementById.
    const btn = document.getElementById('mtia-btn-gerar');
    if (!btn || btn.disabled || _gerando) return;
    const u = Storage.getUser();

    if (!perfilCompleto(u)) {
      window.toast?.('Complete suas preferências de Treino no perfil (desktop) antes de gerar um plano', { kind: 'error' });
      return;
    }

    _gerando = true;
    marcarGerando(btn);
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
      _gerando = false;
      // O botão pode ter sido recriado pelo setHeader enquanto a geração
      // rodava (sair e voltar da aba) — reseta o que estiver no DOM agora.
      desmarcarGerando(document.getElementById('mtia-btn-gerar') || btn);
    }
  }

  // #137: histórico paginado (5 por página), mostrando data, badge de ATUAL,
  // estrela de favorito e o objetivo — antes era só 'Plano #7 — <data>'.
  //
  // #167: deixou de ser só leitura. Na #137 (v2.12.12) nasceu assim por decisão
  // do usuário ("por hora somente o 1"), e a paridade ficou como follow-up em
  // MELHORIAS.md; em 2026-11-09 ele pediu a paridade completa, então aqui estão
  // as mesmas quatro ações do modal do desktop, sobre as MESMAS rotas.
  //
  // E deixou de ser uma lista no fim da tela: abre em bottom sheet. Não há
  // sistema de modal novo — css/mobile-sheet.css redefine as classes que o
  // js/modals.js emite, então QUALQUER Modals.open() já vira sheet aqui (é o
  // que js/mobile/rides-mobile.js faz desde a v2.9.x).
  let _histPagina = 1;

  function histItemHTML(it) {
    const badges = [];
    // #160: mesmo critério do desktop — `ativo` diz que o app está usando o
    // plano, não que ele é o desta semana. Com a geração automática falhando,
    // o anterior segue ativo, e rotular ATUAL afirmaria algo falso.
    if (it.ativo) {
      badges.push(!it.semanaInicio || it.semanaInicio === Utils.segundaDaSemanaISO()
        ? '<span class="mtia-hist-badge">ATUAL</span>'
        : '<span class="mtia-hist-badge mtia-hist-badge-velho">SEM. PASSADA</span>');
    }
    // As regras de habilitação vêm do desktop e NÃO podem divergir: o plano em
    // uso e os favoritados são protegidos de exclusão no backend (#137), então
    // oferecer o botão ativo aqui só produziria um erro 4xx na cara do usuário.
    const naoExcluivel = it.ativo || it.favorito;
    const tituloExcluir = it.ativo ? 'O plano atual não pode ser excluído'
                        : it.favorito ? 'Desfavorite antes de excluir' : 'Excluir este plano';
    return `<div class="mtia-hist-item" data-id="${it.id}">
      <div class="mtia-hist-topo">
        <span class="m-sub">${esc(fmtDataHora(it.geradoEm))}</span>
        <span class="mtia-hist-badges">${badges.join(' ')}</span>
      </div>
      <p class="mtia-hist-obj">${esc(it.objetivo || '(sem objetivo registrado)')}</p>
      <div class="mtia-hist-acoes">
        <button type="button" class="btn btn-ghost btn-sm mtia-hist-fav" data-act="favorito"
                aria-pressed="${it.favorito ? 'true' : 'false'}"
                title="${it.favorito ? 'Remover dos favoritos' : 'Favoritar — protege de exclusão e do teto de 30'}"
                aria-label="${it.favorito ? 'Remover dos favoritos' : 'Favoritar plano'}"
          ><i class="fa-${it.favorito ? 'solid' : 'regular'} fa-star"></i></button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="selecionar" ${it.ativo ? 'disabled' : ''}>Selecionar</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="excluir" ${naoExcluivel ? 'disabled' : ''}
                title="${esc(tituloExcluir)}">Excluir</button>
      </div>
    </div>`;
  }

  function historicoBodyHTML(resp) {
    const itens = resp.itens || [];
    if (!itens.length) return '<p class="m-sub">Nenhum plano anterior.</p>';
    // "Limpar histórico" só faz sentido se houver algo que ele de fato apague:
    // o ativo e os favoritados sobrevivem (#137).
    const temApagavel = itens.some((it) => !it.ativo && !it.favorito);
    const pag = resp.totalPaginas > 1
      ? `<div class="mtia-hist-pag">
           <button type="button" class="m-iconbtn" id="mtia-hist-prev" ${resp.pagina <= 1 ? 'disabled' : ''}
                   aria-label="Página anterior"><i class="fa-solid fa-chevron-left"></i></button>
           <span class="m-sub">Página ${resp.pagina} de ${resp.totalPaginas} · ${resp.total} plano(s)</span>
           <button type="button" class="m-iconbtn" id="mtia-hist-next" ${resp.pagina >= resp.totalPaginas ? 'disabled' : ''}
                   aria-label="Próxima página"><i class="fa-solid fa-chevron-right"></i></button>
         </div>`
      : '';
    return `
      <div class="mtia-hist-topo-acoes">
        <button type="button" class="btn btn-danger btn-sm" id="mtia-hist-limpar" ${temApagavel ? '' : 'disabled'}
                title="Preserva o plano atual e os favoritados">Limpar histórico</button>
      </div>
      ${itens.map(histItemHTML).join('')}
      ${pag}`;
  }

  async function buscarHistorico(pagina) {
    const resp = await Api.get('/weekly-training-plan/historico?page=' + pagina).catch(() => ({ ok: false }));
    if (!resp || !resp.ok) return null;
    return resp;
  }

  async function abrirHistorico(pagina = 1) {
    // Coerção defensiva, pelo mesmo motivo do desktop: esta função já é ligada
    // direto como handler de clique, e um MouseEvent aqui viraria `?page=NaN`.
    const n = Math.floor(Number(pagina));
    const resp = await buscarHistorico(Number.isFinite(n) && n >= 1 ? n : 1);
    if (!resp) {
      if (window.toast) toast('Falha ao carregar o histórico', { kind: 'error' });
      return;
    }
    // A página pedida pode não existir mais (último item dela foi excluído):
    // o backend devolve lista vazia, então recua para a que existe.
    if (!resp.itens.length && resp.total > 0 && resp.pagina > resp.totalPaginas) {
      return abrirHistorico(resp.totalPaginas);
    }
    _histPagina = resp.pagina;
    Modals.open({
      tag: 'Treino',
      title: 'Planos anteriores',
      bodyHTML: historicoBodyHTML(resp),
      actions: [{ label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() }],
      onMount: (sheet) => wireHistoricoSheet(sheet),
    });
  }

  function wireHistoricoSheet(sheet) {
    sheet.querySelector('#mtia-hist-limpar')?.addEventListener('click', async () => {
      const ok = await Modals.confirm({
        title: 'Excluir todos os planos anteriores?',
        message: 'O plano atual e os favoritados são preservados — só os demais inativos são excluídos.',
        confirmLabel: 'Limpar histórico',
        danger: true,
      });
      if (!ok) return;
      const resp = await Api.del('/weekly-training-plan/historico').catch(() => null);
      if (!resp || !resp.ok) { if (window.toast) toast('Falha ao limpar histórico', { kind: 'error' }); return; }
      if (window.toast) toast(resp.excluidos + ' plano(s) excluído(s)');
      abrirHistorico(1);   // a lista encolheu — volta ao começo
    });

    // Paginação remonta o sheet inteiro: a lista é curta (5 por página) e
    // remontar evita estado parcial entre a página e a lista. Mesma decisão do
    // desktop.
    sheet.querySelector('#mtia-hist-prev')?.addEventListener('click', () => { abrirHistorico(_histPagina - 1); });
    sheet.querySelector('#mtia-hist-next')?.addEventListener('click', () => { abrirHistorico(_histPagina + 1); });

    sheet.querySelectorAll('.mtia-hist-item').forEach((item) => {
      const id = item.dataset.id;
      item.querySelector('[data-act="favorito"]')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const novo = btn.getAttribute('aria-pressed') !== 'true';
        btn.disabled = true;
        const resp = await Api.post('/weekly-training-plan/' + id + '/favorito', { favorito: novo }).catch(() => null);
        btn.disabled = false;
        if (!resp || !resp.ok) { if (window.toast) toast('Falha ao favoritar', { kind: 'error' }); return; }
        if (window.toast) toast(resp.favorito ? 'Plano favoritado' : 'Favorito removido');
        abrirHistorico(_histPagina);   // reflete o botão Excluir, que depende disto
      });
      item.querySelector('[data-act="selecionar"]')?.addEventListener('click', async () => {
        const resp = await Api.post('/weekly-training-plan/' + id + '/ativar', {}).catch(() => null);
        if (!resp || !resp.ok) { if (window.toast) toast('Falha ao selecionar o plano', { kind: 'error' }); return; }
        Modals.close();
        mostrarResultado(resp.payload, resp.geradoEm);
        if (window.toast) toast('Plano reativado');
      });
      item.querySelector('[data-act="excluir"]')?.addEventListener('click', async () => {
        const ok = await Modals.confirm({ title: 'Excluir este plano?', confirmLabel: 'Excluir', danger: true });
        if (!ok) return;
        const resp = await Api.del('/weekly-training-plan/' + id).catch(() => null);
        if (!resp || !resp.ok) { if (window.toast) toast((resp && resp.error) || 'Falha ao excluir o plano', { kind: 'error' }); return; }
        if (window.toast) toast('Plano excluído');
        abrirHistorico(_histPagina);
      });
    });
  }

  function headerActions() {
    return `
      <button type="button" class="m-iconbtn" id="mtia-btn-historico" aria-label="Planos anteriores"><i class="fa-solid fa-clock-rotate-left"></i></button>
      <button type="button" class="m-btn m-btn-primary" id="mtia-btn-gerar">${BTN_GERAR_HTML}</button>
    `;
  }

  async function load() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const gen = ++_gen;
    view.innerHTML = skeleton();
    MShell.wireSegment(view);
    // Os dois botões vivem no header (#m-header-actions), recriado a cada
    // onEnter pelo MShell.setHeader: o bind é aqui e por getElementById —
    // view.querySelector não os alcança (Issue #131).
    const btnGerar = document.getElementById('mtia-btn-gerar');
    btnGerar?.addEventListener('click', gerar);
    // Botão recriado no meio de uma geração em voo: reflete o estado real.
    if (_gerando) marcarGerando(btnGerar);
    document.getElementById('mtia-btn-historico')?.addEventListener('click', () => abrirHistorico(1));

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
    viewId: VIEW_ID,
    label: 'Treino',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Semana padrão via IA', title: 'TREINO', actions: headerActions() });
      load();
    },
    onLeave: () => { _gen++; },
  });
})();
