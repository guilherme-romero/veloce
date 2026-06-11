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
