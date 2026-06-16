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

  const esc     = window.esc     || (s => String(s == null ? '' : s));
  const escAttr = window.escAttr || (s => String(s == null ? '' : s).replace(/"/g, '&quot;'));

  let _bikes = [];
  let _componentsByBike = new Map();   // bikeId → array<component>

  /* ──────────────────────────────────────────────────────────────────
     Helpers
  ─────────────────────────────────────────────────────────────────── */
  function genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtKm(v) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km';
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
    if (pct >= 100) return 'red';
    if (pct >= 80)  return 'amber';
    return 'green';
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
    _componentsByBike.clear();
    // Carrega componentes em paralelo para cada bike
    await Promise.all(_bikes.map(async b => {
      try {
        const comps = await window.Api.get(`/bikes/${b.id}/components`);
        _componentsByBike.set(b.id, comps || []);
      } catch (e) {
        console.warn('[Bikes] componentes falharam', b.id, e);
        _componentsByBike.set(b.id, []);
      }
    }));
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
           <i class="fa-solid fa-circle" style="color:${isActive ? 'var(--green)' : 'var(--red)'}"></i>
           ${isActive ? 'ATIVA' : 'INATIVA'}
           ${b.activeSince ? `<span class="bike-active-since" style="color:#000">desde ${esc(fmtDate(b.activeSince))}</span>` : ''}
         </div>`;

    const tipoBlock = [b.tipo, b.pesoKg ? `${b.pesoKg} kg` : null, b.ano ? `${b.ano} (${yearsAgo(b.ano)})` : null]
      .filter(Boolean).join(' · ');

    const compHTML = comps.length === 0
      ? '<div class="bike-comp-empty">Nenhum componente cadastrado.</div>'
      : comps.map(c => renderComponent(c)).join('');

    const activateBtn = isActive
      ? ''
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

        <div class="bike-km-block">
          <div class="bike-km-label">
            <span>Km acumulados</span>
            <span class="bike-km-value">${esc(fmtKm(kmTotal))}</span>
          </div>
          <div class="bike-km-bar">
            <div class="bike-km-fill" style="width:100%"></div>
          </div>
        </div>

        <div class="bike-comp-section">
          <div class="bike-comp-header">
            <div class="bike-comp-title">Componentes</div>
            <button class="btn btn-ghost btn-sm" data-act="add-comp" data-bike="${escAttr(b.id)}">
              <i class="fa-solid fa-plus"></i> Adicionar
            </button>
          </div>
          <div class="bike-comp-list">${compHTML}</div>
        </div>

        <div class="bike-card-footer">
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
    const pct = c.vidaUtilKm > 0 ? Math.min(150, (c.kmDesgastado / c.vidaUtilKm) * 100) : 0;
    const sev = severityFor(pct);
    const status = pct >= 100
      ? '⚠ VENCIDO'
      : pct >= 80
        ? `${Math.round(pct)}% da vida`
        : `${Math.round(pct)}% da vida`;

    const cleanBlock = c.temLimpeza
      ? renderCleanBlock(c)
      : '';

    return `
      <div class="bike-comp-item ${sev === 'red' ? 'danger' : sev === 'amber' ? 'warn' : ''}">
        <div class="bike-comp-row">
          <div class="bike-comp-info">
            <div class="bike-comp-name">
              <i class="fa-solid fa-circle bike-comp-icon ${sev}"></i>
              ${esc(TYPE_LABEL[c.tipo] || c.tipo)}
            </div>
            <div class="bike-comp-stats">
              ${esc(fmtKm(c.kmDesgastado))} / ${esc(fmtKm(c.vidaUtilKm))}
            </div>
            <div class="bike-comp-status ${sev}">${esc(status)}</div>
            <div class="bike-comp-progress">
              <div class="bike-comp-progress-fill ${sev}" style="width:${Math.min(100, pct)}%"></div>
            </div>
            ${cleanBlock}
          </div>
          <div class="bike-comp-actions">
            ${c.temLimpeza ? `
              <button class="btn btn-ghost btn-sm" data-act="limpar" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}">
                <i class="fa-solid fa-spray-can-sparkles"></i> Limpar
              </button>` : ''}
            <button class="btn btn-ghost btn-sm" data-act="substituir" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}">
              <i class="fa-solid fa-rotate"></i> Substituir
            </button>
            <button class="bike-icon-btn danger" data-act="del-comp" data-bike="${escAttr(c.bikeId)}" data-comp="${escAttr(c.id)}" title="Remover">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
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
      const bike   = _bikes.find(b => b.id === bikeId);
      if (!bike) return;

      switch (act) {
        case 'edit-bike':     return openBikeModal(bike);
        case 'del-bike':      return confirmDeleteBike(bike);
        case 'activate-bike': return openActivateModal(bike);
        case 'add-comp':      return openComponentModal(bike, null);
        case 'del-comp':      return confirmDeleteComponent(bike, compId);
        case 'limpar':        return openLimparModal(bike, compId);
        case 'substituir':    return openSubstituirModal(bike, compId);
        case 'revisao':       return openRevisaoModal(bike);
        case 'log':           return openLogModal(bike);
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
      title: isEdit ? esc(b.nome) : 'Adicionar bicicleta',
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
          <label class="field-label" for="b-km-inicial">Km iniciais (km já rodados antes do app)</label>
          <input id="b-km-inicial" class="field-input" type="number" min="0" step="1"
                 value="${escAttr(b.kmInicial)}" placeholder="0" />
        </div>

        <div class="field">
          <label class="field-label" for="b-active-since">Ativar a partir de</label>
          <input id="b-active-since" class="field-input" type="date"
                 value="${escAttr(b.activeSince || todayISO())}" />
          <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            Km de atividades nesta data em diante serão contabilizados para esta bike.
          </small>
        </div>
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
      activeSince: modal.querySelector('#b-active-since').value || null,
    };

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
      title: `Remover ${esc(bike.nome)}?`,
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
      title: `Ativar ${esc(bike.nome)}`,
      bodyHTML: `
        <p style="font-size:14px;color:var(--muted);margin-bottom:12px;">
          A partir desta data, km de atividades Garmin/Strava serão somados a esta bike.
          Qualquer outra bike ativa será desativada.
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

  /* ──────────────────────────────────────────────────────────────────
     Modal — Adicionar/Editar componente
  ─────────────────────────────────────────────────────────────────── */
  function openComponentModal(bike, comp) {
    const isEdit = !!comp;
    const c = comp || { tipo: 'pneu_dianteiro', vidaUtilKm: 3000, kmAtInstall: 0, temLimpeza: false, intervaloLimpezaKm: 300 };

    const tipoOptions = COMPONENT_TYPES.map(ct => `
      <option value="${ct.key}" data-vida="${ct.vidaUtil}" data-limpeza="${ct.temLimpeza ? 1 : 0}"
              data-intervalo="${ct.intervaloLimpezaKm || 300}" ${c.tipo === ct.key ? 'selected' : ''}>
        ${ct.label}
      </option>
    `).join('');

    Modals.open({
      tag: isEdit ? 'Editar componente' : 'Adicionar componente',
      title: isEdit ? esc(TYPE_LABEL[c.tipo] || c.tipo) : `Componente — ${esc(bike.nome)}`,
      bodyHTML: `
        <div class="field">
          <label class="field-label" for="c-tipo">Tipo de componente</label>
          <select id="c-tipo" class="field-select">${tipoOptions}</select>
        </div>

        <div class="field">
          <label class="field-label" for="c-vida">Vida útil estimada (km)</label>
          <input id="c-vida" class="field-input" type="number" min="100" step="100"
                 value="${escAttr(c.vidaUtilKm)}" />
          <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            Sugestão: Pneu ≈ 3.000 · Corrente ≈ 3.000 · Pastilha ≈ 2.000 · Disco ≈ 5.000 · Cassete ≈ 8.000
          </small>
        </div>

        <div class="field">
          <label class="field-label" for="c-km-install">Km da bike ao instalar</label>
          <input id="c-km-install" class="field-input" type="number" min="0" step="1"
                 value="${escAttr(c.kmAtInstall)}" />
          <small style="display:block;font-size:11px;color:var(--muted2);margin-top:4px;">
            Use 0 se é um componente novo na bike hoje, ou os km da bike no momento da instalação.
          </small>
        </div>

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

        // Ao trocar tipo: sugere vida útil e estado de limpeza
        tipoSel.addEventListener('change', () => {
          const opt = tipoSel.selectedOptions[0];
          vidaInput.value = opt.dataset.vida;
          const temLimp = opt.dataset.limpeza === '1';
          limpChk.checked = temLimp;
          limpRow.style.display = temLimp ? '' : 'none';
          intervalEl.value = opt.dataset.intervalo;
        });

        limpChk.addEventListener('change', () => {
          limpRow.style.display = limpChk.checked ? '' : 'none';
        });
      },
    });
  }

  async function saveComponent(modal, bike, existingId) {
    const data = {
      tipo:               modal.querySelector('#c-tipo').value,
      vidaUtilKm:         parseFloat(modal.querySelector('#c-vida').value) || 0,
      kmAtInstall:        parseFloat(modal.querySelector('#c-km-install').value) || 0,
      temLimpeza:         modal.querySelector('#c-tem-limpeza').checked,
      intervaloLimpezaKm: parseFloat(modal.querySelector('#c-intervalo').value) || null,
    };
    if (data.vidaUtilKm <= 0) { toast('Vida útil deve ser > 0', { kind: 'error' }); return; }

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
      title: `Remover ${esc(TYPE_LABEL[comp.tipo] || comp.tipo)}?`,
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
      title: `Limpar ${esc(TYPE_LABEL[comp.tipo] || comp.tipo)}`,
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
    Modals.open({
      tag: 'Substituir componente',
      title: `Substituir ${esc(TYPE_LABEL[comp.tipo] || comp.tipo)}`,
      bodyHTML: `
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
          ${esc(bike.nome)} · km atual: <strong>${esc(fmtKm(bike.kmTotal))}</strong>
        </p>
        <div class="field">
          <label class="field-label" for="sub-data">Data da substituição</label>
          <input id="sub-data" class="field-input" type="date" value="${escAttr(todayISO())}" />
        </div>
        <div class="field">
          <label class="field-label" for="sub-vida">Nova vida útil da peça (km)</label>
          <input id="sub-vida" class="field-input" type="number" min="100" step="100"
                 value="${escAttr(comp.vidaUtilKm)}" />
        </div>
        <div class="field">
          <label class="field-label" for="sub-notas">Observações (opcional)</label>
          <textarea id="sub-notas" class="field-textarea" placeholder="Marca, motivo, custo…"></textarea>
        </div>
        <p style="font-size:12px;color:var(--muted2);margin-top:6px;">
          Km de desgaste desta peça serão zerados. O km total da bike continua acumulando.
        </p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
        { label: 'Confirmar troca', kind: 'primary', onClick: async (m) => {
          const data       = m.querySelector('#sub-data').value || todayISO();
          const notas      = m.querySelector('#sub-notas').value.trim();
          const vidaUtilKm = parseFloat(m.querySelector('#sub-vida').value) || comp.vidaUtilKm;
          try {
            await window.Api.post(`/bikes/${bike.id}/components/${compId}/substituir`,
              { data, notas, vidaUtilKm });
            toast('Substituição registrada');
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
      title: esc(bike.nome),
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
     Modal — Histórico de manutenções
  ─────────────────────────────────────────────────────────────────── */
  async function openLogModal(bike) {
    Modals.open({
      tag: 'Manutenções',
      title: esc(bike.nome),
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
      ? ` — ${esc(TYPE_LABEL[l.componentTipo] || l.componentTipo)}`
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
  };
})();
