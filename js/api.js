/* ═══════════════════════════════════════════════════════════════════════
   API — wrapper de fetch para o backend Fastify (/api/*)
   - Sempre usa credentials: 'same-origin' (cookie httpOnly de sessão)
   - 401 → redireciona para /login.html (sessão expirou)
   - Erros viram exceptions com .status e .body
═══════════════════════════════════════════════════════════════════════ */

const Api = (() => {
  const BASE = '/api';

  function _redirectLogin() {
    if (location.pathname !== '/login.html') {
      location.replace('/login.html');
    }
  }

  async function request(path, { method = 'GET', body = null } = {}) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: {},
    };
    if (body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    let resp;
    try {
      resp = await fetch(BASE + path, opts);
    } catch (netErr) {
      const err = new Error('Falha de rede ao acessar a API');
      err.cause = netErr;
      err.network = true;
      throw err;
    }

    if (resp.status === 401) {
      _redirectLogin();
      const err = new Error('Sessão expirada');
      err.status = 401;
      throw err;
    }

    // 204 No Content
    if (resp.status === 204) return null;

    let data = null;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try { data = await resp.json(); } catch (_) { data = null; }
    } else {
      try { data = await resp.text(); } catch (_) { data = null; }
    }

    if (!resp.ok) {
      const err = new Error(
        (data && data.error) ? data.error : `Erro ${resp.status} em ${path}`
      );
      err.status = resp.status;
      err.body = data;
      throw err;
    }

    return data;
  }

  return {
    get:  (path)        => request(path, { method: 'GET' }),
    post: (path, body)  => request(path, { method: 'POST', body }),
    put:  (path, body)  => request(path, { method: 'PUT',  body }),
    del:  (path)        => request(path, { method: 'DELETE' }),
  };
})();

window.Api = Api;
