/* ═══════════════════════════════════════════════════════════════════════
   CONFIGURAÇÕES (mobile) — settings editáveis do app no celular (#103).

   É a PRIMEIRA tela de escrita de perfil no mobile: o Perfil
   (profile-mobile.js) é só-leitura por design e o resto das preferências se
   edita no desktop. Hoje só o toggle do relatório mensal do Telegram; base
   para futuros settings. Grava via Storage.setUser — mesmo fluxo/PUT
   /api/profile do desktop (js/app.js), com whitelist no backend.

   Alcançada pela aba "Mais" (more-mobile.js). Slug mobile nativo, então o
   deep link #/configuracoes funciona e não cai no FALLBACK "só no desktop".
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const VIEW_ID = 'm-view-configuracoes';

  function render() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;
    const u = Storage.getUser();

    view.innerHTML = `
      <div class="m-card">
        <span class="m-eyebrow">Relatório mensal</span>
        <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;margin-top:10px">
          <input type="checkbox" id="mcfg-relatorio-telegram" ${u.relatorioMensalTelegram ? 'checked' : ''} />
          <span>Enviar o resumo mensal pelo Telegram (todo dia 1º)</span>
        </label>
        <p class="m-sub" style="margin-top:10px">Requer o bot do Telegram configurado no servidor.</p>
      </div>

      <div class="m-card">
        <span class="m-eyebrow">Notificações</span>
        <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;margin-top:10px">
          <input type="checkbox" id="mcfg-push-optin" disabled />
          <span>Avisar na véspera dos passeios (horário + clima)</span>
        </label>
        <p class="m-sub" id="mcfg-push-note" style="margin-top:10px">Verificando suporte…</p>
      </div>
    `;

    const cb = document.getElementById('mcfg-relatorio-telegram');
    cb?.addEventListener('change', () => {
      // getUser() devolve o merge completo; só trocamos o toggle, o resto fica.
      Storage.setUser({ ...Storage.getUser(), relatorioMensalTelegram: cb.checked });
      window.toast?.(cb.checked ? 'Relatório mensal ativado' : 'Relatório mensal desativado');
    });

    wirePushToggle();
  }

  // Toggle de push (#3 F3): age no change (user-gesture p/ requestPermission).
  // Estado do device (permissão + subscription), reusa window.PushOptin.
  async function wirePushToggle() {
    const cb = document.getElementById('mcfg-push-optin');
    const note = document.getElementById('mcfg-push-note');
    if (!cb || !note) return;

    if (!window.PushOptin || !PushOptin.isSupported()) {
      cb.checked = false; cb.disabled = true;
      note.textContent = (window.PushOptin && PushOptin.unsupportedReason() === 'ios-install')
        ? 'No iPhone/iPad, instale o app na tela inicial para ativar as notificações.'
        : 'Este navegador não suporta notificações push.';
      return;
    }

    const NOTES = {
      on:      'Ativado neste dispositivo.',
      off:     'Receba um aviso por volta das 18h na véspera dos passeios.',
      blocked: 'Notificações bloqueadas — libere nas configurações do navegador.',
    };
    const applyState = (st) => {
      cb.checked = st === 'on';
      cb.disabled = st === 'blocked';
      note.textContent = NOTES[st] || NOTES.off;
    };
    applyState(await PushOptin.currentState());

    cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        if (cb.checked) {
          const r = await PushOptin.enable();
          if (r === 'on') { window.toast?.('Notificações ativadas'); applyState('on'); }
          else if (r === 'blocked')   { window.toast?.('Permissão negada', { kind: 'error' });              applyState('blocked'); }
          else if (r === 'no-server') { window.toast?.('Push não configurado no servidor', { kind: 'error' }); applyState('off'); }
          else                        { window.toast?.('Notificações não suportadas', { kind: 'error' });    applyState('off'); }
        } else {
          await PushOptin.disable();
          window.toast?.('Notificações desativadas');
          applyState('off');
        }
      } catch (e) {
        window.toast?.('Falha nas notificações: ' + (e.message || e), { kind: 'error' });
        applyState(await PushOptin.currentState());
      }
    });
  }

  MRouter.register({
    slug: 'configuracoes',
    viewId: VIEW_ID,
    label: 'Configurações',
    onEnter: () => {
      MShell.setHeader({ eyebrow: 'Perfil', title: 'CONFIGURAÇÕES', back: 'mais' });
      render();
    },
  });
})();
