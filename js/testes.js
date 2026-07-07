/* ═══════════════════════════════════════════════════════════════════════
   TESTES (TEMPORÁRIO) — comparação provisória de zonas de FC.
   Método atual (FCM 220−idade + %FCM) × Tanaka (208−0,7×idade) + Karvonen
   (FC de reserva, usando FC de repouso do Garmin).
   ⚠️ Seção descartável: remover (e o módulo) depois da avaliação.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);
  let _chart = null;

  const COLORS = {
    hoje:  '#c6f135',
    novo:  '#7c5cff',
    muted: '#9299a8',
    grid:  '#252830',
    text:  '#c4ccd4',
  };

  // Zonas Z1–Z5 pelos limites de % (topo de cada zona).
  const PCTS = [0.60, 0.70, 0.80, 0.90, 1.00];
  const ZLABELS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  const ZFAIXA  = ['≤60%', '60–70%', '70–80%', '80–90%', '90–100%'];

  const round = (n) => Math.round(n);

  function renderCompare({ idade, fcmHoje, fcmTanaka, fcRep, fcRepFonte }) {
    // Topo de cada zona: hoje = %FCM; Karvonen = FCrep + %·(FCM_tanaka − FCrep).
    const topHoje = PCTS.map(p => round(fcmHoje * p));
    const topKarv = PCTS.map(p => round(fcRep + p * (fcmTanaka - fcRep)));

    // Tabela
    const rows = ZLABELS.map((z, i) => {
      const delta = topKarv[i] - topHoje[i];
      const sign  = delta > 0 ? '+' : (delta < 0 ? '−' : '');
      const dcls  = delta > 0 ? 'up' : (delta < 0 ? 'down' : '');
      return `<tr>
        <td><strong>${z}</strong></td>
        <td>${ZFAIXA[i]}</td>
        <td>${topHoje[i]}</td>
        <td>${topKarv[i]}</td>
        <td class="t-zones-delta ${dcls}">${sign}${Math.abs(delta)}</td>
      </tr>`;
    }).join('');

    const tbl = $('t-zones-table');
    if (tbl) {
      tbl.innerHTML = `
        <table class="t-zones-tbl">
          <thead><tr>
            <th>Zona</th><th>% FCM</th><th>Hoje</th><th>Tanaka/Karvonen</th><th>Δ bpm</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const note = $('t-zones-note');
    if (note) {
      note.innerHTML =
        `Idade ${idade} · FCM hoje <strong>${fcmHoje}</strong> (220−idade) · ` +
        `FCM Tanaka <strong>${fcmTanaka}</strong> (208−0,7×idade) · ` +
        `FC repouso <strong>${fcRep}</strong> bpm (${fcRepFonte}). ` +
        `Karvonen usa a FC de reserva (FCM−FCrep), por isso as zonas baixas sobem.`;
    }

    // Gráfico de barras agrupadas (topo por zona)
    const canvas = $('t-zones-chart');
    if (canvas && window.Chart) {
      if (_chart) { _chart.destroy(); _chart = null; }
      _chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: ZLABELS,
          datasets: [
            { label: 'Hoje (%FCM)',        data: topHoje, backgroundColor: COLORS.hoje },
            { label: 'Tanaka/Karvonen',    data: topKarv, backgroundColor: COLORS.novo },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: COLORS.text, boxWidth: 12, padding: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} bpm` } },
          },
          scales: {
            x: { ticks: { color: COLORS.muted }, grid: { display: false } },
            y: { ticks: { color: COLORS.muted, callback: v => v + ' bpm' }, grid: { color: COLORS.grid } },
          },
        },
      });
    }
  }

  async function load() {
    const empty = $('testes-empty');
    try {
      const user  = (window.Storage && Storage.getUser) ? Storage.getUser() : {};
      const idade = (window.Profile && Profile.calcAge) ? Profile.calcAge(user.dataNascimento) : 0;
      if (!idade) {
        if (empty) { empty.hidden = false; empty.textContent = 'Defina a data de nascimento no perfil para simular as zonas.'; }
        return;
      }
      const fcmHoje   = Profile.calcFCMax(idade);          // 220 − idade
      const fcmTanaka = Math.round(208 - 0.7 * idade);     // Tanaka

      // FC de repouso: campo mais recente do Garmin; fallback 60 bpm.
      let fcRep = 60, fcRepFonte = 'estimada (sem dado Garmin)';
      try {
        const health = await window.Api.get('/garmin/health?days=30').catch(() => []);
        const arr = Array.isArray(health) ? [...health].sort((a, b) => a.data.localeCompare(b.data)) : [];
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] && arr[i].fc_repouso != null) { fcRep = arr[i].fc_repouso; fcRepFonte = 'Garmin, ' + arr[i].data; break; }
        }
      } catch (_) {}

      if (empty) empty.hidden = true;
      renderCompare({ idade, fcmHoje, fcmTanaka, fcRep, fcRepFonte });
    } catch (err) {
      console.error('[testes]', err);
      if (empty) { empty.hidden = false; empty.textContent = 'Falha ao montar a comparação de zonas.'; }
    }
  }

  window.Testes = { load };
})();
