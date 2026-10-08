/* ═══════════════════════════════════════════════════════════════════════
   NOTIFICATIONS — sino global in-app (IDEIA-6, Nível A)
   Reúne sinais que já existem no app (novo recorde, próximo passeio, clima
   do dia p/ pedalar, última atividade) num painel. Badge conta os não-vistos;
   estado "lido" persiste em localStorage. Sem backend novo.
   (Push ativo no celular = Nível B, ainda no roadmap.)
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const SEEN_KEY = 'tb_notif_seen';
  const DAY_MS   = 86400000;

  let _cache = [];      // últimas notificações computadas: {id, icon, color, title, text}
  let _loading = null;  // promise de load() em andamento (coalesce chamadas concorrentes)

  function _todayISO() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
  }
  function _fmtDate(iso) {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); }
    catch { return iso || ''; }
  }
  function _esc(s) { return (window.esc || (x => String(x == null ? '' : x)))(s); }

  function _seen() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function _markSeen(ids) {
    const s = _seen();
    ids.forEach(id => s.add(id));
    // guarda só os últimos ids p/ não crescer sem limite
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200))); } catch (_) {}
  }

  // ── Coletores (cada um devolve array de notificações; tolerante a falha) ──

  // Recorde: agrega os PRs dos últimos 30 dias (mesma janela/tipos do card de
  // Insights). Uma notificação só, cujo id muda quando surge um recorde novo.
  const ALLOWED_PR_TYPES = new Set([14, 8, 15, 9, 13]);
  async function _recordes() {
    try {
      const prs = await window.Api.get('/garmin/personal-records');
      if (!Array.isArray(prs)) return [];
      const now = Date.now();
      const recentes = prs
        .filter(p => ALLOWED_PR_TYPES.has(p.type_id))
        .map(p => ({ p, d: p.pr_date || p.activity_date }))
        .filter(x => x.d && (now - new Date(x.d + 'T12:00:00').getTime()) <= 30 * DAY_MS)
        .sort((a, b) => (a.d < b.d ? 1 : -1));
      if (!recentes.length) return [];
      const ult = recentes[0];
      const n = recentes.length;
      return [{
        id: `pr:${ult.d}:${n}`,
        icon: 'fa-trophy', color: 'var(--lime)',
        title: n > 1 ? `${n} novos recordes` : 'Novo recorde!',
        text: `${_esc(ult.p.activity_name || 'atividade')} em ${_fmtDate(ult.d)}` +
              (n > 1 ? ` e mais ${n - 1}.` : '.'),
      }];
    } catch { return []; }
  }

  // Próximo passeio (cache já carregado no boot): notifica o mais próximo
  // dentro de ~2 dias.
  function _proximoPasseio() {
    try {
      if (!window.Storage || !Storage.getRides) return [];
      const hoje = _todayISO();
      const futuros = Storage.getRides()
        .filter(r => r.data >= hoje)
        .sort((a, b) => (a.data < b.data ? -1 : 1));
      if (!futuros.length) return [];
      const r = futuros[0];
      const diff = Math.round((new Date(r.data + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / DAY_MS);
      if (diff > 2) return [];
      const quando = diff <= 0 ? 'hoje' : diff === 1 ? 'amanhã' : `em ${diff} dias`;
      return [{
        id: `ride:${r.id}`,
        icon: 'fa-calendar-day', color: 'var(--magenta)',
        title: `Passeio ${quando}`,
        text: `${_esc(r.destino || 'Passeio')} — ${_fmtDate(r.data)}` +
              (r.distancia ? ` · ${r.distancia} km` : '') + '.',
      }];
    } catch { return []; }
  }

  // Clima do dia p/ pedalar: reusa Rides.dayRating (weatherByDate + ridesEsforco).
  async function _climaHoje() {
    try {
      if (!window.Rides || !Rides.dayRating) return [];
      const hoje = _todayISO();
      const r = await Rides.dayRating(hoje);
      if (!r) return [];
      return [{
        id: `weather:${hoje}`,
        icon: 'fa-cloud-sun', color: r.color || 'var(--teal)',
        title: `Clima de hoje: ${r.label}`,
        text: r.alert ? _esc(r.alert)
          : `Máx ${r.tMax != null ? r.tMax + '°C' : '—'}${r.chuva != null ? ` · ${r.chuva}% chuva` : ''}.`,
      }];
    } catch { return []; }
  }

  // Última atividade registrada.
  async function _ultimaAtividade() {
    try {
      const resp = await window.Api.get('/activities/latest');
      const a = resp && resp.item;
      if (!a) return [];
      const dISO = (a.inicio || a.data || '').slice(0, 10);
      const km = isFinite(a.distanciaKm) ? `${a.distanciaKm.toFixed(1).replace('.', ',')} km` : '';
      return [{
        id: `activity:${a.id}`,
        icon: 'fa-person-biking', color: 'var(--teal)',
        title: 'Última atividade',
        text: `${_esc(a.nome || 'Pedal')}${km ? ' · ' + km : ''}${dISO ? ' · ' + _fmtDate(dISO) : ''}.`,
      }];
    } catch { return []; }
  }

  function _updateBadge() {
    const el = document.getElementById('notif-count');
    if (!el) return;
    const seen = _seen();
    const n = _cache.filter(x => !seen.has(x.id)).length;
    if (n > 0) { el.textContent = n > 9 ? '9+' : String(n); el.hidden = false; }
    else { el.hidden = true; }
  }

  // Recalcula todas as fontes e atualiza o badge. Chamadas concorrentes (ex.:
  // sync Garmin + Strava em paralelo, ou clique no sino durante o load do boot)
  // reusam a mesma promise em andamento — evita disparar as 4 rotas em dobro.
  function load() {
    if (_loading) return _loading;
    _loading = (async () => {
      try {
        const grupos = await Promise.all([
          _recordes(), Promise.resolve(_proximoPasseio()), _climaHoje(), _ultimaAtividade(),
        ]);
        _cache = grupos.flat();
      } catch { _cache = []; }
      _updateBadge();
    })().finally(() => { _loading = null; });
    return _loading;
  }

  // Marca o que está no cache como visto e zera o badge.
  function _consumir() {
    if (!_cache.length) return;       // nada a marcar: não "consome" notificação futura
    _markSeen(_cache.map(x => x.id));
    _updateBadge();
  }

  // ── Render do dropdown (Sino A+): Novas × Anteriores ──────────────────
  // CONTRATO XSS: `title` é escapado aqui; `text` entra cru — cada coletor DEVE
  // escapar (_esc) os campos vindos de dados externos ao montar `text`.
  function _card(x, seen) {
    const novo = !seen.has(x.id);
    return `<div class="notif-item${novo ? ' notif-unseen' : ' notif-seen'}">` +
      `<span class="notif-ico" style="color:${x.color}"><i class="fa-solid ${x.icon}"></i></span>` +
      `<div class="notif-body"><div class="notif-title">${_esc(x.title)}</div>` +
      `<div class="notif-text">${x.text}</div></div></div>`;
  }

  // `seenSnap`: snapshot do "visto" tirado na abertura. Assim os itens desta
  // sessão ficam em "Novas" mesmo depois de o badge zerar (não "pulam" a lista).
  function _bodyHTML(seenSnap) {
    if (!_cache.length) {
      return '<div class="notif-scroll"><div class="notif-empty">' +
        '<i class="fa-solid fa-bell-slash"></i>Nada novo por aqui. 🚴</div></div>';
    }
    const novas   = _cache.filter(x => !seenSnap.has(x.id));
    const antigas = _cache.filter(x =>  seenSnap.has(x.id));
    let html = '';
    if (novas.length) {
      html += '<div class="notif-group-label is-novas">Novas ' +
        `<span class="notif-group-n">${novas.length}</span>` +
        '<span class="notif-group-rule"></span></div>' +
        `<div class="notif-list">${novas.map(x => _card(x, seenSnap)).join('')}</div>`;
    }
    if (antigas.length) {
      html += '<div class="notif-group-label is-antigas">Anteriores' +
        '<span class="notif-group-rule"></span></div>' +
        `<div class="notif-list">${antigas.map(x => _card(x, seenSnap)).join('')}</div>`;
    }
    return `<div class="notif-scroll">${html}</div>`;
  }

  function _headHTML(hasNovas) {
    return '<div class="notif-head"><span class="notif-head-title">Novidades</span>' +
      (hasNovas ? '<button type="button" class="notif-clear">Marcar todas como lidas</button>' : '') +
      '</div>';
  }

  // ── Abertura/posicionamento/fechamento do dropdown ancorado ───────────
  let _open = false;
  const _pop = () => document.getElementById('notif-pop');
  const _btn = () => document.getElementById('btn-notif');

  // Posiciona sob o sino, alinhado à direita, limitado à janela (padrão do
  // popover de Insights). A seta aponta o centro do botão.
  function _position() {
    const pop = _pop(), btn = _btn();
    if (!pop || !btn) return;
    const rect = btn.getBoundingClientRect();
    const pw = Math.min(344, window.innerWidth - 24);
    pop.style.width = pw + 'px';
    let left = rect.right - pw;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
    if (left < 12) left = 12;
    pop.style.left = left + 'px';
    pop.style.top  = (rect.bottom + 10) + 'px';
    const arrow = rect.left + rect.width / 2 - left - 6;
    pop.style.setProperty('--notif-arrow-x', Math.max(10, Math.min(pw - 22, arrow)) + 'px');
  }

  function _onKey(e) { if (e.key === 'Escape') close(); }
  // Reposiciona ao rolar a página, mas ignora o scroll interno da própria lista
  // (o sino não se moveu — só evita reescrever o estilo a cada frame).
  function _onScroll(e) {
    if (e.target instanceof Node && _pop()?.contains(e.target)) return;
    _position();
  }
  function _onDocClick(e) {
    const t = e.target;
    if (t instanceof Element && (t.closest('#notif-pop') || t.closest('#btn-notif'))) return;
    close();
  }

  function _renderPanel(seenSnap) {
    const pop = _pop();
    if (!pop) return;
    const hasNovas = _cache.some(x => !seenSnap.has(x.id));
    pop.innerHTML = _headHTML(hasNovas) + _bodyHTML(seenSnap);
    const clear = pop.querySelector('.notif-clear');
    // "Marcar todas como lidas": re-render com o visto atual (Novas → Anteriores).
    if (clear) clear.addEventListener('click', () => { _renderPanel(_seen()); _position(); });
  }

  function close() {
    const pop = _pop();
    if (pop) { pop.hidden = true; pop.innerHTML = ''; }
    _btn()?.classList.remove('active');
    _open = false;
    document.removeEventListener('keydown', _onKey, true);
    document.removeEventListener('click', _onDocClick, true);
    window.removeEventListener('resize', _position);
    window.removeEventListener('scroll', _onScroll, true);
  }

  function open() {
    if (_open) { close(); return; }        // toggle ao reclicar o sino
    const pop = _pop();
    if (!pop) return;
    const seenSnap = _seen();               // snapshot ANTES de consumir
    const carregando = !_cache.length;      // load do boot pode não ter terminado

    pop.hidden = false;
    _btn()?.classList.add('active');
    _open = true;
    document.addEventListener('keydown', _onKey, true);
    // adia o clique-fora p/ não capturar o próprio clique que abriu o painel
    setTimeout(() => { if (_open) document.addEventListener('click', _onDocClick, true); }, 0);
    window.addEventListener('resize', _position);
    window.addEventListener('scroll', _onScroll, true);

    if (carregando) {
      pop.innerHTML = _headHTML(false) +
        '<div class="notif-scroll"><div class="notif-empty">' +
        '<i class="fa-solid fa-spinner fa-spin"></i>Carregando…</div></div>';
      _position();
      load().then(() => {
        if (!_open) { _updateBadge(); return; }   // usuário fechou antes: não consome
        _renderPanel(_seen());
        _position();
        _consumir();
      });
    } else {
      _renderPanel(seenSnap);
      _position();
      _consumir();
    }
  }

  window.Notifications = { load, open, close };
})();
