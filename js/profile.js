/* ═══════════════════════════════════════════════════════════════════════
   PROFILE — cálculos derivados + renderização do ID Card, goal metrics e zonas
═══════════════════════════════════════════════════════════════════════ */

/* ── Pure helpers ───────────────────────────────────────────────────── */
function calcAge(isoBirth) {
  if (!isoBirth) return 0;
  const [y, m, d] = isoBirth.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

function calcBMI(pesoKg, alturaCm) {
  if (!pesoKg || !alturaCm) return 0;
  const m = alturaCm / 100;
  return +(pesoKg / (m * m)).toFixed(1);
}

function bmiInfo(imc) {
  if (imc < 18.5) return { label: 'Abaixo do peso', color: 'var(--blue)' };
  if (imc < 25)   return { label: 'Peso normal',    color: 'var(--green)' };
  if (imc < 30)   return { label: 'Sobrepeso',      color: 'var(--amber)' };
  return            { label: 'Obesidade',           color: 'var(--red)' };
}

function calcFCMax(age) {
  return age > 0 ? 220 - age : 0;
}

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
  };
}

/* ── Render: ID Card + Goal metrics + intro + zonas ─────────────────── */
function renderProfile(user) {
  const idade   = calcAge(user.dataNascimento);
  const imc     = calcBMI(user.pesoAtual, user.altura);
  const imcMeta = calcBMI(user.pesoMeta,  user.altura);
  const fcm     = calcFCMax(idade);
  const perda   = +(user.pesoAtual - user.pesoMeta).toFixed(1);
  const info    = bmiInfo(imc);

  // ── ID Card ───────────────────────────────
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
  setHTML('stat-fcm',  fcm ? `${fcm}<span class="unit">bpm</span>` : '—');
  setHTML('stat-bike',
    user.bikeModelo
      ? `${user.bikeModelo} · ${(user.bikePeso || 0).toFixed(1).replace('.', ',')} <span class="unit">kg</span>`
      : '—');

  // ── Goal metrics ──────────────────────────
  setHTML('stat-meta', user.pesoMeta
    ? `${user.pesoMeta.toFixed(0)}<span class="unit" style="font-size:14px">kg</span>` : '—');
  setHTML('stat-perda', perda
    ? `−${perda.toString().replace('.', ',')}<span class="unit" style="font-size:14px">kg</span>` : '—');
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

  // ── Zonas FC ──────────────────────────────
  const zones = calcZones(fcm);
  if (zones) {
    setText('zone1-range', `< ${zones.z1.max} BPM`);
    setText('zone2-range', `${zones.z2.min} – ${zones.z2.max} BPM`);
    setText('zone3-range', `${zones.z3.min} – ${zones.z3.max} BPM`);
    setText('zone4-range', `${zones.z4.min} – ${zones.z4.max} BPM`);
    setText('zone5-range', `${zones.z5.min} – ${zones.z5.max} BPM`);
    if (user.nome) {
      setHTML('zones-subtitle',
        `Calculado para <strong>${user.nome}</strong>, ${idade} anos (FCM ~${fcm} bpm). Configure estas zonas no <strong>Garmin</strong>.`);
    } else {
      setText('zones-subtitle', `FCM estimada: ${fcm} bpm. Configure estas zonas no Garmin.`);
    }
  } else {
    ['zone1-range', 'zone2-range', 'zone3-range', 'zone4-range', 'zone5-range']
      .forEach(id => setText(id, '—'));
    setText('zones-subtitle', 'Cadastre sua data de nascimento para calcular as zonas.');
  }
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

/* expor */
window.Profile = {
  render: renderProfile,
  calcAge,
  calcBMI,
  bmiInfo,
  calcFCMax,
  calcZones,
};
