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
      modal.querySelector('[data-export-csv]').onclick = exportWeightsCSV;
      modal.querySelector('[data-export-pdf]').onclick = () => exportRelatorioPDF(_selectedPdfWindow);
      modal.querySelector('[data-export-zip]').onclick = exportDataZip;
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
    const filename = match ? match[1] : `treino-bike-data-${new Date().toISOString().slice(0, 10)}.zip`;
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

// ── Relatório PDF (jsPDF) ────────────────────────────────────────────────
async function exportRelatorioPDF(daysWindow) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('Biblioteca PDF não carregada. Recarregue a página.', { kind: 'error' });
    return;
  }
  toast('Gerando relatório PDF…');
  try {
    await buildRelatorioPDF(daysWindow);
    toast('Relatório PDF gerado');
  } catch (err) {
    console.error('[Backup] PDF', err);
    toast('Falha ao gerar PDF: ' + (err.message || err), { kind: 'error' });
  }
}

async function buildRelatorioPDF(daysWindow) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const H   = pdf.internal.pageSize.getHeight();
  const PAD = 40;
  let y = PAD;

  const u = (window.Storage && Storage.getUser && Storage.getUser()) || {};
  const userName = u.nome || 'Usuário';
  const todayLong = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  const versao = window.APP_VERSION || '';

  // Cutoff de período (em ISO date)
  const cutoffISO = daysWindow ? new Date(Date.now() - daysWindow * 86400000).toISOString().slice(0, 10) : null;
  const periodoTxt = daysWindow ? `Últimos ${daysWindow} dias` : 'Período completo';

  // Helpers
  const setSection = (text) => {
    if (y > H - 100) { pdf.addPage(); y = PAD; }
    y += 6;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(20, 217, 184);
    pdf.text(text, PAD, y);
    pdf.setDrawColor(20, 217, 184);
    pdf.setLineWidth(1.2);
    pdf.line(PAD, y + 4, W - PAD, y + 4);
    y += 18;
    pdf.setTextColor(40);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
  };
  const writeLine = (label, value) => {
    if (y > H - 50) { pdf.addPage(); y = PAD; }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text(label, PAD, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(String(value ?? '—'), PAD + 150, y);
    y += 14;
  };
  const ensureSpace = (h) => { if (y + h > H - PAD) { pdf.addPage(); y = PAD; } };
  const captureCanvas = (id, sectionTitle) => {
    const canvas = document.getElementById(id);
    if (!canvas || !canvas.width || canvas.width < 10) return false;
    try {
      setSection(sectionTitle);
      const imgData = canvas.toDataURL('image/png');
      const ratio = canvas.height / canvas.width;
      const imgW = W - 2 * PAD;
      const imgH = Math.min(imgW * ratio, 300);
      ensureSpace(imgH + 8);
      pdf.addImage(imgData, 'PNG', PAD, y, imgW, imgH);
      y += imgH + 8;
      return true;
    } catch (e) { console.warn('[PDF] canvas', id, e); return false; }
  };

  // ─── CAPA ─────────────────────────────────────────────────────────────
  pdf.setFillColor(20, 217, 184);
  pdf.rect(0, 0, W, 120, 'F');
  pdf.setTextColor(255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(28);
  pdf.text('Treino Bike', PAD, 60);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Relatório de evolução', PAD, 90);
  pdf.setTextColor(40);
  y = 160;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(userName, PAD, y);
  y += 24;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.text(todayLong, PAD, y); y += 16;
  pdf.text(`Período: ${periodoTxt}`, PAD, y); y += 16;
  if (versao) { pdf.text(`Versão do app: ${versao}`, PAD, y); y += 24; }

  // ─── PERFIL RESUMIDO ─────────────────────────────────────────────────
  setSection('Perfil');
  const allWeights = Storage.getWeights ? Storage.getWeights() : [];
  const weights = cutoffISO ? allWeights.filter(w => (w.data || '') >= cutoffISO) : allWeights;
  const lastWeight = allWeights.length ? allWeights[allWeights.length - 1] : null;
  const altura = u.altura || 0;
  const imc = (lastWeight && altura) ? (lastWeight.peso / Math.pow(altura / 100, 2)).toFixed(1) : '—';
  writeLine('Peso atual:',     lastWeight ? `${lastWeight.peso.toFixed(1)} kg` : '—');
  writeLine('Meta de peso:',   u.pesoMeta ? `${u.pesoMeta} kg` : '—');
  writeLine('Altura:',         altura ? `${altura} cm` : '—');
  writeLine('IMC:',            imc);
  writeLine('Pesagens no período:', weights.length);
  const allRides = Storage.getRides ? Storage.getRides() : [];
  const ridesPeriodo = cutoffISO ? allRides.filter(r => (r.data || '') >= cutoffISO) : allRides;
  writeLine('Passeios no período:', ridesPeriodo.length);

  // ─── GRÁFICO DE PESO ─────────────────────────────────────────────────
  captureCanvas('weightChart', 'Evolução de peso');

  // ─── ÚLTIMAS PESAGENS ────────────────────────────────────────────────
  if (weights.length > 0) {
    setSection('Pesagens');
    const top = weights.slice(-20).reverse();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text('Data',  PAD, y);
    pdf.text('Peso',  PAD + 150, y);
    pdf.text('Tipo',  PAD + 230, y);
    y += 14;
    pdf.setFont('helvetica', 'normal');
    for (const w of top) {
      if (y > H - 40) { pdf.addPage(); y = PAD; }
      pdf.text(w.data || '—',                       PAD, y);
      pdf.text(w.peso != null ? `${w.peso.toFixed(1)} kg` : '—', PAD + 150, y);
      pdf.text(w.tipo || '—',                        PAD + 230, y);
      y += 13;
    }
  }

  // ─── ATIVIDADES NO PERÍODO ───────────────────────────────────────────
  try {
    const days = daysWindow || 365 * 5;  // tudo ≈ 5 anos
    const acts = await window.Api.get(`/activities/unified?days=${days}`);
    const items = (acts?.items || acts || []).slice(0, daysWindow ? 50 : 30);
    if (items.length > 0) {
      setSection(`Histórico de atividades (${periodoTxt.toLowerCase()})`);
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Data',       PAD, y);
      pdf.text('Nome',       PAD + 60, y);
      pdf.text('Km',         PAD + 320, y);
      pdf.text('Tempo',      PAD + 370, y);
      pdf.text('Elev.',      PAD + 425, y);
      pdf.text('FC',         PAD + 475, y);
      y += 13;
      pdf.setFont('helvetica', 'normal');
      for (const a of items) {
        if (y > H - 40) { pdf.addPage(); y = PAD; }
        const nome = (a.nome || 'Atividade').slice(0, 38);
        const tempo = a.tempoMovS ? `${Math.floor(a.tempoMovS / 3600)}h${String(Math.floor((a.tempoMovS % 3600) / 60)).padStart(2, '0')}` : '—';
        pdf.text(String(a.data || '—'),                          PAD, y);
        pdf.text(nome,                                            PAD + 60, y);
        pdf.text(a.distanciaKm ? a.distanciaKm.toFixed(1) : '—',  PAD + 320, y);
        pdf.text(tempo,                                           PAD + 370, y);
        pdf.text(a.elevacaoM ? Math.round(a.elevacaoM) + ' m' : '—', PAD + 425, y);
        pdf.text(a.fcMedia ? Math.round(a.fcMedia) + '' : '—',    PAD + 475, y);
        y += 12;
      }
    }
  } catch (e) { console.warn('[PDF] atividades', e); }

  // ─── GRÁFICOS ADICIONAIS (Fase 13.2.1) ───────────────────────────────
  captureCanvas('volumeChart',  'Volume mensal');
  captureCanvas('weeklyKmChart','Km semanais');
  captureCanvas('hrvLoadChart', 'HRV × Carga');

  // ─── INSIGHTS RESUMIDOS ──────────────────────────────────────────────
  setSection('Insights');
  const readVal = (id) => {
    const el = document.getElementById(id);
    return el ? (el.textContent || '').trim() : '—';
  };
  writeLine('Fadiga (0-100):',         readVal('fadiga-score'));
  writeLine('Training Readiness:',     readVal('readiness-value'));
  writeLine('Endurance Score:',        readVal('endurance-value'));
  writeLine('Hill Score:',             readVal('hill-value'));
  writeLine('TRIMP/kg semanal:',       readVal('intensity-week'));
  writeLine('Custo metabólico:',       readVal('cost-week'));

  // ─── RECORDES PESSOAIS ───────────────────────────────────────────────
  try {
    const prs = await window.Api.get('/garmin/personal-records');
    const visible = (prs || []).filter(p => p.valor != null).slice(0, 12);
    if (visible.length > 0) {
      setSection('Recordes pessoais (Garmin)');
      pdf.setFontSize(10);
      for (const p of visible) {
        if (y > H - 40) { pdf.addPage(); y = PAD; }
        const label = `Recorde tipo ${p.type_id}`;
        const valor = p.valor != null ? p.valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—';
        pdf.setFont('helvetica', 'bold');
        pdf.text(label, PAD, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(valor, PAD + 200, y);
        if (p.activity_name) pdf.text(p.activity_name.slice(0, 40), PAD + 320, y);
        y += 13;
      }
    }
  } catch (e) { console.warn('[PDF] PRs', e); }

  // ─── SEÇÃO BIKE (Fase 13.1.5) ────────────────────────────────────────
  try {
    const bikes = await window.Api.get('/bikes');
    if (Array.isArray(bikes) && bikes.length > 0) {
      pdf.addPage(); y = PAD;
      setSection('Bicicletas');
      const cutoffMaint = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      for (const bike of bikes) {
        if (y > H - 120) { pdf.addPage(); y = PAD; }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.text(bike.nome || 'Bike', PAD, y); y += 14;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        if (bike.tipo) { pdf.text(`Tipo: ${bike.tipo}`, PAD, y); y += 12; }
        if (bike.kmAcumuladoTotal != null) {
          pdf.text(`Km acumulados: ${Number(bike.kmAcumuladoTotal).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`, PAD, y);
          y += 12;
        }

        // Componentes — tenta carregar do endpoint específico
        try {
          const detalhe = await window.Api.get(`/bikes/${encodeURIComponent(bike.id)}`);
          const comps = detalhe?.componentes || detalhe?.components || [];
          if (Array.isArray(comps) && comps.length > 0) {
            y += 4;
            pdf.setFont('helvetica', 'bold');
            pdf.text('Componentes', PAD, y); y += 13;
            pdf.setFont('helvetica', 'normal');
            for (const c of comps) {
              if (y > H - 40) { pdf.addPage(); y = PAD; }
              const km = c.kmAtual != null ? Math.round(c.kmAtual) : 0;
              const max = c.vidaUtilKm != null ? c.vidaUtilKm : null;
              const pct = max ? Math.min(100, Math.round((km / max) * 100)) : null;
              const nome = (c.nome || c.tipo || 'Componente').slice(0, 30);
              pdf.text(nome, PAD, y);
              pdf.text(`${km} km${max ? ' / ' + max + ' km' : ''}`, PAD + 200, y);
              if (pct != null) {
                // Barra de uso
                const barX = PAD + 340;
                const barW = 140;
                pdf.setDrawColor(180); pdf.setFillColor(230);
                pdf.rect(barX, y - 8, barW, 8, 'FD');
                if (pct >= 100)      pdf.setFillColor(220, 60, 60);
                else if (pct >= 80)  pdf.setFillColor(230, 160, 50);
                else                 pdf.setFillColor(20, 217, 184);
                pdf.rect(barX, y - 8, Math.max(1, barW * pct / 100), 8, 'F');
                pdf.setTextColor(40);
                pdf.text(`${pct}%`, barX + barW + 8, y);
              }
              y += 14;
            }
          }

          const logs = detalhe?.manutencoes || detalhe?.maintenance || [];
          const ultimos = (Array.isArray(logs) ? logs : []).filter(m => (m.data || '') >= cutoffMaint).slice(0, 10);
          if (ultimos.length) {
            y += 4;
            pdf.setFont('helvetica', 'bold');
            pdf.text('Manutenções (últimos 12 meses)', PAD, y); y += 13;
            pdf.setFont('helvetica', 'normal');
            for (const m of ultimos) {
              if (y > H - 40) { pdf.addPage(); y = PAD; }
              pdf.text(m.data || '—', PAD, y);
              pdf.text((m.descricao || m.tipo || '').slice(0, 60), PAD + 90, y);
              y += 12;
            }
          }
        } catch (e) { console.warn('[PDF] bike detalhe', bike.id, e); }
        y += 10;
      }
    }
  } catch (e) { console.warn('[PDF] bikes', e); }

  // ─── RODAPÉ ──────────────────────────────────────────────────────────
  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text(`Treino Bike · ${todayLong}`, PAD, H - 20);
    pdf.text(`Página ${i} de ${total}`, W - PAD - 60, H - 20);
  }

  const suffix = daysWindow ? `-${daysWindow}d` : '-tudo';
  pdf.save(`treino-bike-relatorio${suffix}-${new Date().toISOString().slice(0, 10)}.pdf`);
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
      if (!parsed.user && !parsed.modes && !parsed.workouts) {
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
  }
  if (p.modes !== undefined) {
    if (!Array.isArray(p.modes)) throw new Error('modes deve ser array');
    if (p.modes.length > 50) throw new Error('modes: número excessivo de registros');
    p.modes.forEach((m, i) => {
      if (!m.id || !m.nome) throw new Error(`modes[${i}]: id ou nome ausente`);
    });
  }
  if (p.workouts !== undefined) {
    if (typeof p.workouts !== 'object' || Array.isArray(p.workouts)) throw new Error('workouts deve ser objeto');
    Object.values(p.workouts).forEach((list, i) => {
      if (!Array.isArray(list)) throw new Error(`workouts[${i}]: valor deve ser array`);
    });
  }
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

function exportWeightsCSV() {
  try {
    const weights = Storage.getWeights().sort((a, b) => a.data.localeCompare(b.data));
    if (!weights.length) { toast('Nenhuma pesagem registrada', { kind: 'error' }); return; }
    const header = 'data,peso_kg,tipo,fonte\n';
    const rows = weights.map(w =>
      `${w.data},${w.peso},${w.tipo || 'atual'},${w.fonte || 'manual'}`
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
