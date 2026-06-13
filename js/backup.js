/* ═══════════════════════════════════════════════════════════════════════
   BACKUP — exportar / importar todos os dados como JSON
═══════════════════════════════════════════════════════════════════════ */

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
      <div class="field-label" style="margin-bottom:8px;">Relatórios</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-primary" type="button" data-export-pdf>
          <i class="fa-solid fa-file-pdf"></i> Relatório completo (.pdf)
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
      modal.querySelector('[data-export-pdf]').onclick = exportRelatorioPDF;
      modal.querySelector('[data-export-zip]').onclick = exportDataZip;
      modal.querySelector('[data-print]').onclick = () => { Modals.close(); setTimeout(() => window.print(), 300); };
    },
  });
}

// ── Download da base de dados completa em ZIP ────────────────────────────
async function exportDataZip() {
  toast('Preparando ZIP da base de dados…');
  try {
    // Fetch com credentials para enviar cookie de auth; precisamos do Blob
    // para forçar o save com o filename certo (do Content-Disposition).
    const resp = await fetch('/api/backup/data-zip', { credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Extrai o filename do Content-Disposition se disponível
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
async function exportRelatorioPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('Biblioteca PDF não carregada. Recarregue a página.', { kind: 'error' });
    return;
  }
  toast('Gerando relatório PDF…');
  try {
    await buildRelatorioPDF();
    toast('Relatório PDF gerado');
  } catch (err) {
    console.error('[Backup] PDF', err);
    toast('Falha ao gerar PDF: ' + (err.message || err), { kind: 'error' });
  }
}

async function buildRelatorioPDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' }); // 595 × 842 pt
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

  // Helpers
  const setTitle = (text, size = 16) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(size);
    pdf.setTextColor(20, 217, 184); // teal
    pdf.text(text, PAD, y);
    y += size + 8;
    pdf.setTextColor(40);
  };
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
  if (versao) { pdf.text(`Versão do app: ${versao}`, PAD, y); y += 24; }

  // ─── PERFIL RESUMIDO ─────────────────────────────────────────────────
  setSection('Perfil');
  const weights = Storage.getWeights ? Storage.getWeights() : [];
  const lastWeight = weights.length ? weights[weights.length - 1] : null;
  const altura = u.altura || 0;
  const imc = (lastWeight && altura) ? (lastWeight.peso / Math.pow(altura / 100, 2)).toFixed(1) : '—';
  writeLine('Peso atual:',     lastWeight ? `${lastWeight.peso.toFixed(1)} kg` : '—');
  writeLine('Meta de peso:',   u.pesoMeta ? `${u.pesoMeta} kg` : '—');
  writeLine('Altura:',         altura ? `${altura} cm` : '—');
  writeLine('IMC:',            imc);
  writeLine('Total de pesagens:', weights.length);
  writeLine('Total de passeios:', (Storage.getRides ? Storage.getRides().length : 0));

  // ─── GRÁFICO DE PESO (captura canvas) ────────────────────────────────
  const weightCanvas = document.getElementById('weight-chart');
  if (weightCanvas && weightCanvas.width > 0 && weights.length > 0) {
    setSection('Evolução de peso');
    try {
      const imgData = weightCanvas.toDataURL('image/png');
      const ratio = weightCanvas.height / weightCanvas.width;
      const imgW = W - 2 * PAD;
      const imgH = imgW * ratio;
      ensureSpace(imgH + 8);
      pdf.addImage(imgData, 'PNG', PAD, y, imgW, imgH);
      y += imgH + 8;
    } catch (e) {
      pdf.setFontSize(10);
      pdf.text('Gráfico não disponível.', PAD, y); y += 14;
    }
  }

  // ─── ÚLTIMAS PESAGENS (tabela) ───────────────────────────────────────
  if (weights.length > 0) {
    setSection('Últimas pesagens');
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

  // ─── ATIVIDADES RECENTES ─────────────────────────────────────────────
  try {
    const acts = await window.Api.get('/activities/unified?days=90');
    const items = (acts?.items || acts || []).slice(0, 20);
    if (items.length > 0) {
      setSection('Histórico de atividades (90 dias)');
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

  // ─── RODAPÉ EM CADA PÁGINA ───────────────────────────────────────────
  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text(`Treino Bike · ${todayLong}`, PAD, H - 20);
    pdf.text(`Página ${i} de ${total}`, W - PAD - 60, H - 20);
  }

  pdf.save(`treino-bike-relatorio-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function exportData() {
  try {
    const json = Storage.exportJSON();
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

      // Validação estrutural profunda
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
