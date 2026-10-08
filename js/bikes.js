/* ═══════════════════════════════════════════════════════════════════════
   BIKES — Garagem virtual (Fase 11.4)
   Cadastro de bicicletas + componentes + log de manutenção.
   Backend: server/routes/bikes.js
═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TIPOS_BIKE = ['Fixa', 'Gravel', 'MTB', 'Speed'];

  // Tipos de componente com vida útil sugerida e padrão de limpeza
  const COMPONENT_TYPES = [
    { key: 'pneu_dianteiro',  label: 'Pneu dianteiro',     vidaUtil: 3000, temLimpeza: false },
    { key: 'pneu_traseiro',   label: 'Pneu traseiro',      vidaUtil: 3000, temLimpeza: false },
    { key: 'corrente',        label: 'Corrente',           vidaUtil: 3000, temLimpeza: true,  intervaloLimpezaKm: 300 },
    { key: 'pastilha_diant',  label: 'Pastilha dianteira', vidaUtil: 2000, temLimpeza: false },
    { key: 'pastilha_tras',   label: 'Pastilha traseira',  vidaUtil: 2000, temLimpeza: false },
    { key: 'disco_diant',     label: 'Disco dianteiro',    vidaUtil: 5000, temLimpeza: false },
    { key: 'disco_tras',      label: 'Disco traseiro',     vidaUtil: 5000, temLimpeza: false },
    { key: 'cassete',         label: 'Cassete',            vidaUtil: 8000, temLimpeza: false },
    { key: 'cabo_freio',      label: 'Cabo/Óleo de freio', vidaUtil: 5000, temLimpeza: false },
    { key: 'outro',           label: 'Outro',              vidaUtil: 2000, temLimpeza: false },
  ];

  const TYPE_LABEL = COMPONENT_TYPES.reduce((acc, c) => {
    acc[c.key] = c.label; return acc;
  }, {});

  const esc     = window.esc     || (s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])));
  const escAttr = window.escAttr || esc;

  let _bikes = [];
  let _componentsByBike = new Map();   // bikeId → array<component>
  let _filterByBike = new Map();       // bikeId → 'todos' | 'atencao'
  let _brands = { marcas: [], modelos: [] };   // cache p/ datalist (Fase 16.1)
  let _customTypes = [];                        // v2.6.0: tipos "Outro (novo)"

  /* ──────────────────────────────────────────────────────────────────
     Helpers
  ─────────────────────────────────────────────────────────────────── */
  function genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Componentes custom têm tipo = 'custom:<id>'; resolve o nome pela lista.
  function customTypeId(tipo) {
    return typeof tipo === 'string' && tipo.startsWith('custom:') ? tipo.slice(7) : null;
  }
  function typeLabel(tipo) {
    if (TYPE_LABEL[tipo]) return TYPE_LABEL[tipo];
    const id = customTypeId(tipo);
    if (id) { const t = _customTypes.find(x => x.id === id); if (t) return t.nome; }
    return tipo;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtKm(v) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km';
  }

  function fmtTempo(s) {
    if (s == null || !isFinite(s) || s <= 0) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
  }

  function fmtElev(m) {
    if (m == null || !isFinite(m)) return '—';
    return Math.round(m).toLocaleString('pt-BR') + ' m';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function yearsAgo(year) {
    if (!year) return '';
    const y = new Date().getFullYear() - parseInt(year, 10);
    if (y < 0 || y > 80) return '';
    return y === 0 ? 'novo' : `${y} ${y === 1 ? 'ano' : 'anos'}`;
  }

  function severityFor(pct) {
    // Sem vida util configurada, pct chega null: `null >= 100` e `null >= 80`
    // sao ambos false e a funcao devolvia 'green' (classe de "ok") para um
    // componente sobre o qual nao se sabe nada (BUG-064). Hoje os call sites
    // so pedem a barra quando ha km/tempo, entao era fragilidade latente.
    if (!Number.isFinite(pct)) return 'neutral';
    if (pct >= 100) return 'red';
    if (pct >= 80)  return 'amber';
    return 'green';
  }

  // Vida útil por tempo: unidades e conversão para dias (médias).
  const TIME_UNITS = {
    dia: { label: 'dias',  singular: 'dia', dias: 1 },
    mes: { label: 'meses', singular: 'mês', dias: 30.44 },
    ano: { label: 'anos',  singular: 'ano', dias: 365.25 },
  };

  // Progresso de vida por tempo de um componente. Retorna null se não configurado
  // (sem valor/unidade válidos ou sem data de início). pct = decorrido / limite.
  function timeLifeOf(c) {
    const u = TIME_UNITS[c.vidaTempoUnidade];
    if (!u || !(c.vidaTempoValor > 0) || !c.dataInstall) return null;
    const inicio = new Date(c.dataInstall + 'T12:00:00');
    if (isNaN(inicio.getTime())) return null;
    const decorridoDias = Math.max(0, (Date.now() - inicio.getTime()) / 86400000);
    const limiteDias = c.vidaTempoValor * u.dias;
    const pct = limiteDias > 0 ? (decorridoDias / limiteDias) * 100 : 0;
    return { pct, decorridoU: Math.floor(decorridoDias / u.dias), limiteU: c.vidaTempoValor, unidade: u };
  }

  // Pressão recomendada só faz sentido para pneus.
  function isTireType(tipo) {
    return tipo === 'pneu_dianteiro' || tipo === 'pneu_traseiro';
  }

  // Componente "precisa de atenção": desgaste >= 80%, limpeza vencendo,
  // ou algum intervalo de serviço com >= 80% decorrido.
  function compNeedsAttention(c) {
    const wearPct = c.vidaUtilKm > 0 ? (c.kmDesgastado / c.vidaUtilKm) * 100 : 0;
    if (wearPct >= 80) return true;
    const tl = timeLifeOf(c);
    if (tl && tl.pct >= 80) return true;
    if (c.temLimpeza && c.intervaloLimpezaKm > 0) {
      const cleanPct = ((c.kmDesdeUltimaLimpeza ?? 0) / c.intervaloLimpezaKm) * 100;
      if (cleanPct >= 80) return true;
    }
    if ((c.intervals || []).some(iv => iv.pct >= 80)) return true;
    return false;
  }

  /* ──────────────────────────────────────────────────────────────────
     Avaliação por estrelas (Fase 16) — input + exibição
  ─────────────────────────────────────────────────────────────────── */
  function starsInputHTML(value) {
    const v = parseInt(value, 10) || 0;
    const stars = [1, 2, 3, 4, 5].map(n =>
      `<button type="button" class="star-btn ${n <= v ? 'filled' : ''}" data-star="${n}" aria-label="${n} estrela${n > 1 ? 's' : ''}">
         <i class="fa-${n <= v ? 'solid' : 'regular'} fa-star"></i>
       </button>`).join('');
    return `<div class="star-input" data-rating="${v}">${stars}
      <button type="button" class="star-clear" data-star="0" title="Limpar nota">limpar</button></div>`;
  }

  function wireStars(root) {
    const box = root.querySelector('.star-input');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-star]');
      if (!t) return;
      const val = parseInt(t.dataset.star, 10) || 0;
      box.dataset.rating = val;
      box.querySelectorAll('.star-btn').forEach(b => {
        const n = parseInt(b.dataset.star, 10);
        const filled = n <= val;
        b.classList.toggle('filled', filled);
        const ic = b.querySelector('i');
        if (ic) ic.className = `fa-${filled ? 'solid' : 'regular'} fa-star`;
      });
    });
  }

  function readStars(root) {
    const box = root.querySelector('.star-input');
    return box ? (parseInt(box.dataset.rating, 10) || 0) : 0;
  }

  // Estrelas estáticas para exibição. `compact` mostra ★ + número (média).
  function starsStatic(value, compact) {
    const v = value || 0;
    if (!v) return '<span class="stars-static muted">sem nota</span>';
    if (compact) {
      const txt = v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      return `<span class="stars-static"><i class="fa-solid fa-star"></i> ${esc(txt)}</span>`;
    }
    const r = Math.round(v);
    let h = '<span class="stars-static">';
    for (let n = 1; n <= 5; n++) h += `<i class="fa-${n <= r ? 'solid' : 'regular'} fa-star"></i>`;
    return h + '</span>';
  }

  async function loadBrands() {
    try {
      const b = await window.Api.get('/bikes/meta/brands');
      _brands = { marcas: b.marcas || [], modelos: b.modelos || [] };
    } catch (e) { _brands = { marcas: [], modelos: [] }; }
  }

  function datalistHTML(id, values) {
    return `<datalist id="${id}">${(values || []).map(v => `<option value="${escAttr(v)}"></option>`).join('')}</datalist>`;
  }

  /* ──────────────────────────────────────────────────────────────────
     Carregamento
  ─────────────────────────────────────────────────────────────────── */
  async function load() {
    try {
      _bikes = await window.Api.get('/bikes');
    } catch (e) {
      console.warn('[Bikes] falha ao carregar', e);
      _bikes = [];
    }
    loadBrands();   // fire-and-forget: alimenta o datalist de marcas/modelos
    try { _customTypes = await window.Api.get('/component-types') || []; }
    catch (e) { console.warn('[Bikes] tipos custom falharam', e); _customTypes = []; }
    // Issue #44: GET /bikes já embute components — elimina as N chamadas
    // paralelas (1 por bike) que existiam antes.
    _componentsByBike.clear();
    _bikes.forEach(b => _componentsByBike.set(b.id, b.components || []));
    render();
  }

  /* ──────────────────────────────────────────────────────────────────
     Render principal
  ─────────────────────────────────────────────────────────────────── */
  function render() {
    const empty = document.getElementById('bikes-empty');
    const list  = document.getElementById('bikes-list');
    if (!empty || !list) return;

    if (_bikes.length === 0) {
      empty.style.display = '';
      list.innerHTML = '';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = _bikes.map(renderBikeCard).join('');
    wireBikeCardHandlers();
  }

  function renderBikeCard(b) {
    const comps = _componentsByBike.get(b.id) || [];
    const isActive = b.active;
    const kmTotal = b.kmTotal || 0;

    const activeBadge = `<div class="bike-active-badge ${isActive ? 'is-active' : 'is-inactive'}">
           <i class="fa-solid fa-circle" style="color:${isActive ? 'var(--lime)' : 'var(--magenta)'}"></i>
           ${isActive ? 'ATIVA' : 'INATIVA'}
           ${isActive
             ? (b.activeSince ? `<span class="bike-active-since">desde ${esc(fmtDate(b.activeSince))}</span>` : '')
             : (b.deactivatedAt ? `<span class="bike-active-since">inativada em ${esc(fmtDate(b.deactivatedAt))}</span>` : '')}
         </div>`;

    const tipoBlock = [b.tipo, b.pesoKg ? `${b.pesoKg} kg` : null, b.ano ? `${b.ano} (${yearsAgo(b.ano)})` : null]
      .filter(Boolean).join(' · ');

    const filter = _filterByBike.get(b.id) || 'todos';
    const atencaoCount = comps.filter(compNeedsAttention).length;
    const visibleComps = filter === 'atencao' ? comps.filter(compNeedsAttention) : comps;

    const filterChips = comps.length === 0 ? '' : `
      <div class="bike-comp-filters">
        <button class="bike-filter-chip ${filter === 'todos' ? 'is-active' : ''}"
                data-act="filter-comp" data-bike="${escAttr(b.id)}" data-filter="todos">
          Todos (${comps.length})
        </button>
        <button class="bike-filter-chip ${filter === 'atencao' ? 'is-active' : ''} ${atencaoCount ? 'has-attention' : ''}"
                data-act="filter-comp" data-bike="${escAttr(b.id)}" data-filter="atencao">
          <i class="fa-solid fa-triangle-exclamation"></i> Atenção (${atencaoCount})
        </button>
      </div>`;

    const compHTML = comps.length === 0
      ? '<div class="bike-comp-empty">Nenhum componente cadastrado.</div>'
      : visibleComps.length === 0
        ? '<div class="bike-comp-empty">Nenhum componente precisando de atenção. 🎉</div>'
        : visibleComps.map(c => renderComponent(c)).join('');

    const activateBtn = isActive
      ? `<button class="btn btn-ghost btn-sm" data-act="deactivate-bike" data-bike="${escAttr(b.id)}">
           <i class="fa-solid fa-power-off"></i> Inativar
         </button>`
      : `<button class="btn btn-ghost btn-sm" data-act="activate-bike" data-bike="${escAttr(b.id)}">
           <i class="fa-solid fa-power-off"></i> Ativar
         </button>`;

    return `
      <div class="bike-card ${isActive ? 'bike-card-active' : ''}">
        <div class="bike-header">
          <div class="bike-title-block">
            ${activeBadge}
            <div class="bike-name">
              <i class="fa-solid fa-bicycle"></i> ${esc(b.nome)}
            </div>
            <div class="bike-meta">${esc(tipoBlock || '—')}</div>
          </div>
          <div class="bike-actions">
            ${activateBtn}
            <button class="bike-icon-btn" data-act="edit-bike" data-bike="${escAttr(b.id)}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="bike-icon-btn danger" data-act="del-bike" data-bike="${escAttr(b.id)}" title="Remover">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>

        <div class="bike-stats-block bike-stats-clickable" data-act="stats" data-bike="${escAttr(b.id)}" title="Ver estatísticas detalhadas">
          <div class="bike-stat">
            <i class="fa-solid fa-route bike-stat-icon"></i>
            <span class="bike-stat-value">${esc(fmtKm(kmTotal))}</span>
            <span class="bike-stat-label">acumulados</span>
          </div>
          <div class="bike-stat">
            <i class="fa-solid fa-clock bike-stat-icon"></i>
            <span class="bike-stat-value">${esc(fmtTempo(b.tempoMovS))}</span>
            <span class="bike-stat-label">em movimento</span>
          </div>
          <div class="bike-stat">
            <i class="fa-solid fa-mountain bike-stat-icon"></i>
            <span class="bike-stat-value">${esc(fmtElev(b.elevM))}</span>
            <span class="bike-stat-label">elevação</span>
          </div>
        </div>

        <div class="bike-comp-section">
          <div class="bike-comp-header">
            <div class="bike-comp-title">Componentes</div>
            <button class="btn btn-ghost btn-sm" data-act="add-comp" data-bike="${escAttr(b.id)}">
              <i class="fa-solid fa-plus"></i> Adicionar
            </button>
          </div>
          ${filterChips}
          <div class="bike-comp-list">${compHTML}</div>
        </div>

        <div class="bike-card-footer">
          <button class="btn btn-ghost btn-sm" data-act="stats" data-bike="${escAttr(b.id)}">
            <i class="fa-solid fa-chart-simple"></i> Estatísticas
          </button>
          <button class="btn btn-ghost btn-sm" data-act="log" data-bike="${escAttr(b.id)}">
            <i class="fa-solid fa-clipboard-list"></i> Histórico de manutenções
          </button>
          <button class="btn btn-ghost btn-sm" data-act="revisao" data-bike="${escAttr(b.id)}">
            <i class="fa-solid fa-screwdriver-wrench"></i> Revisão completa
          </button>
        </div>
      </div>`;
  }

  function renderComponent(c) {
    const hasKm = c.vidaUtilKm > 0;
    const kmPct = hasKm ? Math.min(150, (c.kmDesgastado / c.vidaUtilKm) * 100) : null;
    const tl = timeLifeOf(c);
    const timePct = tl ? Math.min(150, tl.pct) : null;
    // Pior das dimensões configuradas (km/tempo) define o status geral. Sem
    // NENHUMA configurada, `pct` fica null de propósito: colapsar para 0 aqui
    // faria a severityFor devolver 'green' e o componente aparecer como "0% da
    // vida", ou seja, verde/ok para algo sobre o qual não se sabe nada — que é
    // justamente o BUG-064. A guarda da severityFor não bastava, porque este
    // call site resolvia o null ANTES de chamá-la.
    const semVidaUtil = kmPct == null && timePct == null;
    const pct = semVidaUtil
      ? null
      : Math.max(kmPct != null ? kmPct : 0, timePct != null ? timePct : 0);
    const sev = severityFor(pct);
    const status = semVidaUtil
      ? 'vida útil não definida'
      : pct >= 100
        ? '⚠ VENCIDO'
        : pct >= 80
          ? `⚠ ${Math.round(pct)}% — atenção`
          : `${Math.round(pct)}% da vida`;

    const cleanBlock = c.temLimpeza
      ? renderCleanBlock(c)
      : '';

    const kmBlock = hasKm ? `
            <div class="bike-comp-stats">${esc(fmtKm(c.kmDesgastado))} / ${esc(fmtKm(c.vidaUtilKm))}</div>
            <div class="bike-comp-progress">
              <div class="bike-comp-progress-fill ${severityFor(kmPct)}" style="width:${Math.min(100, kmPct)}%"></div>
            </div>` : '';
    const timeBlock = tl ? `
            <div class="bike-comp-stats">${tl.decorridoU} / ${tl.limiteU} ${esc(tl.limiteU === 1 ? tl.unidade.singular : tl.unidade.label)}</div>
            <div class="bike-comp-progress">
              <div class="bike-comp-progress-fill ${severityFor(timePct)}" style="width:${Math.min(100, timePct)}%"></div>
            </div>` : '';

    return `
      <div class="bike-comp-item ${sev === 'red' ? 'danger' : sev === 'amber' ? 'warn' : sev === 'neutral' ? 'unknown' : ''}">
        <div class="bike-comp-row">
          <div class="bike-comp-info">
            <div class="bike-comp-name bike-comp-name-link" data-act="comp-detail" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}" title="Ver detalhes e histórico">
              <i class="fa-solid fa-circle bike-comp-icon ${sev}"></i>
              ${esc(typeLabel(c.tipo))}
              <i class="fa-solid fa-chevron-right bike-comp-name-caret"></i>
            </div>
            <div class="bike-comp-status ${sev}">${esc(status)}</div>
            ${kmBlock}
            ${timeBlock}
            ${c.pressao ? `<div class="bike-comp-pressao"><i class="fa-solid fa-gauge-high"></i> ${esc(c.pressao)}</div>` : ''}
            ${cleanBlock}
            ${renderIntervalsBlock(c)}
          </div>
          <div class="bike-comp-actions">
            ${c.temLimpeza ? `
              <button class="btn btn-ghost btn-sm" data-act="limpar" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}">
                <i class="fa-solid fa-spray-can-sparkles"></i> Limpar
              </button>` : ''}
            <button class="btn btn-ghost btn-sm" data-act="substituir" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}">
              <i class="fa-solid fa-rotate"></i> Substituir
            </button>
            <button class="bike-icon-btn" data-act="edit-comp" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="bike-icon-btn danger" data-act="del-comp" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}" title="Remover">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  function fmtIntervalRestante(iv) {
    if (iv.restante <= 0) return '⚠ Serviço devido';
    if (iv.base === 'km') {
      return `faltam ${iv.restante.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km`;
    }
    const d = Math.round(iv.restante);
    return `faltam ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }

  function renderIntervalRow(iv) {
    const sev = severityFor(iv.pct);
    const baseLabel = iv.base === 'km'
      ? `a cada ${iv.intervalo.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km`
      : `a cada ${Math.round(iv.intervalo)} ${Math.round(iv.intervalo) === 1 ? 'dia' : 'dias'}`;
    return `
      <div class="bike-interval ${sev}">
        <div class="bike-interval-main">
          <div class="bike-interval-top">
            <span class="bike-interval-name">${esc(iv.nome)}</span>
            <span class="bike-interval-restante ${sev}">${esc(fmtIntervalRestante(iv))}</span>
          </div>
          <div class="bike-interval-bar">
            <div class="bike-interval-fill ${sev}" style="width:${Math.min(100, iv.pct)}%"></div>
          </div>
          <div class="bike-interval-sub">${esc(baseLabel)}</div>
        </div>
        <div class="bike-interval-actions">
          <button class="bike-icon-btn" data-act="reg-interval" data-bike="${escAttr(iv._bikeId)}" data-comp="${escAttr(iv.componentId)}" data-int="${escAttr(iv.id)}" title="Registrar serviço">
            <i class="fa-solid fa-check"></i>
          </button>
          <button class="bike-icon-btn" data-act="edit-interval" data-bike="${escAttr(iv._bikeId)}" data-comp="${escAttr(iv.componentId)}" data-int="${escAttr(iv.id)}" title="Editar">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="bike-icon-btn danger" data-act="del-interval" data-bike="${escAttr(iv._bikeId)}" data-comp="${escAttr(iv.componentId)}" data-int="${escAttr(iv.id)}" title="Remover">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`;
  }

  function renderIntervalsBlock(c) {
    const ivs = (c.intervals || []).map(iv => ({ ...iv, _bikeId: c.bikeId }));
    const rows = ivs.map(renderIntervalRow).join('');
    return `
      <div class="bike-intervals">
        ${rows}
        <button class="bike-interval-add" data-act="add-interval" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}">
          <i class="fa-solid fa-plus"></i> Adicionar serviço
        </button>
      </div>`;
  }

  function renderCleanBlock(c) {
    const km = c.kmDesdeUltimaLimpeza ?? 0;
    const limite = c.intervaloLimpezaKm || 0;
    const pct = limite > 0 ? (km / limite) * 100 : 0;
    const warn = pct >= 80;
    const status = pct >= 100
      ? ' · ⚠ Limpar agora'
      : pct >= 80
        ? ' · ⚠ Limpar em breve'
        : '';
    return `
      <div class="bike-comp-clean ${warn ? 'warn' : ''}">
        Limpeza: ${esc(fmtKm(km))} / ${esc(fmtKm(limite))}${esc(status)}
      </div>`;
  }

  /* ──────────────────────────────────────────────────────────────────
     Wire de cliques nos cards (delegação)
  ─────────────────────────────────────────────────────────────────── */
  function wireBikeCardHandlers() {
    const list = document.getElementById('bikes-list');
    if (!list || list._wiredBikes) return;
    list._wiredBikes = true;

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act    = btn.dataset.act;
      const bikeId = btn.dataset.bike;
      const compId = btn.dataset.comp;
      const intId  = btn.dataset.int;
      const bike   = _bikes.find(b => b.id === bikeId);
      if (!bike) return;

      switch (act) {
        case 'edit-bike':       return openBikeModal(bike);
        case 'del-bike':        return confirmDeleteBike(bike);
        case 'activate-bike':   return openActivateModal(bike);
        case 'deactivate-bike': return openDeactivateModal(bike);
        case 'add-comp':      return openComponentModal(bike, null);
        case 'edit-comp':     return openComponentModal(bike, (_componentsByBike.get(bikeId) || []).find(c => c.id === compId) || null);
        case 'del-comp':      return confirmDeleteComponent(bike, compId);
        case 'limpar':        return openLimparModal(bike, compId);
        case 'substituir':    return openSubstituirModal(bike, compId);
        case 'revisao':       return openRevisaoModal(bike);
        case 'log':           return openLogModal(bike);
        case 'stats':         return openStatsModal(bike);
        case 'comp-detail':   return openComponentDetail(bike, compId);
        case 'add-interval':  return openIntervalModal(bike, compId, null);
        case 'edit-interval': return openIntervalModal(bike, compId, findInterval(bike, compId, intId));
        case 'del-interval':  return confirmDeleteInterval(bike, compId, intId);
        case 'reg-interval':  return registerInterval(bike, compId, intId);
        case 'filter-comp':
          _filterByBike.set(bikeId, btn.dataset.filter || 'todos');
          return render();
      }
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Criar/Editar bicicleta
  ─────────────────────────────────────────────────────────────────── */
  function openBikeModal(bike) {
    const isEdit = !!bike;
    const b = bike || {
      nome: '', marca: '', modelo: '', tipo: 'Speed',
      pesoKg: '', ano: '', kmInicial: 0, activeSince: todayISO(),
    };

    const tipoRadios = TIPOS_BIKE.map(t => `
      <input type="radio" name="b-tipo" id="b-tipo-${t}" value="${t}" ${b.tipo === t ? 'checked' : ''}>
      <label for="b-tipo-${t}">${t}</label>
    `).join('');

    Modals.open({
      tag: isEdit ? 'Editar bicicleta' : 'Nova bicicleta',
      title: isEdit ? b.nome : 'Adicionar bicicleta',
      bodyHTML: `
        <div class="field">
          <label class="field-label" for="b-nome">Nome *</label>
          <input id="b-nome" class="field-input" type="text" value="${escAttr(b.nome)}"
                 placeholder="Ex.: Canyon Grail CF SLX" />
        </div>

        <div class="bike-form-row">
          <div class="field">
            <label class="field-label" for="b-marca">Marca</label>
            <input id="b-marca" class="field-input" type="text" value="${escAttr(b.marca)}"
                   placeholder="Ex.: Canyon" />
          </div>
          <div class="field">
            <label class="field-label" for="b-modelo">Modelo</label>
            <input id="b-modelo" class="field-input" type="text" value="${escAttr(b.modelo)}"
                   placeholder="Ex.: Grail CF SLX" />
          </div>
        </div>

        <div class="field">
          <label class="field-label">Tipo</label>
          <div class="bike-tipo-radio">${tipoRadios}</div>
        </div>

        <div class="bike-form-row">
          <div class="field">
            <label class="field-label" for="b-peso">Peso (kg)</label>
            <input id="b-peso" class="field-input" type="number" min="0" step="0.1"
                   value="${escAttr(b.pesoKg)}" placeholder="8,2" />
          </div>
          <div class="field">
            <label class="field-label" for="b-ano">Ano de aquisição</label>
            <input id="b-ano" class="field-input" type="number" min="1950" max="2099"
                   value="${escAttr(b.ano)}" placeholder="2022" />
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="b-km-inicial">${isEdit && !b.activeSince
            ? 'Quilometragem rodada (preservada)'
            : 'Km iniciais (km já rodados antes do app)'}</label>
          <input id="b-km-inicial" class="field-input" type="number" min="0" step="1"
                 value="${escAttr(b.kmInicial)}" placeholder="0" />
          ${isEdit && !b.activeSince ? `<small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            Quilometragem congelada na inativação. Edite aqui para corrigir.
          </small>` : ''}
        </div>

        ${(!isEdit || b.activeSince) ? `
        <div class="field">
          <label class="field-label" for="b-active-since">Ativar a partir de</label>
          <input id="b-active-since" class="field-input" type="date"
                 value="${escAttr(b.activeSince || todayISO())}" />
          <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            Km de atividades nesta data em diante serão contabilizados para esta bike.
          </small>
        </div>` : ''}
      `,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: isEdit ? 'Salvar' : 'Adicionar', kind: 'primary',
          onClick: (m) => saveBike(m, bike?.id) },
      ],
      onMount: (m) => m.querySelector('#b-nome').focus(),
    });
  }

  async function saveBike(modal, existingId) {
    const nome = modal.querySelector('#b-nome').value.trim();
    if (!nome) { toast('Informe o nome da bike', { kind: 'error' }); return; }

    const data = {
      nome,
      marca:       modal.querySelector('#b-marca').value.trim(),
      modelo:      modal.querySelector('#b-modelo').value.trim(),
      tipo:        modal.querySelector('input[name="b-tipo"]:checked')?.value || '',
      pesoKg:      parseFloat(modal.querySelector('#b-peso').value) || null,
      ano:         parseInt(modal.querySelector('#b-ano').value, 10) || null,
      kmInicial:   parseFloat(modal.querySelector('#b-km-inicial').value) || 0,
    };
    // Só envia activeSince quando o campo existe (criação ou edição de bike
    // ativa). Para bike inativa o campo é omitido → active_since preservado
    // como NULL (a reativação define a nova data via modal próprio).
    const asEl = modal.querySelector('#b-active-since');
    if (asEl) data.activeSince = asEl.value || null;

    try {
      if (existingId) {
        await window.Api.put(`/bikes/${existingId}`, data);
        toast('Bike atualizada');
      } else {
        data.id = genId('bike');
        await window.Api.post('/bikes', data);
        toast('Bike adicionada');
      }
      Modals.close();
      await load();
    } catch (e) {
      console.error('[Bikes] save', e);
      toast('Erro ao salvar', { kind: 'error' });
    }
  }

  function confirmDeleteBike(bike) {
    Modals.open({
      tag: 'Remover bicicleta',
      title: `Remover ${bike.nome}?`,
      bodyHTML: `
        <p style="font-size:14px;color:var(--muted);">
          Esta ação remove a bicicleta, todos os componentes cadastrados e o histórico de manutenções.
          Atividades Garmin/Strava não são afetadas.
        </p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Remover', kind: 'danger', onClick: async () => {
          try {
            await window.Api.del(`/bikes/${bike.id}`);
            toast('Bike removida');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao remover', { kind: 'error' }); }
        }},
      ],
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Ativar bike
  ─────────────────────────────────────────────────────────────────── */
  function openActivateModal(bike) {
    Modals.open({
      tag: 'Ativar bicicleta',
      title: `Ativar ${bike.nome}`,
      bodyHTML: `
        <p style="font-size:14px;color:var(--muted);margin-bottom:12px;">
          A partir desta data, km de atividades Garmin/Strava serão somados a esta bike.
          A quilometragem já registrada é preservada.
        </p>
        <div class="field">
          <label class="field-label" for="b-act-since">Ativar a partir de</label>
          <input id="b-act-since" class="field-input" type="date"
                 value="${escAttr(bike.activeSince || todayISO())}" />
        </div>
      `,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Ativar', kind: 'primary', onClick: async (m) => {
          const activeSince = m.querySelector('#b-act-since').value;
          try {
            await window.Api.post(`/bikes/${bike.id}/activate`, { activeSince });
            toast('Bike ativada');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao ativar', { kind: 'error' }); }
        }},
      ],
    });
  }

  function openDeactivateModal(bike) {
    Modals.open({
      tag: 'Inativar bicicleta',
      title: `Inativar ${bike.nome}`,
      bodyHTML: `
        <p style="font-size:14px;color:var(--muted);margin-bottom:12px;">
          A quilometragem rodada (<strong>${esc(fmtKm(bike.kmTotal))}</strong>) será preservada e
          congelada. Atividades após esta data não serão mais somadas a esta bike.
          Você pode ajustar a quilometragem depois na edição da bike.
        </p>
        <div class="field">
          <label class="field-label" for="b-deact-date">Inativar a partir de</label>
          <input id="b-deact-date" class="field-input" type="date"
                 value="${escAttr(todayISO())}" />
        </div>
      `,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Inativar', kind: 'danger', onClick: async (m) => {
          const deactivatedAt = m.querySelector('#b-deact-date').value || todayISO();
          try {
            await window.Api.post(`/bikes/${bike.id}/deactivate`, { deactivatedAt });
            toast('Bike inativada');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao inativar', { kind: 'error' }); }
        }},
      ],
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Adicionar/Editar componente
  ─────────────────────────────────────────────────────────────────── */
  function openComponentModal(bike, comp) {
    const isEdit = !!comp;
    const c = comp || { tipo: 'pneu_dianteiro', vidaUtilKm: 3000, kmAtInstall: 0, temLimpeza: false, intervaloLimpezaKm: 300, dataInstall: todayISO() };

    // "Outro" builtin removido da lista (substituído por "＋ Outro (novo)…").
    const builtinOptions = COMPONENT_TYPES.filter(ct => ct.key !== 'outro').map(ct => `
      <option value="${escAttr(ct.key)}" data-vida="${ct.vidaUtil}" data-limpeza="${ct.temLimpeza ? 1 : 0}"
              data-intervalo="${ct.intervaloLimpezaKm || 300}" ${c.tipo === ct.key ? 'selected' : ''}>
        ${esc(ct.label)}
      </option>`).join('');
    const customOptions = _customTypes.map(t => `
      <option value="custom:${escAttr(t.id)}" data-vida="${t.vidaUtilKm || 2000}" data-limpeza="0"
              data-intervalo="300" data-custom="1" ${c.tipo === 'custom:' + t.id ? 'selected' : ''}>
        ${esc(t.nome)}
      </option>`).join('');
    // Blindagem: ao editar um componente cujo tipo não está mais na lista
    // (ex.: 'outro' legado, ou um tipo custom deletado), preserva o valor atual
    // numa opção própria — senão o select cairia no 1º item e trocaria o tipo
    // silenciosamente ao salvar.
    const knownBuiltin = COMPONENT_TYPES.some(ct => ct.key !== 'outro' && ct.key === c.tipo);
    const cid = customTypeId(c.tipo);
    const knownCustom = cid && _customTypes.some(t => t.id === cid);
    const legacyOption = (isEdit && c.tipo && !knownBuiltin && !knownCustom)
      ? `<option value="${escAttr(c.tipo)}" selected>${esc(typeLabel(c.tipo))} (atual)</option>`
      : '';
    const tipoOptions = legacyOption + builtinOptions
      + (customOptions ? `<optgroup label="Meus componentes">${customOptions}</optgroup>` : '')
      + `<option value="__new__">＋ Outro (novo)…</option>`;

    Modals.open({
      tag: isEdit ? 'Editar componente' : 'Adicionar componente',
      title: isEdit ? typeLabel(c.tipo) : `Componente — ${bike.nome}`,
      bodyHTML: `
        <div class="field">
          <label class="field-label" for="c-tipo">Tipo de componente</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="c-tipo" class="field-select" style="flex:1;">${tipoOptions}</select>
            <button type="button" id="c-edit-type" class="btn btn-ghost btn-sm"
                    title="Corrigir nome deste componente" style="display:none;">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
          <div class="field" id="c-newname-row" style="display:none;margin-top:10px;">
            <label class="field-label" for="c-newname">Nome do novo componente</label>
            <input id="c-newname" class="field-input" type="text" maxlength="60"
                   placeholder="Ex.: Guidão, Selim, Rolamento…" />
            <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
              Fica salvo para reutilizar nas próximas vezes.
            </small>
          </div>
        </div>

        <div class="bike-form-row">
          <div class="field">
            <label class="field-label" for="c-marca">Marca</label>
            <input id="c-marca" class="field-input" type="text" list="dl-marcas" maxlength="40"
                   value="${escAttr(c.marca || '')}" placeholder="Ex.: Continental" />
          </div>
          <div class="field">
            <label class="field-label" for="c-modelo">Modelo</label>
            <input id="c-modelo" class="field-input" type="text" list="dl-modelos" maxlength="60"
                   value="${escAttr(c.modelo || '')}" placeholder="Ex.: GP5000" />
          </div>
        </div>
        ${datalistHTML('dl-marcas', _brands.marcas)}
        ${datalistHTML('dl-modelos', _brands.modelos)}

        <div class="field">
          <label class="field-label" for="c-vida">Vida útil por km (opcional)</label>
          <input id="c-vida" class="field-input" type="number" min="0" step="100"
                 value="${escAttr(c.vidaUtilKm || '')}" placeholder="Ex.: 3000" />
          <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            Sugestão: Pneu ≈ 3.000 · Corrente ≈ 3.000 · Pastilha ≈ 2.000 · Disco ≈ 5.000 · Cassete ≈ 8.000
          </small>
        </div>

        <div class="bike-form-row">
          <div class="field">
            <label class="field-label" for="c-vida-tempo">Vida útil por tempo (opcional)</label>
            <input id="c-vida-tempo" class="field-input" type="number" min="1" step="1"
                   value="${escAttr(c.vidaTempoValor || '')}" placeholder="Ex.: 2" />
          </div>
          <div class="field">
            <label class="field-label" for="c-vida-unidade">Unidade</label>
            <select id="c-vida-unidade" class="field-select">
              <option value="" ${!c.vidaTempoUnidade ? 'selected' : ''}>—</option>
              <option value="dia" ${c.vidaTempoUnidade === 'dia' ? 'selected' : ''}>Dias</option>
              <option value="mes" ${c.vidaTempoUnidade === 'mes' ? 'selected' : ''}>Meses</option>
              <option value="ano" ${c.vidaTempoUnidade === 'ano' ? 'selected' : ''}>Anos</option>
            </select>
          </div>
        </div>
        <small style="display:block;font-size:11px;color:var(--muted2);margin-top:-6px;margin-bottom:4px;">
          Informe km, tempo ou ambos. Com ambos, o que vencer primeiro sinaliza a troca.
        </small>

        <div class="bike-form-row">
          <div class="field">
            <label class="field-label" for="c-km-install">Km da bike ao instalar</label>
            <input id="c-km-install" class="field-input" type="number" min="0" step="1"
                   value="${escAttr(c.kmAtInstall)}" />
          </div>
          <div class="field">
            <label class="field-label" for="c-data-inicio">Data de início</label>
            <input id="c-data-inicio" class="field-input" type="date"
                   value="${escAttr(c.dataInstall || '')}" />
          </div>
        </div>
        <small style="display:block;font-size:11px;color:var(--muted2);margin-top:-6px;margin-bottom:4px;">
          Km ao instalar: base do desgaste por km (0 = novo hoje). Data de início: base da contagem por tempo.
        </small>

        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="c-tem-limpeza" ${c.temLimpeza ? 'checked' : ''}>
            <span>Tem ciclo de limpeza (ex: corrente)</span>
          </label>
        </div>

        <div class="field" id="c-limpeza-row" style="${c.temLimpeza ? '' : 'display:none'}">
          <label class="field-label" for="c-intervalo">A cada quantos km registrar limpeza</label>
          <input id="c-intervalo" class="field-input" type="number" min="50" step="50"
                 value="${escAttr(c.intervaloLimpezaKm || 300)}" />
        </div>

        <div class="field" id="c-pressao-row" style="${isTireType(c.tipo) ? '' : 'display:none'}">
          <label class="field-label" for="c-pressao">Pressão recomendada (opcional)</label>
          <input id="c-pressao" class="field-input" type="text" maxlength="60"
                 value="${escAttr(c.pressao || '')}" placeholder="Ex.: Asfalto 34-36 · Trilha 32-34 psi" />
          <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            Referência rápida de calibragem do pneu.
          </small>
        </div>

        <div class="field">
          <label class="field-label" for="c-observacao">Observação (opcional)</label>
          <textarea id="c-observacao" class="field-textarea" maxlength="500"
                    placeholder="Notas sobre a peça: tubeless, composto, onde comprou…">${esc(c.observacao || '')}</textarea>
        </div>
      `,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: isEdit ? 'Salvar' : 'Adicionar', kind: 'primary',
          onClick: (m) => saveComponent(m, bike, comp?.id) },
      ],
      onMount: (m) => {
        const tipoSel    = m.querySelector('#c-tipo');
        const vidaInput  = m.querySelector('#c-vida');
        const limpChk    = m.querySelector('#c-tem-limpeza');
        const limpRow    = m.querySelector('#c-limpeza-row');
        const intervalEl = m.querySelector('#c-intervalo');
        const pressaoRow = m.querySelector('#c-pressao-row');
        const newNameRow = m.querySelector('#c-newname-row');
        const newNameEl  = m.querySelector('#c-newname');
        const editBtn    = m.querySelector('#c-edit-type');

        // Mostra o campo de nome (Outro novo) e o lápis (tipo custom existente).
        const syncTypeUI = () => {
          const opt = tipoSel.selectedOptions[0];
          const isNew    = tipoSel.value === '__new__';
          const isCustom = opt && opt.dataset.custom === '1';
          newNameRow.style.display = isNew ? '' : 'none';
          editBtn.style.display    = isCustom ? '' : 'none';
          if (isNew) setTimeout(() => newNameEl.focus(), 0);
        };

        // Ao trocar tipo: sugere vida útil e estado de limpeza; pressão só p/ pneu.
        // "Outro (novo)" não tem data-vida/intervalo — mantém os valores atuais
        // (o usuário informa a vida útil manualmente no campo abaixo).
        tipoSel.addEventListener('change', () => {
          const opt = tipoSel.selectedOptions[0];
          if (opt && opt.dataset.vida) vidaInput.value = opt.dataset.vida;
          const temLimp = opt && opt.dataset.limpeza === '1';
          limpChk.checked = temLimp;
          limpRow.style.display = temLimp ? '' : 'none';
          if (opt && opt.dataset.intervalo) intervalEl.value = opt.dataset.intervalo;
          if (pressaoRow) pressaoRow.style.display = isTireType(tipoSel.value) ? '' : 'none';
          syncTypeUI();
        });

        // Lápis: corrige o nome de um tipo custom (reflete em todos que o usam).
        editBtn.addEventListener('click', async () => {
          const id = customTypeId(tipoSel.value);
          if (!id) return;
          const atual = _customTypes.find(x => x.id === id);
          const novo = await Modals.prompt({
            title: 'Corrigir nome do componente', tag: 'Componente',
            placeholder: 'Novo nome', maxlength: 60,
            validate: (v) => v && v.trim() ? null : 'Informe um nome',
          });
          if (novo == null) return;
          const nome = novo.trim();
          try {
            await window.Api.put(`/component-types/${id}`, { nome });
            if (atual) atual.nome = nome;
            tipoSel.selectedOptions[0].textContent = nome;
            toast('Nome atualizado');
          } catch (e) { console.error('[Bikes] edit type', e); toast('Erro ao renomear', { kind: 'error' }); }
        });

        limpChk.addEventListener('change', () => {
          limpRow.style.display = limpChk.checked ? '' : 'none';
        });

        syncTypeUI();
      },
    });
  }

  async function saveComponent(modal, bike, existingId) {
    let tipo = modal.querySelector('#c-tipo').value;
    const vidaUtilKm       = parseFloat(modal.querySelector('#c-vida').value) || 0;
    const vidaTempoValor   = parseInt(modal.querySelector('#c-vida-tempo').value, 10) || 0;
    const vidaTempoUnidade = modal.querySelector('#c-vida-unidade').value || '';
    const dataInicio       = modal.querySelector('#c-data-inicio').value || '';
    const hasTempo = vidaTempoValor > 0 && ['dia', 'mes', 'ano'].includes(vidaTempoUnidade);

    // Vida útil por km OU por tempo (ou ambos) — ao menos uma é obrigatória.
    if (vidaTempoValor > 0 && !vidaTempoUnidade) {
      toast('Selecione a unidade da vida útil por tempo', { kind: 'error' }); return;
    }
    if (vidaUtilKm <= 0 && !hasTempo) {
      toast('Informe a vida útil por km ou por tempo', { kind: 'error' }); return;
    }

    // "Outro (novo)": cria o tipo custom (reutilizável) antes de salvar o componente.
    if (tipo === '__new__') {
      const nome = modal.querySelector('#c-newname').value.trim();
      if (!nome) { toast('Informe o nome do novo componente', { kind: 'error' }); return; }
      const typeId = genId('ctype');
      try {
        await window.Api.post('/component-types', { id: typeId, nome, vidaUtilKm });
        _customTypes.push({ id: typeId, nome, vidaUtilKm });
      } catch (e) { console.error('[Bikes] novo tipo', e); toast('Erro ao criar componente', { kind: 'error' }); return; }
      tipo = 'custom:' + typeId;
    }

    const data = {
      tipo,
      vidaUtilKm,
      vidaTempoValor:     hasTempo ? vidaTempoValor : null,
      vidaTempoUnidade:   hasTempo ? vidaTempoUnidade : null,
      kmAtInstall:        parseFloat(modal.querySelector('#c-km-install').value) || 0,
      temLimpeza:         modal.querySelector('#c-tem-limpeza').checked,
      intervaloLimpezaKm: parseFloat(modal.querySelector('#c-intervalo').value) || null,
      // Pressão só persiste para pneus
      pressao:            isTireType(tipo)
                            ? modal.querySelector('#c-pressao').value.trim() : '',
      marca:              modal.querySelector('#c-marca').value.trim(),
      modelo:             modal.querySelector('#c-modelo').value.trim(),
      observacao:         modal.querySelector('#c-observacao').value.trim(),
    };
    // Data de início (base da contagem por tempo); inválida → backend usa hoje/atual.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) data.dataInstall = dataInicio;

    try {
      if (existingId) {
        await window.Api.put(`/bikes/${bike.id}/components/${existingId}`, data);
        toast('Componente atualizado');
      } else {
        data.id = genId('comp');
        // kmAtLastClean inicia em kmAtInstall (sem desgaste de limpeza)
        data.kmAtLastClean = data.kmAtInstall;
        await window.Api.post(`/bikes/${bike.id}/components`, data);
        toast('Componente adicionado');
      }
      Modals.close();
      await load();
    } catch (e) {
      console.error('[Bikes] save comp', e);
      toast('Erro ao salvar componente', { kind: 'error' });
    }
  }

  function confirmDeleteComponent(bike, compId) {
    const comp = (_componentsByBike.get(bike.id) || []).find(c => c.id === compId);
    if (!comp) return;
    Modals.open({
      tag: 'Remover componente',
      title: `Remover ${typeLabel(comp.tipo)}?`,
      bodyHTML: `<p style="font-size:14px;color:var(--muted);">
                   O histórico de manutenções deste componente também será removido.
                 </p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Remover', kind: 'danger', onClick: async () => {
          try {
            await window.Api.del(`/bikes/${bike.id}/components/${compId}`);
            toast('Componente removido');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao remover', { kind: 'error' }); }
        }},
      ],
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Limpar componente
  ─────────────────────────────────────────────────────────────────── */
  function openLimparModal(bike, compId) {
    const comp = (_componentsByBike.get(bike.id) || []).find(c => c.id === compId);
    if (!comp) return;
    Modals.open({
      tag: 'Registrar limpeza',
      title: `Limpar ${typeLabel(comp.tipo)}`,
      bodyHTML: `
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
          ${esc(bike.nome)} · km atual: <strong>${esc(fmtKm(bike.kmTotal))}</strong>
        </p>
        <div class="field">
          <label class="field-label" for="lmp-data">Data da limpeza</label>
          <input id="lmp-data" class="field-input" type="date" value="${escAttr(todayISO())}" />
        </div>
        <div class="field">
          <label class="field-label" for="lmp-notas">Observações (opcional)</label>
          <textarea id="lmp-notas" class="field-textarea" placeholder="Tipo de óleo, frequência…"></textarea>
        </div>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Registrar limpeza', kind: 'primary', onClick: async (m) => {
          const data  = m.querySelector('#lmp-data').value || todayISO();
          const notas = m.querySelector('#lmp-notas').value.trim();
          try {
            await window.Api.post(`/bikes/${bike.id}/components/${compId}/limpar`, { data, notas });
            toast('Limpeza registrada');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao registrar', { kind: 'error' }); }
        }},
      ],
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Substituir componente
  ─────────────────────────────────────────────────────────────────── */
  function openSubstituirModal(bike, compId) {
    const comp = (_componentsByBike.get(bike.id) || []).find(c => c.id === compId);
    if (!comp) return;

    const tipoLabelRaw = typeLabel(comp.tipo);
    const tipoLabel = esc(tipoLabelRaw);
    const saiNome = [comp.marca, comp.modelo].filter(Boolean).join(' ').trim();
    const kmRodado = comp.kmDesgastado != null ? comp.kmDesgastado : null;

    Modals.open({
      tag: 'Substituir componente',
      title: `Substituir ${tipoLabelRaw}`,
      bodyHTML: `
        <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">
          ${esc(bike.nome)} · km atual: <strong>${esc(fmtKm(bike.kmTotal))}</strong>
        </p>

        <div class="bike-sub-block">
          <div class="bike-sub-block-h"><i class="fa-solid fa-star-half-stroke"></i> Avaliar a peça que sai</div>
          <div class="bike-sub-saindo">
            ${tipoLabel}${saiNome ? ` · <strong>${esc(saiNome)}</strong>` : ''}
            ${kmRodado != null ? ` · rodou <strong>${esc(fmtKm(kmRodado))}</strong>` : ''}
          </div>
          <div class="field">
            <label class="field-label">Nota de durabilidade/qualidade</label>
            ${starsInputHTML(0)}
          </div>
          <div class="field">
            <label class="field-label" for="sub-review">Como foi? (recompraria?)</label>
            <textarea id="sub-review" class="field-textarea" maxlength="500"
                      placeholder="Durabilidade, qualidade, custo-benefício, recompraria…"></textarea>
          </div>
        </div>

        <div class="bike-sub-block">
          <div class="bike-sub-block-h"><i class="fa-solid fa-rotate"></i> Novo componente</div>
          <div class="bike-form-row">
            <div class="field">
              <label class="field-label" for="sub-marca">Marca</label>
              <input id="sub-marca" class="field-input" type="text" list="dl-marcas" maxlength="40"
                     value="${escAttr(comp.marca || '')}" placeholder="Ex.: Continental" />
            </div>
            <div class="field">
              <label class="field-label" for="sub-modelo">Modelo</label>
              <input id="sub-modelo" class="field-input" type="text" list="dl-modelos" maxlength="60"
                     value="${escAttr(comp.modelo || '')}" placeholder="Ex.: GP5000" />
            </div>
          </div>
          ${datalistHTML('dl-marcas', _brands.marcas)}
          ${datalistHTML('dl-modelos', _brands.modelos)}
          <div class="bike-form-row">
            <div class="field">
              <label class="field-label" for="sub-vida">Nova vida útil (km)</label>
              <input id="sub-vida" class="field-input" type="number" min="100" step="100"
                     value="${escAttr(comp.vidaUtilKm)}" />
            </div>
            <div class="field">
              <label class="field-label" for="sub-data">Data da troca</label>
              <input id="sub-data" class="field-input" type="date" value="${escAttr(todayISO())}" />
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="sub-notas">Observações da peça nova (opcional)</label>
            <textarea id="sub-notas" class="field-textarea" maxlength="500"
                      placeholder="Tubeless, onde comprou, custo…"></textarea>
          </div>
        </div>

        <p style="font-size:12px;color:var(--muted2);margin-top:6px;">
          A peça que sai vai para o histórico (km rodado, dias de uso e sua nota).
          O desgaste é zerado; o km total da bike continua acumulando.
        </p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Confirmar troca', kind: 'primary', onClick: async (m) => {
          const data       = m.querySelector('#sub-data').value || todayISO();
          const notas      = m.querySelector('#sub-notas').value.trim();
          const review     = m.querySelector('#sub-review').value.trim();
          const rating     = readStars(m) || null;
          const vidaUtilKm = parseFloat(m.querySelector('#sub-vida').value) || comp.vidaUtilKm;
          const novaMarca  = m.querySelector('#sub-marca').value.trim();
          const novoModelo = m.querySelector('#sub-modelo').value.trim();
          try {
            await window.Api.post(`/bikes/${bike.id}/components/${compId}/substituir`,
              { data, notas, review, rating, vidaUtilKm, novaMarca, novoModelo });
            toast('Substituição registrada');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao registrar', { kind: 'error' }); }
        }},
      ],
      onMount: (m) => wireStars(m),
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Intervalos de serviço recorrentes
  ─────────────────────────────────────────────────────────────────── */
  function findInterval(bike, compId, intId) {
    const comp = (_componentsByBike.get(bike.id) || []).find(c => c.id === compId);
    return comp ? (comp.intervals || []).find(iv => iv.id === intId) : null;
  }

  function openIntervalModal(bike, compId, interval) {
    const comp = (_componentsByBike.get(bike.id) || []).find(c => c.id === compId);
    if (!comp) return;
    const isEdit = !!interval;
    const iv = interval || { nome: '', base: 'km', intervalo: '' };
    Modals.open({
      tag: isEdit ? 'Editar serviço' : 'Novo serviço recorrente',
      title: typeLabel(comp.tipo),
      bodyHTML: `
        <div class="field">
          <label class="field-label" for="iv-nome">Nome do serviço *</label>
          <input id="iv-nome" class="field-input" type="text" value="${escAttr(iv.nome)}"
                 placeholder="Ex.: Calibragem, Trocar pneu, Lubrificar corrente" />
        </div>
        <div class="field">
          <label class="field-label">Base do intervalo</label>
          <div class="bike-tipo-radio">
            <input type="radio" name="iv-base" id="iv-base-km" value="km" ${iv.base !== 'dias' ? 'checked' : ''}>
            <label for="iv-base-km">Por km</label>
            <input type="radio" name="iv-base" id="iv-base-dias" value="dias" ${iv.base === 'dias' ? 'checked' : ''}>
            <label for="iv-base-dias">Por dias</label>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="iv-intervalo">Intervalo *</label>
          <input id="iv-intervalo" class="field-input" type="number" min="1" step="1"
                 value="${escAttr(iv.intervalo)}" placeholder="Ex.: 3000 (km) ou 7 (dias)" />
          <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            A contagem regressiva reinicia toda vez que você registrar o serviço.
          </small>
        </div>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: isEdit ? 'Salvar' : 'Adicionar', kind: 'primary', onClick: async (m) => {
          const nome = m.querySelector('#iv-nome').value.trim();
          const base = m.querySelector('input[name="iv-base"]:checked')?.value || 'km';
          const intervalo = parseFloat(m.querySelector('#iv-intervalo').value);
          if (!nome) { toast('Informe o nome do serviço', { kind: 'error' }); return; }
          if (!isFinite(intervalo) || intervalo <= 0) { toast('Informe um intervalo válido', { kind: 'error' }); return; }
          try {
            if (isEdit) {
              await window.Api.put(`/bikes/${bike.id}/components/${compId}/intervals/${interval.id}`, { nome, base, intervalo });
              toast('Serviço atualizado');
            } else {
              await window.Api.post(`/bikes/${bike.id}/components/${compId}/intervals`, { nome, base, intervalo });
              toast('Serviço adicionado');
            }
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao salvar serviço', { kind: 'error' }); }
        }},
      ],
      onMount: (m) => m.querySelector('#iv-nome').focus(),
    });
  }

  function confirmDeleteInterval(bike, compId, intId) {
    const iv = findInterval(bike, compId, intId);
    Modals.open({
      tag: 'Remover serviço',
      title: iv ? iv.nome : 'Remover serviço',
      bodyHTML: `<p style="font-size:14px;color:var(--muted);">Remover este serviço recorrente? O histórico de manutenção já registrado é mantido.</p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Remover', kind: 'danger', onClick: async () => {
          try {
            await window.Api.del(`/bikes/${bike.id}/components/${compId}/intervals/${intId}`);
            toast('Serviço removido');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao remover', { kind: 'error' }); }
        }},
      ],
    });
  }

  async function registerInterval(bike, compId, intId) {
    const iv = findInterval(bike, compId, intId);
    Modals.open({
      tag: 'Registrar serviço',
      title: iv ? iv.nome : 'Registrar serviço',
      bodyHTML: `
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
          ${esc(bike.nome)} · km atual: <strong>${esc(fmtKm(bike.kmTotal))}</strong>
        </p>
        <div class="field">
          <label class="field-label" for="reg-data">Data do serviço</label>
          <input id="reg-data" class="field-input" type="date" value="${escAttr(todayISO())}" />
        </div>
        <div class="field">
          <label class="field-label" for="reg-notas">Observações (opcional)</label>
          <textarea id="reg-notas" class="field-textarea" placeholder="Detalhes do serviço…"></textarea>
        </div>
        <p style="font-size:12px;color:var(--muted2);margin-top:6px;">
          A contagem regressiva deste serviço será reiniciada a partir desta data/km.
        </p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Registrar', kind: 'primary', onClick: async (m) => {
          const data  = m.querySelector('#reg-data').value || todayISO();
          const notas = m.querySelector('#reg-notas').value.trim();
          try {
            await window.Api.post(`/bikes/${bike.id}/components/${compId}/intervals/${intId}/register`,
              { data, notas: notas || undefined });
            toast('Serviço registrado');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao registrar', { kind: 'error' }); }
        }},
      ],
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Revisão completa
  ─────────────────────────────────────────────────────────────────── */
  function openRevisaoModal(bike) {
    const comps = _componentsByBike.get(bike.id) || [];
    const limpComps = comps.filter(c => c.temLimpeza).length;
    Modals.open({
      tag: 'Revisão completa',
      title: bike.nome,
      bodyHTML: `
        <div class="field">
          <label class="field-label" for="rev-data">Data da revisão</label>
          <input id="rev-data" class="field-input" type="date" value="${escAttr(todayISO())}" />
        </div>
        <div class="field">
          <label class="field-label" for="rev-notas">Observações (opcional)</label>
          <textarea id="rev-notas" class="field-textarea" placeholder="Oficina, custo, peças trocadas…"></textarea>
        </div>
        <div style="background:var(--surface2);padding:12px;border-radius:6px;margin-top:8px;">
          <p style="font-size:13px;color:var(--text);margin-bottom:6px;font-weight:600;">O que acontece:</p>
          <p style="font-size:12px;color:var(--green);margin-bottom:4px;">
            <i class="fa-solid fa-check"></i> Contadores de LIMPEZA zerados (${limpComps} componente${limpComps !== 1 ? 's' : ''} afetado${limpComps !== 1 ? 's' : ''})
          </p>
          <p style="font-size:12px;color:var(--muted2);">
            <i class="fa-solid fa-xmark"></i> Desgaste total NÃO é resetado (vida útil continua contando)
          </p>
        </div>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Registrar revisão', kind: 'primary', onClick: async (m) => {
          const data  = m.querySelector('#rev-data').value || todayISO();
          const notas = m.querySelector('#rev-notas').value.trim();
          try {
            await window.Api.post(`/bikes/${bike.id}/revisao-completa`, { data, notas });
            toast('Revisão registrada');
            Modals.close();
            await load();
          } catch (e) { toast('Erro ao registrar', { kind: 'error' }); }
        }},
      ],
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Detalhe do componente (stats + intervalos + histórico)
  ─────────────────────────────────────────────────────────────────── */
  function renderIntervalRowReadonly(iv) {
    const sev = severityFor(iv.pct);
    const baseLabel = iv.base === 'km'
      ? `a cada ${iv.intervalo.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km`
      : `a cada ${Math.round(iv.intervalo)} ${Math.round(iv.intervalo) === 1 ? 'dia' : 'dias'}`;
    return `
      <div class="bike-interval ${sev}">
        <div class="bike-interval-main">
          <div class="bike-interval-top">
            <span class="bike-interval-name">${esc(iv.nome)}</span>
            <span class="bike-interval-restante ${sev}">${esc(fmtIntervalRestante(iv))}</span>
          </div>
          <div class="bike-interval-bar">
            <div class="bike-interval-fill ${sev}" style="width:${Math.min(100, iv.pct)}%"></div>
          </div>
          <div class="bike-interval-sub">${esc(baseLabel)}</div>
        </div>
      </div>`;
  }

  // Timeline de gerações retiradas de um componente (Fase 16.4)
  function renderRetiredItem(r) {
    const nome = [r.marca, r.modelo].filter(Boolean).join(' ').trim() || (typeLabel(r.tipo));
    const vidaPct = (r.vidaUtilKm > 0 && r.kmRodado != null)
      ? Math.round((r.kmRodado / r.vidaUtilKm) * 100) : null;
    const meta = [
      r.kmRodado != null ? `${fmtKm(r.kmRodado)} rodados` : null,
      r.diasUso != null ? `${r.diasUso} ${r.diasUso === 1 ? 'dia' : 'dias'}` : null,
      vidaPct != null ? `${vidaPct}% da vida (${fmtKm(r.vidaUtilKm)})` : null,
    ].filter(Boolean).join(' · ');
    return `
      <div class="bike-retired-item">
        <div class="bike-retired-top">
          <span class="bike-retired-nome">${esc(nome)}</span>
          ${starsStatic(r.rating)}
        </div>
        <div class="bike-retired-meta">${esc(meta || '—')}${r.dataSubstituicao ? ` · trocado em ${esc(fmtDate(r.dataSubstituicao))}` : ''}</div>
        ${r.review ? `<div class="bike-retired-review">"${esc(r.review)}"</div>` : ''}
      </div>`;
  }

  // Bloco agregado por tipo+marca: durabilidade média + nota média + nº trocas
  function renderRetiredAggregates(aggregates, opts) {
    if (!aggregates || aggregates.length === 0) return '';
    const showTipo = !opts || opts.showTipo !== false;
    const rows = aggregates.map(a => {
      const nome = [showTipo ? (typeLabel(a.tipo)) : null,
        [a.marca, a.modelos[0]].filter(Boolean).join(' ') || (a.marca ? '' : 'sem marca')]
        .filter(Boolean).join(' · ');
      const facts = [
        a.kmMedia != null ? `${fmtKm(a.kmMedia)} média` : null,
        a.ratingMedia != null ? starsStatic(a.ratingMedia, true) : null,
        `${a.trocas} ${a.trocas === 1 ? 'troca' : 'trocas'}`,
      ].filter(Boolean).join(' · ');
      return `<div class="bike-retired-agg-item">
        <span class="bike-retired-agg-nome">${esc(nome)}</span>
        <span class="bike-retired-agg-facts">${facts}</span>
      </div>`;
    }).join('');
    return `<div class="bike-retired-agg">${rows}</div>`;
  }

  async function openComponentDetail(bike, compId) {
    const comp = (_componentsByBike.get(bike.id) || []).find(c => c.id === compId);
    if (!comp) return;

    const hasKm = comp.vidaUtilKm > 0;
    const kmPct = hasKm ? (comp.kmDesgastado / comp.vidaUtilKm) * 100 : null;
    const tl = timeLifeOf(comp);
    const timePct = tl ? tl.pct : null;
    // Mesmo tratamento da lista (BUG-064): sem km nem tempo configurados, o
    // estado é desconhecido — não 0%.
    const semVidaUtil = kmPct == null && timePct == null;
    const pct = semVidaUtil
      ? null
      : Math.max(kmPct != null ? kmPct : 0, timePct != null ? timePct : 0);
    const sev = severityFor(pct);
    const statusTxt = semVidaUtil
      ? 'Vida útil não definida — sem limite de km nem de tempo'
      : pct >= 100
        ? '⚠ Vida útil vencida'
        : `${Math.round(pct)}% da vida útil consumida`;
    const kmDetailHTML = hasKm ? `
          <div class="bike-detail-row"><span>Desgaste (km)</span><strong class="${severityFor(kmPct)}">${esc(fmtKm(comp.kmDesgastado))} / ${esc(fmtKm(comp.vidaUtilKm))}</strong></div>
          <div class="bike-comp-progress" style="margin:4px 0 8px;"><div class="bike-comp-progress-fill ${severityFor(kmPct)}" style="width:${Math.min(100, kmPct)}%"></div></div>` : '';
    const timeDetailHTML = tl ? `
          <div class="bike-detail-row"><span>Desgaste (tempo)</span><strong class="${severityFor(timePct)}">${tl.decorridoU} / ${tl.limiteU} ${esc(tl.limiteU === 1 ? tl.unidade.singular : tl.unidade.label)}</strong></div>
          <div class="bike-comp-progress" style="margin:4px 0 8px;"><div class="bike-comp-progress-fill ${severityFor(timePct)}" style="width:${Math.min(100, timePct)}%"></div></div>` : '';

    const intervalsHTML = (comp.intervals || []).length
      ? `<div class="bike-detail-section"><div class="bike-detail-h">Serviços recorrentes</div>
           <div class="bike-intervals">${comp.intervals.map(renderIntervalRowReadonly).join('')}</div></div>`
      : '';

    const cleanHTML = comp.temLimpeza
      ? `<div class="bike-detail-row"><span>Limpeza</span><strong>${esc(fmtKm(comp.kmDesdeUltimaLimpeza ?? 0))} / ${esc(fmtKm(comp.intervaloLimpezaKm || 0))}</strong></div>`
      : '';

    Modals.open({
      tag: 'Componente',
      title: typeLabel(comp.tipo),
      bodyHTML: `
        <div class="bike-detail-stats">
          ${(comp.marca || comp.modelo) ? `<div class="bike-detail-row"><span>Peça atual</span><strong>${esc([comp.marca, comp.modelo].filter(Boolean).join(' '))}</strong></div>` : ''}
          ${kmDetailHTML}
          ${timeDetailHTML}
          <div class="bike-detail-status ${sev}">${esc(statusTxt)}</div>
          ${comp.dataInstall ? `<div class="bike-detail-row"><span>Início / instalação</span><strong>${esc(fmtDate(comp.dataInstall))}</strong></div>` : ''}
          ${comp.pressao ? `<div class="bike-detail-row"><span>Pressão</span><strong>${esc(comp.pressao)}</strong></div>` : ''}
          ${cleanHTML}
          ${comp.observacao ? `<div class="bike-detail-obs">${esc(comp.observacao)}</div>` : ''}
        </div>
        ${intervalsHTML}
        <div class="bike-detail-section" id="comp-detail-retired-wrap" style="display:none;">
          <div class="bike-detail-h">Gerações anteriores</div>
          <div id="comp-detail-agg"></div>
          <div id="comp-detail-retired"></div>
        </div>
        <div class="bike-detail-section">
          <div class="bike-detail-h">Histórico deste componente</div>
          <div id="comp-detail-log" class="bike-log-list"><div class="bike-log-empty">Carregando…</div></div>
        </div>`,
      actions: [{ label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() }],
    });

    // Histórico de manutenção (log) deste componente
    try {
      const items = await window.Api.get(`/bikes/${bike.id}/maintenance-log`);
      const el = document.querySelector('#comp-detail-log');
      if (el) {
        const own = (items || []).filter(l => l.componentId === compId);
        el.innerHTML = own.length
          ? own.map(renderLogItem).join('')
          : '<div class="bike-log-empty">Nenhum evento registrado para este componente.</div>';
      }
    } catch (e) {
      const el = document.querySelector('#comp-detail-log');
      if (el) el.innerHTML = '<div class="bike-log-empty">Erro ao carregar histórico.</div>';
    }

    // Gerações retiradas deste slot (Fase 16.4)
    try {
      const r = await window.Api.get(`/bikes/${bike.id}/retired-components?componentId=${encodeURIComponent(compId)}`);
      const items = (r && r.items) || [];
      const wrap = document.querySelector('#comp-detail-retired-wrap');
      if (wrap && items.length) {
        wrap.style.display = '';
        const aggEl = document.querySelector('#comp-detail-agg');
        const listEl = document.querySelector('#comp-detail-retired');
        if (aggEl) aggEl.innerHTML = renderRetiredAggregates(r.aggregates, { showTipo: false });
        if (listEl) listEl.innerHTML = items.map(renderRetiredItem).join('');
      }
    } catch (e) { /* sem histórico de retirados — silencioso */ }
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Estatísticas detalhadas da bike
  ─────────────────────────────────────────────────────────────────── */
  function fmtVel(v) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km/h';
  }

  function renderStatsContent(s) {
    const big = (icon, value, label) => `
      <div class="bike-stats-tot">
        <i class="fa-solid ${icon}"></i>
        <span class="bike-stats-tot-val">${esc(value)}</span>
        <span class="bike-stats-tot-lbl">${esc(label)}</span>
      </div>`;

    const row = (label, avg, mx) => `
      <tr>
        <td class="bst-key">${esc(label)}</td>
        <td class="bst-num">${esc(avg)}</td>
        <td class="bst-num">${esc(mx)}</td>
      </tr>`;

    const totais = `
      <div class="bike-stats-totals">
        ${big('fa-route',    fmtKm(s.kmTotal),      'distância')}
        ${big('fa-clock',    fmtTempo(s.tempoMovS), 'em movimento')}
        ${big('fa-mountain', fmtElev(s.elevM),      'elevação')}
        ${big('fa-list-check', s.atividades,        s.atividades === 1 ? 'atividade' : 'atividades')}
        ${s.calorias ? big('fa-fire', s.calorias.toLocaleString('pt-BR') + ' kcal', 'energia') : ''}
      </div>`;

    const tabela = `
      <table class="bike-stats-table">
        <thead>
          <tr><th>Por atividade</th><th>Média</th><th>Máximo</th></tr>
        </thead>
        <tbody>
          ${row('Distância',  s.avg.km != null ? fmtKm(s.avg.km) : '—',       s.max.km != null ? fmtKm(s.max.km) : '—')}
          ${row('Tempo em mov.', s.avg.tempoS != null ? fmtTempo(s.avg.tempoS) : '—', '—')}
          ${row('Ganho de elev.', s.avg.elevM != null ? fmtElev(s.avg.elevM) : '—', s.max.elevM != null ? fmtElev(s.max.elevM) : '—')}
          ${row('Velocidade',  fmtVel(s.avg.velKmh), fmtVel(s.max.velKmh))}
          ${(s.avg.fc != null || s.max.fc != null) ? row('FC', s.avg.fc != null ? s.avg.fc + ' bpm' : '—', s.max.fc != null ? s.max.fc + ' bpm' : '—') : ''}
          ${(s.avg.watts != null || s.max.watts != null) ? row('Potência', s.avg.watts != null ? s.avg.watts + ' W' : '—', s.max.watts != null ? s.max.watts + ' W' : '—') : ''}
        </tbody>
      </table>`;

    return totais + tabela;
  }

  async function openStatsModal(bike) {
    Modals.open({
      tag: 'Estatísticas',
      title: bike.nome,
      bodyHTML: `<div id="bike-stats-content"><div class="bike-log-empty">Carregando…</div></div>
        <div id="bike-stats-retired"></div>`,
      actions: [{ label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() }],
    });
    try {
      const s = await window.Api.get(`/bikes/${bike.id}/stats`);
      const el = document.querySelector('#bike-stats-content');
      if (el) {
        el.innerHTML = (!s || !s.atividades)
          ? '<div class="bike-log-empty">Sem atividades registradas para esta bike ainda.</div>'
          : renderStatsContent(s);
      }
    } catch (e) {
      const el = document.querySelector('#bike-stats-content');
      if (el) el.innerHTML = '<div class="bike-log-empty">Erro ao carregar estatísticas.</div>';
    }

    // Durabilidade de componentes substituídos (Fase 16.4)
    try {
      const r = await window.Api.get(`/bikes/${bike.id}/retired-components`);
      const el = document.querySelector('#bike-stats-retired');
      if (el && r && r.aggregates && r.aggregates.length) {
        el.innerHTML = `<div class="bike-detail-section">
          <div class="bike-detail-h">Durabilidade de componentes</div>
          ${renderRetiredAggregates(r.aggregates, { showTipo: true })}
        </div>`;
      }
    } catch (e) { /* silencioso */ }
  }

  /* ──────────────────────────────────────────────────────────────────
     Modal — Histórico de manutenções
  ─────────────────────────────────────────────────────────────────── */
  async function openLogModal(bike) {
    Modals.open({
      tag: 'Manutenções',
      title: bike.nome,
      bodyHTML: '<div id="log-content" class="bike-log-list"><div class="bike-log-empty">Carregando…</div></div>',
      actions: [
        { label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() },
      ],
    });

    try {
      const items = await window.Api.get(`/bikes/${bike.id}/maintenance-log`);
      const el = document.querySelector('#log-content');
      if (!el) return;
      if (!items || items.length === 0) {
        el.innerHTML = '<div class="bike-log-empty">Nenhum evento registrado ainda.</div>';
        return;
      }
      el.innerHTML = items.map(renderLogItem).join('');
    } catch (e) {
      const el = document.querySelector('#log-content');
      if (el) el.innerHTML = '<div class="bike-log-empty">Erro ao carregar histórico.</div>';
    }
  }

  function renderLogItem(l) {
    const icon = {
      substituicao:     { cls: 'fa-rotate evento-subst',          label: 'Substituição' },
      limpeza:          { cls: 'fa-spray-can-sparkles evento-limpeza', label: 'Limpeza' },
      revisao_completa: { cls: 'fa-screwdriver-wrench evento-revisao', label: 'Revisão completa' },
    }[l.tipoEvento] || { cls: 'fa-circle', label: l.tipoEvento };

    const compLabel = l.componentTipo
      ? ` — ${esc(typeLabel(l.componentTipo))}`
      : '';

    return `
      <div class="bike-log-item">
        <div class="bike-log-date">${esc(fmtDate(l.data))}</div>
        <div class="bike-log-content">
          <div class="bike-log-title">
            <i class="fa-solid ${icon.cls}"></i> ${esc(icon.label)}${compLabel}
          </div>
          <div class="bike-log-km">${esc(fmtKm(l.kmBike))} na bike</div>
          ${l.notas ? `<div class="bike-log-notas">"${esc(l.notas)}"</div>` : ''}
        </div>
      </div>`;
  }

  /* ──────────────────────────────────────────────────────────────────
     Init — listeners dos botões "Nova bicicleta"
  ─────────────────────────────────────────────────────────────────── */
  function init() {
    document.getElementById('btn-add-bike')?.addEventListener('click', () => openBikeModal(null));
    document.getElementById('btn-add-bike-empty')?.addEventListener('click', () => openBikeModal(null));
  }

  // Expor
  window.Bikes = {
    init,
    load,
    render,
    // A UI mobile monta o botão "Nova bike" no header, que é recriado a cada
    // entrada na aba — não dá para depender do bind único de init().
    openBikeModal,
  };
})();
