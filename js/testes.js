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
  // %FCM e %FCR usam faixas DIFERENTES: %FCR ≈ %FCM − 10 p.p. (Swain & Leutholtz
  // 1997) — aplicar os mesmos percentuais nas duas bases inflaria Karvonen (BUG-043).
  const PCTS_FCM = [0.60, 0.70, 0.80, 0.90, 1.00];
  const PCTS_FCR = [0.50, 0.60, 0.70, 0.80, 0.90];
  const ZLABELS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  const ZFAIXA     = ['≤60%', '60–70%', '70–80%', '80–90%', '90–100%'];
  const ZFAIXA_FCR = ['≤50%', '50–60%', '60–70%', '70–80%', '80–90%'];

  const round = (n) => Math.round(n);

  function renderCompare({ idade, fcmHoje, fcmFonte, fcmTanaka, fcRep, fcRepFonte, fcRepEstimada }) {
    // Topo de cada zona: hoje = %FCM; Karvonen = FCrep + %FCR·(FCM_tanaka − FCrep).
    const topHoje = PCTS_FCM.map(p => round(fcmHoje * p));
    const topKarv = PCTS_FCR.map(p => round(fcRep + p * (fcmTanaka - fcRep)));
    // Piso de cada zona = topo da zona anterior; Z1 exibida como "≤ topo".
    const band = (tops, i) => i === 0 ? `≤${tops[0]}` : `${tops[i - 1]}–${tops[i]}`;

    // Tabela — mostra a FAIXA (min–max bpm) de cada zona, não só o topo.
    const rows = ZLABELS.map((z, i) => {
      const delta = topKarv[i] - topHoje[i]; // Δ comparado no topo da zona
      const sign  = delta > 0 ? '+' : (delta < 0 ? '−' : '');
      const dcls  = delta > 0 ? 'up' : (delta < 0 ? 'down' : '');
      return `<tr>
        <td><strong>${z}</strong></td>
        <td>${ZFAIXA[i]} · ${ZFAIXA_FCR[i]} FCR</td>
        <td>${band(topHoje, i)}</td>
        <td>${band(topKarv, i)}</td>
        <td class="t-zones-delta ${dcls}">${sign}${Math.abs(delta)}</td>
      </tr>`;
    }).join('');

    const tbl = $('t-zones-table');
    if (tbl) {
      tbl.innerHTML = `
        <table class="t-zones-tbl">
          <thead><tr>
            <th>Zona</th><th>% FCM · % FCR</th><th>Hoje (bpm)</th><th>Tanaka/Karvonen (bpm)</th><th>Δ topo</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const note = $('t-zones-note');
    if (note) {
      const esc = window.esc || (s => String(s == null ? '' : s));
      // Destaca quando a FC de repouso é o fallback estimado (sem dado Garmin):
      // Karvonen depende dela, então o valor merece um aviso visível.
      const fcRepTxt = fcRepEstimada
        ? `<strong style="color:#f5d523">${esc(fcRepFonte)}</strong>`
        : esc(fcRepFonte);
      const avisoEst = fcRepEstimada
        ? ` <strong style="color:#f5d523">As zonas Karvonen são aproximadas</strong> — ` +
          `sincronize a FC de repouso no Garmin para valores reais.`
        : '';
      note.innerHTML =
        `Idade ${idade} · FCM hoje <strong>${fcmHoje}</strong> (${esc(fcmFonte)}) · ` +
        `FCM Tanaka <strong>${fcmTanaka}</strong> (208−0,7×idade) · ` +
        `FC repouso <strong>${fcRep}</strong> bpm (${fcRepTxt}). ` +
        `Karvonen usa a FC de reserva (FCM−FCrep) com faixas próprias de %FCR, ` +
        `~10 p.p. abaixo das de %FCM — zonas fisiologicamente equivalentes.` +
        avisoEst;
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
      // FCM "hoje" na MESMA precedência de insights.js:calcFCMax (BUG-042):
      // user.fcMax (override — hoje ainda não populado por formulário, mantido
      // por paridade) → pico observado no Garmin (120–230) → 220−idade.
      let fcmHoje = Number(user.fcMax) || 0;
      let fcmFonte = 'definida no perfil';
      if (!fcmHoje) {
        try {
          const resp = await window.Api.get('/activities/unified?days=365').catch(() => null);
          const items = (resp && resp.items) || [];
          let maxObs = 0;
          items.forEach(a => { if (isFinite(a.fcMax) && a.fcMax > maxObs) maxObs = a.fcMax; });
          if (maxObs >= 120 && maxObs <= 230) { fcmHoje = Math.round(maxObs); fcmFonte = 'pico observado no Garmin'; }
        } catch (_) {}
      }
      if (!fcmHoje) { fcmHoje = Profile.calcFCMax(idade); fcmFonte = '220−idade'; }
      const fcmTanaka = Math.round(208 - 0.7 * idade);     // Tanaka

      // FC de repouso: campo mais recente do Garmin; fallback 60 bpm.
      let fcRep = 60, fcRepFonte = 'estimada (sem dado Garmin)', fcRepEstimada = true;
      try {
        const health = await window.Api.get('/garmin/health?days=30').catch(() => []);
        const arr = Array.isArray(health) ? [...health].sort((a, b) => a.data.localeCompare(b.data)) : [];
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] && arr[i].fc_repouso != null) { fcRep = arr[i].fc_repouso; fcRepFonte = 'Garmin, ' + arr[i].data; fcRepEstimada = false; break; }
        }
      } catch (_) {}

      if (empty) empty.hidden = true;
      renderCompare({ idade, fcmHoje, fcmFonte, fcmTanaka, fcRep, fcRepFonte, fcRepEstimada });
    } catch (err) {
      console.error('[testes]', err);
      if (empty) { empty.hidden = false; empty.textContent = 'Falha ao montar a comparação de zonas.'; }
    }
  }

  window.Testes = { load };
})();
