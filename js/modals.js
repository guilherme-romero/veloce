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
          ${tag ? `<span class="modal-tag">${esc(tag)}</span>` : ''}
          <h3 class="modal-title">${esc(title)}</h3>
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
          }" data-action="${i}">${esc(a.label)}</button>
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

/**
 * Confirmação via modal (substitui window.confirm). Retorna Promise<boolean>.
 * @param {Object}  opts
 * @param {string}  opts.title          — título da pergunta
 * @param {string}  [opts.message]      — texto de apoio
 * @param {string}  [opts.confirmLabel] — rótulo do botão de confirmar
 * @param {string}  [opts.cancelLabel]  — rótulo do botão de cancelar
 * @param {boolean} [opts.danger]       — estiliza o botão de confirmar como destrutivo
 */
function confirmModal({ title, message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; resolve(val); };
    openModal({
      tag: 'Confirmar',
      title,
      bodyHTML: message ? `<p class="modal-confirm-text">${esc(message)}</p>` : '',
      actions: [
        { label: cancelLabel,  kind: 'ghost', onClick: () => { closeModal(); finish(false); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => { closeModal(); finish(true); } },
      ],
      onMount: (el) => {
        // Fechar pelo X/ESC/backdrop = cancelar (resolve false uma única vez).
        const obs = new MutationObserver(() => {
          if (!document.body.contains(el)) { obs.disconnect(); finish(false); }
        });
        obs.observe(document.body, { childList: true });
      },
    });
  });
}

/**
 * Prompt via modal (substitui window.prompt). Retorna Promise<string|null>
 * (null = cancelado/fechado). Valida em `validate(valor) -> string|null`
 * (mensagem de erro ou null se ok).
 * @param {Object}   opts
 * @param {string}   opts.title
 * @param {string}   [opts.tag]
 * @param {string}   [opts.message]
 * @param {string}   [opts.placeholder]
 * @param {string}   [opts.confirmLabel]
 * @param {string}   [opts.cancelLabel]
 * @param {string}   [opts.inputMode]     — ex.: 'numeric'
 * @param {number}   [opts.maxlength]
 * @param {Function} [opts.validate]      — (valor) => string|null
 */
function promptModal({ title, tag = 'Código', message = '', placeholder = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', inputMode = '', maxlength = null, validate = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; resolve(val); };

    const submit = (el) => {
      const inp = el.querySelector('#__prompt_input');
      const errEl = el.querySelector('#__prompt_err');
      const val = (inp && inp.value || '').trim();
      const msg = validate ? validate(val) : (val ? null : 'Campo obrigatório');
      if (msg) { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } if (inp) inp.focus(); return; }
      closeModal(); finish(val);
    };

    openModal({
      tag, title,
      bodyHTML:
        `${message ? `<p class="modal-confirm-text">${esc(message)}</p>` : ''}` +
        `<input type="text" id="__prompt_input" class="field-input"` +
        `${inputMode ? ` inputmode="${escAttr(inputMode)}"` : ''}` +
        `${placeholder ? ` placeholder="${escAttr(placeholder)}"` : ''}` +
        `${maxlength ? ` maxlength="${maxlength}"` : ''} autocomplete="one-time-code" />` +
        `<p class="modal-confirm-text" id="__prompt_err" hidden style="color:var(--red)"></p>`,
      actions: [
        { label: cancelLabel,  kind: 'ghost',   onClick: () => { closeModal(); finish(null); } },
        { label: confirmLabel, kind: 'primary', onClick: (el) => submit(el) },
      ],
      onMount: (el) => {
        const inp = el.querySelector('#__prompt_input');
        if (inp) {
          inp.focus();
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(el); } });
        }
        // Fechar pelo X/ESC/backdrop = cancelar (resolve null uma única vez).
        const obs = new MutationObserver(() => {
          if (!document.body.contains(el)) { obs.disconnect(); finish(null); }
        });
        obs.observe(document.body, { childList: true });
      },
    });
  });
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
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(message)}</span>`;
  stack.appendChild(el);

  setTimeout(() => {
    el.classList.add('fading');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

/* expor */
window.Modals = { open: openModal, close: closeModal, confirm: confirmModal, prompt: promptModal };
window.toast  = toast;
