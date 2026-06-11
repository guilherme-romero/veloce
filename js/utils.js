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
