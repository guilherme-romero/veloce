/* ═══════════════════════════════════════════════════════════════════════
   MODALS — sistema genérico para edição de perfil, pesagem, passeios
═══════════════════════════════════════════════════════════════════════ */

let activeModal = null;

/**
 * Abre um modal.
 * @param {Object}   opts
 * @param {string}   opts.tag        — pequena tag acima do título (ex: "Perfil")
 * @param {string}   opts.title      — título principal
 * @param {string}   opts.bodyHTML   — markup interno (campos)
 * @param {Object[]} opts.actions    — [ { label, kind: 'primary'|'ghost'|'danger', onClick: (modalEl)=>void } ]
 * @param {Function} [opts.onMount]  — chamado após inserir no DOM (ex: focar campo)
 */
function openModal({ tag, title, bodyHTML, actions = [], onMount }) {
  closeModal(); // garante que só haja um por vez

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="modal-head-text">
          ${tag ? `<span class="modal-tag">${tag}</span>` : ''}
          <h3 class="modal-title">${title}</h3>
        </div>
        <button class="close-btn" data-close type="button" aria-label="Fechar">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-foot">
        ${actions.map((a, i) => `
          <button type="button" class="btn ${
            a.kind === 'primary' ? 'btn-primary'
            : a.kind === 'danger' ? 'btn-danger'
            : 'btn-ghost'
          }" data-action="${i}">${a.label}</button>
        `).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  activeModal = backdrop;
  document.body.style.overflow = 'hidden';

  // Fechar ao clicar no backdrop, X ou ESC
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', closeModal);
  document.addEventListener('keydown', escListener);

  // Wire das ações
  actions.forEach((a, i) => {
    backdrop.querySelector(`[data-action="${i}"]`).addEventListener('click', () => {
      a.onClick(backdrop);
    });
  });

  if (onMount) onMount(backdrop);
}

function closeModal() {
  if (!activeModal) return;
  document.removeEventListener('keydown', escListener);
  activeModal.remove();
  activeModal = null;
  document.body.style.overflow = '';
}

function escListener(e) {
  if (e.key === 'Escape') closeModal();
}

/* ═══════════════════════════════════════════════════════════════════════
   TOAST — feedback rápido
═══════════════════════════════════════════════════════════════════════ */
function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function toast(message, { kind = 'success', duration = 2400 } = {}) {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'toast-error' : ''}`;
  const icon = kind === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  stack.appendChild(el);

  setTimeout(() => {
    el.classList.add('fading');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

/* expor */
window.Modals = { open: openModal, close: closeModal };
window.toast  = toast;
