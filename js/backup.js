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

        <button class="btn btn-danger" type="button" data-reset style="margin-top:8px;">
          <i class="fa-solid fa-triangle-exclamation"></i> Apagar todos os dados
        </button>
      </div>

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
    },
  });
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
  reader.onload = (e) => {
    try {
      const json = e.target.result;
      const parsed = JSON.parse(json);

      // Validação estrutural profunda
      if (!parsed.user && !parsed.modes && !parsed.workouts) {
        throw new Error('Estrutura inválida: sem dados reconhecidos');
      }
      validateBackupStructure(parsed);

      Storage.importJSON(json);
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

window.Backup = { open: openBackupModal };
