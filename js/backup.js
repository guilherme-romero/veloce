/* ═══════════════════════════════════════════════════════════════════════
   BACKUP — exportar / importar todos os dados como JSON / PDF / ZIP
   Fase 13.x: snapshots automáticos, status, PDF filtrado, seção Bike,
              gráficos extras, resumo Strava/Garmin no JSON.
═══════════════════════════════════════════════════════════════════════ */

let _selectedPdfWindow = null;  // null = tudo; ou 30 / 90

function openBackupModal() {
  Modals.open({
    tag: 'Backup',
    title: 'Backup de dados',
    bodyHTML: `
      <p style="color:var(--muted2);font-size:13px;line-height:1.6;">
        Faça backup de todos os seus dados (perfil, treinos, modos, pesagens, passeios)
        ou importe um backup anterior.
      </p>

      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
        <button class="btn btn-primary" type="button" data-export>
          <i class="fa-solid fa-download"></i> Exportar tudo (.json)
        </button>

        <label class="btn btn-ghost" style="display:inline-flex;justify-content:center;cursor:pointer;">
          <i class="fa-solid fa-upload"></i> Importar backup (.json)
          <input id="backup-file" type="file" accept="application/json,.json" style="display:none" />
        </label>
      </div>

      <div style="border-top:1px solid var(--border);margin:14px 0 8px;"></div>
      <div class="field-label" style="margin-bottom:8px;">Relatório PDF</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" type="button" data-pdf-window="30" style="flex:1;min-width:80px;">30 dias</button>
        <button class="btn btn-ghost btn-sm" type="button" data-pdf-window="90" style="flex:1;min-width:80px;">90 dias</button>
        <button class="btn btn-ghost btn-sm" type="button" data-pdf-window="" style="flex:1;min-width:80px;">Tudo</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-primary" type="button" data-export-pdf>
          <i class="fa-solid fa-file-pdf"></i> Gerar relatório (.pdf)
        </button>
        <button class="btn btn-ghost" type="button" data-export-csv>
          <i class="fa-solid fa-file-csv"></i> Exportar pesagens (.csv)
        </button>
        <button class="btn btn-ghost" type="button" data-print>
          <i class="fa-solid fa-print"></i> Imprimir página atual
        </button>
      </div>

      <div style="border-top:1px solid var(--border);margin:14px 0 8px;"></div>
      <div class="field-label" style="margin-bottom:8px;">Base de dados completa</div>
      <button class="btn btn-ghost" type="button" data-export-zip style="width:100%;">
        <i class="fa-solid fa-file-zipper"></i> Baixar base de dados (.zip)
      </button>
      <p style="font-size:11px;color:var(--muted2);margin-top:6px;">
        Inclui o banco SQLite (<code>training.db</code>) e avatares.
        Não inclui tokens Garmin (por segurança).
      </p>

      <label class="btn btn-ghost" style="display:inline-flex;justify-content:center;cursor:pointer;width:100%;margin-top:8px;">
        <i class="fa-solid fa-database"></i> Restaurar base de dados (.zip)
        <input id="restore-file" type="file" accept="application/zip,.zip" style="display:none" />
      </label>
      <p style="font-size:11px;color:var(--red);margin-top:6px;">
        <i class="fa-solid fa-triangle-exclamation"></i> Substitui <strong>todo</strong> o banco atual.
        Um backup de segurança é criado antes e o servidor reinicia ao final.
      </p>

      <div style="border-top:1px solid var(--border);margin:14px 0 8px;"></div>
      <div class="field-label" style="margin-bottom:8px;">Snapshots automáticos</div>
      <div id="snapshots-card" style="font-size:12px;color:var(--muted2);">Carregando…</div>
      <button class="btn btn-ghost btn-sm" type="button" data-snapshot-now style="width:100%;margin-top:8px;">
        <i class="fa-solid fa-camera"></i> Criar snapshot agora
      </button>

      <div style="border-top:1px solid var(--border);margin:14px 0 8px;"></div>
      <div class="field-label" style="margin-bottom:8px;">Status da instalação</div>
      <div id="status-card" style="font-size:12px;color:var(--muted2);">Carregando…</div>

      <div style="border-top:1px solid var(--border);margin:14px 0 8px;"></div>
      <button class="btn btn-danger" type="button" data-reset>
        <i class="fa-solid fa-triangle-exclamation"></i> Apagar todos os dados
      </button>
      <button class="btn btn-ghost" type="button" data-carga-historica style="width:100%;margin-top:8px;">
        <i class="fa-solid fa-clock-rotate-left"></i> Carga histórica
      </button>
      <p style="font-size:11px;color:var(--muted2);margin-top:6px;">
        Sincroniza o máximo de dados disponíveis do Garmin (1 ano) e Strava (1 ano).
        Útil após uma limpeza ou na primeira configuração.
      </p>

      <div class="tip-box" style="margin-top:8px;font-size:12px;">
        <i class="fa-solid fa-circle-info"></i> O backup é um arquivo JSON simples. Guarde em local seguro (ex.: Google Drive, Dropbox).
      </div>
    `,
    actions: [
      { label: 'Fechar', kind: 'ghost', onClick: () => Modals.close() },
    ],
    onMount: (modal) => {
      modal.querySelector('[data-export]').onclick = exportData;
      modal.querySelector('#backup-file').onchange = (e) => importData(e.target.files[0]);
      modal.querySelector('[data-reset]').onclick = confirmReset;
      modal.querySelector('[data-carga-historica]').onclick = cargaHistorica;
      modal.querySelector('[data-export-csv]').onclick = exportWeightsCSV;
      modal.querySelector('[data-export-pdf]').onclick = () => exportRelatorioPDF(_selectedPdfWindow);
      modal.querySelector('[data-export-zip]').onclick = exportDataZip;
      modal.querySelector('#restore-file').onchange = (e) => {
        const f = e.target.files[0];
        e.target.value = '';  // permite reselecionar o mesmo arquivo
        if (f) confirmRestore(f);
      };
      modal.querySelector('[data-print]').onclick = () => { Modals.close(); setTimeout(() => window.print(), 300); };

      // Botões de período do PDF (toggle visual)
      const periodBtns = modal.querySelectorAll('[data-pdf-window]');
      const selectPeriod = (val) => {
        _selectedPdfWindow = val === '' ? null : parseInt(val, 10);
        periodBtns.forEach(b => {
          const active = b.getAttribute('data-pdf-window') === val;
          b.classList.toggle('btn-primary', active);
          b.classList.toggle('btn-ghost', !active);
        });
      };
      periodBtns.forEach(b => b.onclick = () => selectPeriod(b.getAttribute('data-pdf-window')));
      selectPeriod('');  // padrão: tudo

      // Snapshot manual
      modal.querySelector('[data-snapshot-now]').onclick = () => createSnapshotNow(modal);

      // Carregar cards (assíncrono, não bloqueia abertura do modal)
      loadSnapshotsCard(modal);
      loadStatusCard(modal);
    },
  });
}

// ── Snapshots ────────────────────────────────────────────────────────────
async function loadSnapshotsCard(modal) {
  const el = modal.querySelector('#snapshots-card');
  try {
    const r = await window.Api.get('/backup/list');
    const items = (r?.items || []);
    if (!items.length) {
      el.innerHTML = `<em>Nenhum snapshot ainda. Crie um manualmente abaixo ou aguarde o disparo automático semanal.</em>`;
      return;
    }
    const human = (b) => b > 1e6 ? (b/1e6).toFixed(1)+' MB' : (b/1e3).toFixed(0)+' KB';
    el.innerHTML = items.slice(0, 8).map(it => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
        <span><i class="fa-solid fa-file-zipper"></i> ${esc(it.name)}</span>
        <span style="display:flex;gap:8px;align-items:center;">
          <span style="color:var(--muted2);">${human(it.size)}</span>
          <a href="/api/backup/file/${encodeURIComponent(it.name)}" download style="color:var(--teal);"><i class="fa-solid fa-download"></i></a>
        </span>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<em style="color:var(--red);">Falha ao listar: ${esc(e.message || e)}</em>`;
  }
}

async function createSnapshotNow(modal) {
  toast('Criando snapshot…');
  try {
    const r = await window.Api.post('/backup/snapshot', {});
    if (r?.ok) {
      toast('Snapshot criado: ' + r.file);
      loadSnapshotsCard(modal);
      loadStatusCard(modal);
    } else {
      toast('Falha ao criar snapshot: ' + (r?.error || 'desconhecido'), { kind: 'error' });
    }
  } catch (e) {
    toast('Falha ao criar snapshot: ' + (e.message || e), { kind: 'error' });
  }
}

// ── Status (/api/health ampliado) ────────────────────────────────────────
async function loadStatusCard(modal) {
  const el = modal.querySelector('#status-card');
  try {
    const h = await window.Api.get('/health');
    const human = (b) => b == null ? '—' : (b > 1e9 ? (b/1e9).toFixed(2)+' GB' : b > 1e6 ? (b/1e6).toFixed(1)+' MB' : (b/1e3).toFixed(0)+' KB');
    const fmtDate = (s) => s ? new Date(s).toLocaleString('pt-BR') : '—';
    const c = h.counts || {};
    const backupTxt = h.backup
      ? `${fmtDate(h.backup.mtime)} (há ${h.backup.ageDays}d · ${h.backup.count} no total)`
      : 'Nunca';
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;">
        <div><b>Versão:</b> ${esc(h.version || '—')}</div>
        <div><b>Banco:</b> ${human(h.db?.size)}</div>
        <div><b>Pesagens:</b> ${c.weights ?? '—'}</div>
        <div><b>Atividades:</b> ${(c.stravaActs ?? 0) + (c.garminActs ?? 0)}</div>
        <div><b>Bikes:</b> ${c.bikes ?? '—'}</div>
        <div><b>Rotas:</b> ${c.routes ?? '—'}</div>
      </div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">
        <div><b>Último sync Garmin:</b> ${fmtDate(h.sync?.garminLast)}</div>
        <div><b>Último sync Strava:</b> ${fmtDate(h.sync?.stravaLast)}</div>
        <div><b>Último snapshot:</b> ${backupTxt}</div>
        <div><b>Espaço livre:</b> ${human(h.disk?.freeBytes)}</div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<em style="color:var(--red);">Falha ao carregar status: ${esc(e.message || e)}</em>`;
  }
}

// ── Download da base de dados completa em ZIP ────────────────────────────
async function exportDataZip() {
  toast('Preparando ZIP da base de dados…');
  try {
    const resp = await fetch('/api/backup/data-zip', { credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const cd = resp.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/i);
    const filename = match ? match[1] : `veloce-data-${new Date().toISOString().slice(0, 10)}.zip`;
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    toast('ZIP baixado');
  } catch (e) {
    console.error('[Backup] ZIP', e);
    toast('Falha ao baixar ZIP: ' + (e.message || e), { kind: 'error' });
  }
}

// ── Restaurar base de dados a partir de ZIP (Fase 15.1) ──────────────────
function confirmRestore(file) {
  const sizeTxt = file.size > 1e6 ? (file.size / 1e6).toFixed(1) + ' MB' : (file.size / 1e3).toFixed(0) + ' KB';
  Modals.close();
  Modals.open({
    tag: 'Atenção',
    title: 'Restaurar base de dados?',
    bodyHTML: `
      <p style="color:var(--muted2);font-size:14px;line-height:1.7;">
        Você vai substituir <strong style="color:var(--red)">todo</strong> o banco atual
        pelos dados de:
      </p>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 12px;margin:8px 0;font-size:13px;">
        <i class="fa-solid fa-file-zipper"></i> ${esc(file.name)}
        <span style="color:var(--muted2);">· ${sizeTxt}</span>
      </div>
      <p style="color:var(--muted2);font-size:13px;line-height:1.6;">
        Um <strong>backup de segurança</strong> do banco atual é gravado antes da troca.
        O servidor <strong>reinicia</strong> ao final e a página recarrega sozinha.
        Essa ação <strong>não pode ser desfeita</strong> pela interface.
      </p>
      <div class="field-label" style="margin:12px 0 6px;">Digite <strong>RESTAURAR</strong> para confirmar</div>
      <input id="restore-confirm" type="text" class="field-input" autocomplete="off" placeholder="RESTAURAR"
             style="width:100%;text-transform:uppercase;letter-spacing:1px;" />
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Restaurar', kind: 'danger', onClick: () => {
        const v = (document.getElementById('restore-confirm')?.value || '').trim().toUpperCase();
        if (v !== 'RESTAURAR') { toast('Digite RESTAURAR para confirmar', { kind: 'error' }); return; }
        restoreFromZip(file);
      }},
    ],
    onMount: (modal) => {
      const inp = modal.querySelector('#restore-confirm');
      if (inp) setTimeout(() => inp.focus(), 100);
    },
  });
}

async function restoreFromZip(file) {
  Modals.close();
  toast('Enviando backup e restaurando…');
  try {
    const resp = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await resp.json(); } catch (e) { /* sem corpo JSON */ }
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    toast('Backup restaurado · servidor reiniciando, recarregando em instantes…', { duration: 9000 });
    // O backend reinicia (RestartSec=5 + boot ≈ 6-8s). Aguarda e recarrega.
    setTimeout(() => location.reload(), 9000);
  } catch (e) {
    console.error('[Backup] restore', e);
    toast('Falha ao restaurar: ' + (e.message || e), { kind: 'error' });
  }
}

// ── Relatório PDF (gerado server-side via Playwright — #95) ────────────────
// Antes era montado no cliente com jsPDF (desenho célula a célula). Agora o
// backend renderiza a rota de impressão /api/report/print com Playwright e
// devolve o PDF pronto (2 páginas A4, design Hi-Vis Peloton). Aqui só
// disparamos o download e tratamos erro/UX.
async function exportRelatorioPDF(daysWindow) {
  toast('Gerando relatório PDF…');
  try {
    const qs = daysWindow ? `?days=${encodeURIComponent(daysWindow)}` : '';
    const resp = await fetch(`/api/report/pdf${qs}`, { credentials: 'same-origin' });
    if (resp.status === 401) { location.replace('/login.html'); return; }
    if (!resp.ok) {
      let msg = `Erro ${resp.status}`;
      try { const j = await resp.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const suffix = daysWindow ? `-${daysWindow}d` : '-completo';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veloce-labs-relatorio${suffix}-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Relatório PDF gerado');
  } catch (err) {
    console.error('[Backup] PDF', err);
    toast('Falha ao gerar PDF: ' + (err.message || err), { kind: 'error' });
  }
}

function exportData() {
  try {
    // exportJSON agora pode ser async (puxa resumo Strava/Garmin)
    Promise.resolve(Storage.exportJSON()).then(json => {
      const today = tbToday();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `treino-bike-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Backup exportado');
    }).catch(e => {
      console.error(e);
      toast('Falha ao exportar', { kind: 'error' });
    });
  } catch (e) {
    console.error(e);
    toast('Falha ao exportar', { kind: 'error' });
  }
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = e.target.result;
      const parsed = JSON.parse(json);
      if (!parsed.user && !parsed.weights && !parsed.rides && !parsed.trainingLog) {
        throw new Error('Estrutura inválida: sem dados reconhecidos');
      }
      validateBackupStructure(parsed);
      await Storage.importJSON(json);
      Modals.close();
      toast('Backup importado · recarregando…');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      console.error(err);
      toast('Arquivo inválido: ' + err.message, { kind: 'error' });
    }
  };
  reader.readAsText(file);
}

function validateBackupStructure(p) {
  if (p.user && typeof p.user !== 'object') throw new Error('user corrompido');
  if (p.user) {
    const u = p.user;
    if (u.nome !== undefined && typeof u.nome !== 'string') throw new Error('user.nome inválido');
    if (u.altura !== undefined && (isNaN(u.altura) || u.altura < 50 || u.altura > 300))
      throw new Error('user.altura fora do intervalo');
    if (u.pesoAtual !== undefined && (isNaN(u.pesoAtual) || u.pesoAtual < 10 || u.pesoAtual > 600))
      throw new Error('user.pesoAtual fora do intervalo');
    // pesoMeta e bikePeso caem em value="" no modal de perfil — sem validacao
    // aqui, um backup com string arbitraria quebrava o atributo (BUG-056).
    if (u.pesoMeta !== undefined && u.pesoMeta !== '' &&
        (isNaN(u.pesoMeta) || u.pesoMeta < 10 || u.pesoMeta > 600))
      throw new Error('user.pesoMeta fora do intervalo');
    if (u.bikePeso !== undefined && u.bikePeso !== '' &&
        (isNaN(u.bikePeso) || u.bikePeso < 1 || u.bikePeso > 100))
      throw new Error('user.bikePeso fora do intervalo');
  }
  // Nota: backups antigos podem trazer `modes`/`workouts`/`homeExercises`
  // (feature removida, issue #36) — Storage.importJSON já ignora essas
  // chaves de propósito, então não há validação correspondente aqui.
  if (p.weights !== undefined) {
    if (!Array.isArray(p.weights)) throw new Error('weights deve ser array');
    if (p.weights.length > 5000) throw new Error('weights: número excessivo de registros');
  }
  if (p.rides !== undefined) {
    if (!Array.isArray(p.rides)) throw new Error('rides deve ser array');
    if (p.rides.length > 1000) throw new Error('rides: número excessivo de registros');
  }
  if (p.trainingLog !== undefined) {
    if (!Array.isArray(p.trainingLog)) throw new Error('trainingLog deve ser array');
  }
  if (p.routes !== undefined) {
    if (!Array.isArray(p.routes)) throw new Error('routes deve ser array');
    if (p.routes.length > 20) throw new Error('routes: número excessivo de registros');
  }
}

function confirmReset() {
  Modals.close();
  Modals.open({
    tag: 'Atenção',
    title: 'Apagar todos os dados?',
    bodyHTML: `
      <p style="color:var(--muted2);font-size:14px;line-height:1.7;">
        Isso vai remover <strong style="color:var(--red)">tudo</strong>: perfil, treinos, modos, pesagens e passeios.
        <br><br>
        Recomendamos exportar um backup antes. Essa ação <strong>não pode ser desfeita</strong>.
      </p>
    `,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => Modals.close() },
      { label: 'Apagar tudo', kind: 'danger', onClick: () => {
        Storage.clearAll();
        Modals.close();
        toast('Dados apagados · recarregando…');
        setTimeout(() => location.reload(), 800);
      }},
    ],
  });
}

let _cargaRunning = false;

async function cargaHistorica() {
  if (_cargaRunning) {
    toast('Sincronização em andamento…', { kind: 'error' });
    return;
  }

  Modals.close();

  const [garminStatus, stravaStatus] = await Promise.all([
    window.Api.get('/garmin/status').catch(() => null),
    window.Api.get('/strava/status').catch(() => null),
  ]);
  const doGarmin = !!(garminStatus && garminStatus.configured && garminStatus.connected);
  const doStrava = !!(stravaStatus && stravaStatus.configured && stravaStatus.connected);

  if (!doGarmin && !doStrava) {
    toast('Nenhum serviço conectado. Configure em Conexões.', { kind: 'error' });
    return;
  }

  _cargaRunning = true;

  // Monta lista de etapas conforme serviços disponíveis
  const steps = [];
  if (doGarmin) {
    steps.push({ label: 'Garmin atividades', fn: () => window.Api.post('/garmin/sync',         { days: 1095 }) });
    steps.push({ label: 'Garmin pesagens',   fn: () => window.Api.post('/garmin/sync-weights', { days: 3650 }) });
    steps.push({ label: 'Garmin saúde',      fn: () => window.Api.post('/garmin/sync-health',  { days: 365  }) });
    steps.push({ label: 'Garmin extras',     fn: () => window.Api.post('/garmin/sync-extras',  { days: 90   }) });
  }
  if (doStrava) {
    steps.push({ label: 'Strava',            fn: () => window.Api.post('/strava/sync',         { days: 1095 }) });
  }

  const total = steps.length;
  let done = 0, totalActs = 0;
  const failed = [];

  // Toast persistente de progresso — inserido na mesma toast-stack
  const stack = document.querySelector('.toast-stack') || (() => {
    const s = document.createElement('div');
    s.className = 'toast-stack';
    document.body.appendChild(s);
    return s;
  })();
  const progEl = document.createElement('div');
  progEl.className = 'toast toast-progress';
  stack.appendChild(progEl);

  function updateProgress(stepLabel, ok) {
    done++;
    const pct = Math.round((done / total) * 100);
    const bar = `<div class="toast-prog-bar" style="width:${pct}%"></div>`;
    const status = ok
      ? `<i class="fa-solid fa-circle-check" style="color:var(--teal)"></i>`
      : `<i class="fa-solid fa-circle-exclamation" style="color:var(--red)"></i>`;
    progEl.innerHTML = `
      <div class="toast-prog-inner">
        <div class="toast-prog-head">
          <span><i class="fa-solid fa-clock-rotate-left"></i> Carga histórica</span>
          <span class="toast-prog-pct">${pct}%</span>
        </div>
        <div class="toast-prog-track">${bar}</div>
        <div class="toast-prog-step">${status} ${stepLabel}</div>
      </div>`;
  }

  // Inicia com estado "iniciando"
  progEl.innerHTML = `
    <div class="toast-prog-inner">
      <div class="toast-prog-head">
        <span><i class="fa-solid fa-clock-rotate-left"></i> Carga histórica</span>
        <span class="toast-prog-pct">0%</span>
      </div>
      <div class="toast-prog-track"><div class="toast-prog-bar" style="width:0%"></div></div>
      <div class="toast-prog-step"><i class="fa-solid fa-spinner fa-spin"></i> Iniciando…</div>
    </div>`;

  // Executa etapas em paralelo, atualizando o progresso individualmente
  await Promise.all(steps.map(step =>
    step.fn()
      .then(r => {
        totalActs += (r && r.imported || 0) + (r && r.updated || 0);
        updateProgress(step.label, true);
      })
      .catch(() => {
        failed.push(step.label);
        updateProgress(step.label, false);
      })
  ));

  _cargaRunning = false;

  // Remove o toast de progresso após 2s e exibe o toast final
  setTimeout(() => {
    progEl.classList.add('fading');
    progEl.addEventListener('animationend', () => progEl.remove(), { once: true });
  }, 2000);

  if (failed.length) {
    toast(`Carga concluída com erros: ${failed.join(', ')}`, { kind: 'error', duration: 4000 });
  } else {
    const msg = totalActs > 0 ? `Carga histórica concluída · ${totalActs} atividades` : 'Carga histórica concluída';
    toast(msg, { kind: 'success' });
  }

  try { if (window.Home) Home.load(); } catch (_) {}
}

function exportWeightsCSV() {
  try {
    const weights = Storage.getWeights().sort((a, b) => a.data.localeCompare(b.data));
    if (!weights.length) { toast('Nenhuma pesagem registrada', { kind: 'error' }); return; }
    // Quota campos e neutraliza fórmulas (CSV/formula injection): prefixa com
    // apóstrofo valores que começam com = + - @ e escapa aspas duplas.
    const csvCell = (v) => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = 'data,peso_kg,tipo,fonte\n';
    const rows = weights.map(w =>
      [w.data, w.peso, w.tipo || 'atual', w.fonte || 'manual'].map(csvCell).join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pesagens-${tbToday()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('CSV exportado');
  } catch (e) {
    console.error(e);
    toast('Falha ao exportar CSV', { kind: 'error' });
  }
}

window.Backup = { open: openBackupModal, exportWeightsCSV };
