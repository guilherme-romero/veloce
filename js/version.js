/* ═══════════════════════════════════════════════════════════════════════
   VERSION — única fonte da verdade para versionamento.
   Ao publicar atualização: incrementar APP_VERSION.
   - O service-worker.js usa para invalidar cache offline.
   - Os imports do index.html usam ?v= para cache busting.
═══════════════════════════════════════════════════════════════════════ */
window.APP_VERSION = '1.7.0-alpha';
