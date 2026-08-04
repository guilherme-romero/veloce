/* ═══════════════════════════════════════════════════════════════════════
   UTILS — funções auxiliares compartilhadas entre todos os módulos
═══════════════════════════════════════════════════════════════════════ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function escAttr(s) { return esc(s); }

window.esc     = esc;
window.escAttr = escAttr;

/* ── Avatar: foto remota com fallback automatico para iniciais ────────────
   Uso: Avatar.html({ src, name, size }) -> string HTML
   - src    : URL da imagem (opcional)
   - name   : texto p/ extrair iniciais (ex.: "Guilherme Romero")
   - size   : 'sm' | 'md' | 'lg' (default 'md')
   Se a imagem falhar (CSP, 403, sem URL), exibe iniciais sobre fundo neutro.
═════════════════════════════════════════════════════════════════════════ */
function _avatarInitials(name) {
  const txt = String(name || '').trim();
  if (!txt) return '?';
  const parts = txt.split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase().replace(/[^A-Z0-9]/g, '') || txt[0].toUpperCase();
}

function avatarHTML({ src, name, size = 'md', alt = '' } = {}) {
  const initials = _avatarInitials(name);
  const cls = `avatar avatar-${size}`;
  const fallback = `<div class="${cls} avatar-fallback">${esc(initials)}</div>`;
  if (!src) return fallback;
  // Para embutir HTML em onerror="..." precisamos:
  //  - escapar aspas duplas internas como &quot; (senao fecham o atributo)
  //  - escapar aspas simples como \\' (porque o JS esta entre aspas simples)
  const safeFallback = fallback
    .replace(/"/g, '&quot;')
    .replace(/'/g, "\\'");
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" referrerpolicy="no-referrer" onerror="this.outerHTML='${safeFallback}'">`;
}

window.Avatar = { html: avatarHTML, initials: _avatarInitials };

/* ── Zonas de FC — fonte única de verdade ──────────────────────────────
   Espelha as cores das classes CSS .z1–.z6 em Fisiologia.
   Usado em qualquer gráfico ou UI que precise colorir por zona.
   Limites: percentuais da FCM (Karvonen simplificado).
═════════════════════════════════════════════════════════════════════════ */
window.FC_ZONES = [
  { id: 'z1', label: 'Z1', min: 0,    max: 0.60, color: '#4e9ef5', colorDim: 'rgba(78,158,245,0.25)',  desc: 'Recuperação Ativa' },
  { id: 'z2', label: 'Z2', min: 0.60, max: 0.70, color: '#f5d523', colorDim: 'rgba(245,213,35,0.25)',  desc: 'Base Aeróbica' },
  { id: 'z3', label: 'Z3', min: 0.70, max: 0.80, color: '#22c55e', colorDim: 'rgba(34,197,94,0.25)',   desc: 'Ritmo / Tempo' },
  { id: 'z4', label: 'Z4', min: 0.80, max: 0.90, color: '#f0523a', colorDim: 'rgba(240,82,58,0.25)',   desc: 'Limiar Anaeróbico' },
  { id: 'z5', label: 'Z5', min: 0.90, max: 1.00, color: '#a855f7', colorDim: 'rgba(168,85,247,0.25)',  desc: 'VO2 Máx' },
  { id: 'z6', label: 'Z6', min: 1.00, max: Infinity, color: '#ec4899', colorDim: 'rgba(236,72,153,0.25)', desc: 'Neuromuscular' },
];

/* ── Streak de treino — fonte única (home.js × heatmap.js) ──────────────
   Recebe lista de datas ISO (YYYY-MM-DD) de dias com treino. Uma semana
   "vale" com ≥ 2 dias DISTINTOS ativos; retorna { current, record } em nº
   de semanas consecutivas (domingo = início da semana). A semana atual em
   andamento não quebra a sequência enquanto ainda não qualifica.
═════════════════════════════════════════════════════════════════════════ */
function calcTrainingStreak(activeISODates) {
  const MIN_DIAS = 2;
  const _wkStart = (iso) => {
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() - d.getDay()); // getDay(): 0=dom
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const _prevWk = (wk) => {
    const d = new Date(wk + 'T12:00:00'); d.setDate(d.getDate() - 7);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };

  const semanas = {}; // weekISO -> Set de datas ativas distintas
  (activeISODates || []).forEach(iso => {
    if (!iso) return;
    const wk = _wkStart(iso);
    if (wk) (semanas[wk] || (semanas[wk] = new Set())).add(iso);
  });
  const qualifica = (wk) => (semanas[wk] ? semanas[wk].size : 0) >= MIN_DIAS;

  // RECORDE — maior nº de semanas consecutivas qualificadas no histórico.
  const wks = Object.keys(semanas).filter(qualifica).sort();
  let record = 0, run = 0, prev = null;
  for (const wk of wks) {
    run = (prev && _prevWk(wk) === prev) ? run + 1 : 1;
    record = Math.max(record, run);
    prev = wk;
  }

  // ATUAL — conta para trás a partir da semana corrente (local). Se ainda
  // não qualifica, começa pela anterior (não quebra a sequência em curso).
  const now = new Date();
  const todayISO = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  let cursor = _wkStart(todayISO);
  if (!qualifica(cursor)) cursor = _prevWk(cursor);
  let current = 0;
  while (qualifica(cursor)) { current++; cursor = _prevWk(cursor); }

  return { current, record };
}
// Ícones Font Awesome por código WMO (Open-Meteo) — compartilhado por Passeios
// (rides.js) e Rotas (routes.js). Fallback: parcialmente nublado.
const WMO_ICONS = {
  0:'fa-sun', 1:'fa-sun', 2:'fa-cloud-sun', 3:'fa-cloud',
  45:'fa-smog', 48:'fa-smog',
  51:'fa-cloud-sun-rain', 53:'fa-cloud-sun-rain', 55:'fa-cloud-sun-rain',
  61:'fa-cloud-rain', 63:'fa-cloud-rain', 65:'fa-cloud-showers-heavy',
  71:'fa-snowflake', 73:'fa-snowflake', 75:'fa-snowflake',
  80:'fa-cloud-rain', 81:'fa-cloud-rain', 82:'fa-cloud-showers-heavy',
  95:'fa-cloud-bolt', 96:'fa-cloud-bolt', 99:'fa-cloud-bolt',
};
function wmoIcon(code) { return WMO_ICONS[code] || 'fa-cloud-sun'; }

// Estimativa de tempo de pedal (min): tempo no plano + penalidade de subida.
// Compartilhado por Ferramentas (ferramentas.js) e Passeios (rides.js).
// speed em km/h, elev em metros de ganho, wind em km/h (+ a favor), profile
// multiplica a eficiência na subida, stops = parada fixa (min).
function estimateRideTimeMin({ dist, speed, elev = 0, wind = 0, profile = 1.0, stops = 0 }) {
  const adjSpeed    = Math.max((speed || 0) + wind, 10);
  const elevEquivKm = (elev || 0) / 100;
  const climbPenMin = Math.round((elevEquivKm / adjSpeed * 60) / (profile || 1.0));
  const flatTimeMin = ((dist || 0) / adjSpeed) * 60;
  const movTimeMin  = flatTimeMin + climbPenMin;
  return { flatTimeMin, climbPenMin, movTimeMin, totalTimeMin: movTimeMin + stops };
}

window.Utils = Object.assign(window.Utils || {}, { calcTrainingStreak, wmoIcon, estimateRideTimeMin });
