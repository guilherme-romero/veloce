/* ═══════════════════════════════════════════════════════════════════════
   PROFILE — cálculos derivados + renderização do ID Card, goal metrics e zonas
═══════════════════════════════════════════════════════════════════════ */

/* ── Pure helpers ───────────────────────────────────────────────────── */
function calcAge(isoBirth) {
  if (!isoBirth) return 0;
  const parts = isoBirth.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 0;
  const [y, m, d] = parts;
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age > 0 ? age : 0;
}

function calcBMI(pesoKg, alturaCm) {
  if (!pesoKg || !alturaCm) return 0;
  const m = alturaCm / 100;
  return +(pesoKg / (m * m)).toFixed(1);
}

function bmiInfo(imc) {
  if (!imc)      return { label: '—',                color: 'var(--muted)' };
  if (imc < 18.5) return { label: 'Abaixo do peso', color: 'var(--blue)' };
  if (imc < 25)   return { label: 'Peso normal',    color: 'var(--lime)' };
  if (imc < 30)   return { label: 'Sobrepeso',      color: 'var(--amber)' };
  return            { label: 'Obesidade',           color: 'var(--magenta)' };
}

function calcFCMax(age) {
  return age > 0 ? 220 - age : 0;
}

/* Zonas: Z1=<60% · Z2=60-70% · Z3=70-80% · Z4=80-90% · Z5=90-100% · Z6=neuromuscular (>FCM curto) */
function calcZones(fcm) {
  if (!fcm) return null;
  const z1max = Math.round(fcm * 0.60);
  const z2max = Math.round(fcm * 0.70);
  const z3max = Math.round(fcm * 0.80);
  const z4max = Math.round(fcm * 0.90);
  return {
    z1: { max: z1max },
    z2: { min: z1max + 1, max: z2max },
    z3: { min: z2max + 1, max: z3max },
    z4: { min: z3max + 1, max: z4max },
    z5: { min: z4max + 1, max: fcm },
    z6: { min: fcm, max: Infinity, label: 'Sprint (FCM máx)' },
  };
}

/* ── Render: ID Card + Goal metrics + intro + zonas ─────────────────── */
function renderProfile(user) {
  const idade   = calcAge(user.dataNascimento);
  const imc     = calcBMI(user.pesoAtual, user.altura);
  const imcMeta = calcBMI(user.pesoMeta,  user.altura);
  const fcm     = calcFCMax(idade);
  const perda   = +(((user.pesoAtual || 0) - (user.pesoMeta || 0)).toFixed(1));
  const info    = bmiInfo(imc);

  // ── ID Card ───────────────────────────────
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl && window.Avatar) {
    if (user.nome) {
      const src = user.hasAvatar
        ? '/api/user/avatar?ts=' + encodeURIComponent(user.avatarUpdatedAt || '')
        : null;
      avatarEl.innerHTML = window.Avatar.html({ name: user.nome, src, size: 'lg' });
    } else {
      avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
    }
  }
  setText('stat-nome',   user.nome || '—');
  setHTML('stat-idade',  idade ? `${idade}` : '—');
  setHTML('stat-altura', user.altura ? `${user.altura}` : '—');
  setHTML('stat-peso',
    user.pesoAtual
      ? `${user.pesoAtual.toFixed(1).replace('.', ',')}<span class="unit">kg</span>`
      : '—');
  setHTML('stat-imc',
    imc
      ? `<span style="color:${info.color}">${imc.toString().replace('.', ',')}</span> <span class="unit">${info.label}</span>`
      : '—');
  setHTML('stat-bike',
    user.bikeModelo
      ? `${escHTML(user.bikeModelo)} · ${(user.bikePeso || 0).toFixed(1).replace('.', ',')} <span class="unit">kg</span>`
      : '—');

  // ── Goal metrics ──────────────────────────
  setHTML('stat-meta', user.pesoMeta
    ? `${Math.round(user.pesoMeta)}<span class="unit" style="font-size:14px">kg</span>` : '—');
  setHTML('stat-perda', perda > 0
    ? `−${perda.toString().replace('.', ',')}<span class="unit" style="font-size:14px">kg</span>`
    : (perda < 0
      ? `+${Math.abs(perda).toString().replace('.', ',')}<span class="unit" style="font-size:14px">kg</span>`
      : '—'));
  // Ainda ter peso a perder (valor exibido com "−") é negativo → magenta; já na meta → lime.
  const perdaEl = document.getElementById('stat-perda');
  if (perdaEl) perdaEl.style.color = perda > 0 ? 'var(--magenta)' : 'var(--lime)';
  setHTML('stat-imc-meta',
    imcMeta
      ? `${imcMeta.toString().replace('.', ',')}<span class="unit" style="font-size:14px;color:var(--muted)"> ${bmiInfo(imcMeta).label}</span>`
      : '—');

  // ── Tip box ───────────────────────────────
  if (perda > 0 && user.bikePeso) {
    const sistemaAtual = (user.pesoAtual + user.bikePeso).toFixed(1);
    const sistemaMeta  = (user.pesoMeta  + user.bikePeso).toFixed(1);
    setHTML('goal-tip',
      `<i class="fa-solid fa-circle-info"></i> Perder <strong>${perda.toString().replace('.', ',')} kg</strong> melhora drasticamente a subida. Sistema atual: <strong>${sistemaAtual.replace('.', ',')} kg</strong> → meta <strong>${sistemaMeta.replace('.', ',')} kg</strong>.`);
  } else if (perda < 0) {
    setHTML('goal-tip',
      `<i class="fa-solid fa-circle-info"></i> Sua meta é <strong>ganhar peso</strong>. Foque em treinos de força e nutrição calórica positiva.`);
  } else {
    setHTML('goal-tip',
      `<i class="fa-solid fa-circle-info"></i> Configure suas metas no botão de edição do perfil.`);
  }

  // ── Intro ─────────────────────────────────
  if (user.nome && user.pesoAtual && user.altura) {
    setText('profile-intro',
      `Análise do perfil de ${user.nome}. Com ${user.pesoAtual.toFixed(1).replace('.', ',')}kg e ${user.altura}cm (IMC ${imc.toString().replace('.', ',')} – ${info.label}), o foco é otimizar a relação peso/potência para longos percursos.`);
  } else {
    setText('profile-intro',
      'Configure seus dados no botão de edição do perfil para começar.');
  }

  // ── FC máxima + Zonas FC ──────────────────
  // Render inicial com a FCM estimada (220 − idade); em seguida tenta refinar
  // com o pico real observado no Garmin (assíncrono, não bloqueia).
  updateFcmZones(fcm, idade, user.nome, false);
  refineFcMaxFromGarmin(idade, user.nome);
}

/* ── FC máxima + zonas (reutilizável p/ fórmula ou pico Garmin) ──────── */
function updateFcmZones(fcm, idade, nome, fromGarmin) {
  setHTML('stat-fcm', fcm ? `${fcm}<span class="unit">bpm</span>` : '—');

  const zones = calcZones(fcm);
  if (zones) {
    setText('zone1-range', `< ${zones.z1.max} BPM`);
    setText('zone2-range', `${zones.z2.min} – ${zones.z2.max} BPM`);
    setText('zone3-range', `${zones.z3.min} – ${zones.z3.max} BPM`);
    setText('zone4-range', `${zones.z4.min} – ${zones.z4.max} BPM`);
    setText('zone5-range', `${zones.z5.min} – ${zones.z5.max} BPM`);
    const z6El = document.getElementById('zone6-range');
    if (z6El) z6El.textContent = `> ${zones.z6.min} BPM (Sprint)`;

    const origem = fromGarmin
      ? `FC máx <strong>${fcm} bpm</strong> (pico observado no <strong>Garmin</strong>)`
      : `FCM estimada <strong>${fcm} bpm</strong> (220 − idade)`;
    if (nome) {
      setHTML('zones-subtitle', `Calculado para <strong>${escHTML(nome)}</strong>, ${idade} anos · ${origem}.`);
    } else {
      setHTML('zones-subtitle', `${origem}.`);
    }
  } else {
    ['zone1-range', 'zone2-range', 'zone3-range', 'zone4-range', 'zone5-range', 'zone6-range']
      .forEach(id => setText(id, '—'));
    setText('zones-subtitle', 'Cadastre sua data de nascimento para calcular as zonas.');
  }
}

/* ── Refina a FC máxima a partir do maior fc_max observado no Garmin ─── */
async function refineFcMaxFromGarmin(idade, nome) {
  if (!window.Api) return;
  try {
    const resp = await window.Api.get('/activities/unified?days=365');
    const items = (resp && resp.items) || [];
    let maxObs = 0;
    items.forEach(a => {
      if (isFinite(a.fcMax) && a.fcMax > maxObs) maxObs = a.fcMax;
    });
    // Usa o pico observado apenas se for plausível (descarta zeros/ruído).
    // Faixa plausível: descarta zeros/ruído (piso 120) e artefatos de sensor (teto 230).
    if (maxObs >= 120 && maxObs <= 230) updateFcmZones(Math.round(maxObs), idade, nome, true);
  } catch (_) { /* mantém a FCM estimada já renderizada */ }
}

/* ── DOM helpers ─────────────────────────────────────────────────────── */
function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function escHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function escAttr(s) {
  return escHTML(s);
}

/* expor */
window.Profile = {
  render: renderProfile,
  calcAge,
  calcBMI,
  bmiInfo,
  calcFCMax,
  calcZones,
};
