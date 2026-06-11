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
  { id: 'z1', label: 'Z1', min: 0,    max: 0.60, color: '#6b7280', colorDim: 'rgba(107,114,128,0.25)', desc: 'Recuperação Ativa' },
  { id: 'z2', label: 'Z2', min: 0.60, max: 0.70, color: '#4e9ef5', colorDim: 'rgba(78,158,245,0.25)',  desc: 'Base Aeróbica' },
  { id: 'z3', label: 'Z3', min: 0.70, max: 0.80, color: '#22c55e', colorDim: 'rgba(34,197,94,0.25)',   desc: 'Ritmo / Tempo' },
  { id: 'z4', label: 'Z4', min: 0.80, max: 0.90, color: '#f5a523', colorDim: 'rgba(245,165,35,0.25)',  desc: 'Limiar Anaeróbico' },
  { id: 'z5', label: 'Z5', min: 0.90, max: 1.00, color: '#f0523a', colorDim: 'rgba(240,82,58,0.25)',   desc: 'VO2 Máx' },
  { id: 'z6', label: 'Z6', min: 1.00, max: Infinity, color: '#a855f7', colorDim: 'rgba(168,85,247,0.25)', desc: 'Neuromuscular' },
];
