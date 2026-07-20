/* ═══════════════════════════════════════════════════════════════════════
   LOGIN — handler do form de autenticacao
═══════════════════════════════════════════════════════════════════════ */
(() => {
  const form    = document.getElementById('login-form');
  const userEl  = document.getElementById('login-user');
  const passEl  = document.getElementById('login-pass');
  const btn     = document.getElementById('login-submit');
  const btnLbl  = btn ? btn.querySelector('.login-btn-label') : null;
  const btnSpin = btn ? btn.querySelector('.login-btn-spin') : null;
  const errEl   = document.getElementById('login-error');
  const eyeBtn  = document.getElementById('login-toggle-pass');
  const forgot  = document.getElementById('login-forgot');

  document.getElementById('login-version').textContent = 'v' + (window.APP_VERSION || '?');
  document.getElementById('login-year').textContent    = new Date().getFullYear();

  // Se ja autenticado, vai direto pro app. Timeout curto: se o backend demorar,
  // não trava a tela de login — o usuário segue podendo digitar as credenciais.
  const _meCtrl = new AbortController();
  const _meTimer = setTimeout(() => _meCtrl.abort(), 3000);
  fetch('/api/auth/me', { credentials: 'same-origin', signal: _meCtrl.signal })
    .then(r => { if (r.ok) window.location.replace('/index.html'); })
    .catch(() => {})
    .finally(() => clearTimeout(_meTimer));

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }
  function clearError() {
    errEl.hidden = true;
    errEl.textContent = '';
  }
  function setBusy(busy) {
    if (btn) btn.disabled = busy;
    if (userEl) userEl.disabled = busy;
    if (passEl) passEl.disabled = busy;
    if (btnLbl) btnLbl.hidden = busy;
    if (btnSpin) btnSpin.hidden = !busy;
  }

  eyeBtn.addEventListener('click', () => {
    const isPass = passEl.type === 'password';
    passEl.type = isPass ? 'text' : 'password';
    eyeBtn.querySelector('i').className = isPass
      ? 'fa-solid fa-eye-slash'
      : 'fa-solid fa-eye';
  });

  forgot.addEventListener('click', () => {
    showError('Sistema single-user: redefina via servidor com o script hash-password.');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const user = userEl.value.trim();
    const pass = passEl.value;
    if (!user || !pass) {
      showError('Preencha usuário e senha');
      return;
    }

    setBusy(true);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        showError(data.error || 'Falha no login');
        setBusy(false);
        passEl.focus();
        passEl.select();
        return;
      }

      // Sucesso → vai pro app
      window.location.replace('/index.html');
    } catch (err) {
      showError('Erro de conexão com o servidor');
      setBusy(false);
    }
  });
})();
