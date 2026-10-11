/* ═══════════════════════════════════════════════════════════════════════
   SÍMBOLOS — valida, contra a URL real, que o Font Awesome carrega de verdade.

   Nasceu da issue #71: o release 2.10.0 quebrou TODOS os ícones em produção
   porque css/font-awesome.min.css apontava para um url() inexistente. O smoke
   test estático (tests/assets.test.js, #72 item 1) pega a causa no repo; esta
   suíte é o complemento over-the-wire: confirma que o nginx/Cloudflare servem
   o CSS e os webfonts com HTTP 200 e Content-Type de fonte (não a página HTML
   de um 404), e que o .woff2 é um font válido que de fato carrega no browser.

   NÃO precisa de login — os assets são públicos. Usa login.html como âncora
   (página pública, leve, sem redirect de auth), e checa tudo via fetch()
   same-origin + FontFace API no contexto da página.

   Uso:
     TB_CHROME=/usr/bin/google-chrome-stable TB_BASE=https://veloce.arkhamcloud.net \
       node tests/simbolos.js
   Default BASE (config.js): http://127.0.0.1:8002 (nginx local, isola Cloudflare).
═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { launch, CDP, waitFor, evalJson, sleep } = require('./cdp.js');
const { BASE } = require('./config.js');

// Versão lida de js/version.js para montar o ?v= do CSS (mesmo cache-bust que
// o app usa). Não cravar — senão falha a cada release por motivo errado.
const APP_VERSION = (fs
  .readFileSync(path.join(__dirname, '..', 'js', 'version.js'), 'utf8')
  .match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || '';

(async () => {
  const out = { pass: [], fail: [], info: { base: BASE, version: APP_VERSION } };
  const ok = (n, d) => { out.pass.push(n + (d ? ` — ${d}` : '')); console.log('  PASS  ' + n + (d ? ` — ${d}` : '')); };
  const bad = (n, d) => { out.fail.push(n + (d ? ` — ${d}` : '')); console.log('  FAIL  ' + n + (d ? ` — ${d}` : '')); };
  const chk = (c, n, d) => c ? ok(n, d) : bad(n, d);

  const b = await launch(9382);
  const cdp = new CDP(b.ws); await cdp.ready();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Page', 'Runtime']) await cdp.send(d + '.enable', {}, sid);

  try {
    await cdp.send('Page.navigate', { url: `${BASE}/login.html` }, sid);
    await waitFor(cdp, sid, `document.readyState === 'complete'`, { timeout: 25000, label: 'carregar login.html' });

    // Tudo no contexto da página (same-origin com BASE). Erros são capturados
    // e devolvidos como dados — um throw/reject aqui abortaria a suíte inteira.
    //
    // ATENÇÃO (lição da regressão de 2026-10-10): NÃO usar cache:'no-store' nem
    // paths absolutos hardcoded. O bug real foi o Cloudflare servir um CSS STALE
    // (hotfix da #71 reusou ?v=, cache HIT com `url(../webfonts/...)` quebrado),
    // e o @font-face resolve o url() RELATIVO ao próprio CSS. Então: buscar o CSS
    // como de fato servido (?v=, cache do CDN valendo), parsear os url() dele e
    // resolvê-los como o browser faz. Testar o path absoluto "certo" mascarava o bug.
    const r = await evalJson(cdp, sid, `
      const V = ${JSON.stringify(APP_VERSION)};
      const res = { css: null, fonts: [], faces: {} };
      async function head(url) {
        try {
          const r = await fetch(url);
          const ct = (r.headers.get('content-type') || '').toLowerCase();
          return { url, status: r.status, ok: r.ok, ct, cf: r.headers.get('cf-cache-status') };
        } catch (e) { return { url, status: 0, ok: false, ct: '', err: String(e) }; }
      }
      async function face(url) {
        try {
          const f = new FontFace('fa_probe', 'url(' + JSON.stringify(url) + ')');
          await f.load();
          document.fonts.add(f);
          return document.fonts.check('16px "fa_probe"');
        } catch (e) { return false; }
      }
      // CSS como o app o carrega (mesmo ?v=, cache do CDN valendo).
      const cssUrl = new URL('/css/font-awesome.min.css' + (V ? '?v=' + V : ''), location.origin).href;
      const cr = await fetch(cssUrl);
      const cssText = await cr.text();
      res.css = { status: cr.status, ok: cr.ok, ct: (cr.headers.get('content-type')||'').toLowerCase(), cf: cr.headers.get('cf-cache-status') };
      // Parsear url(...woff2) e RESOLVER relativo ao próprio CSS (como o @font-face faz).
      const urls = [...new Set((cssText.match(/url\\(([^)]*\\.woff2)[^)]*\\)/g) || [])
        .map(s => s.replace(/^url\\(/, '').replace(/\\).*$/, '').replace(/^["']|["']$/g, '').trim()))];
      const resolved = [...new Set(urls.map(u => new URL(u, cssUrl).href))];
      for (const u of resolved) res.fonts.push(await head(u));
      // Render check sobre o que o CSS declara para o solid/brands.
      const solid  = resolved.find(u => /fa-solid-900\\.woff2/.test(u));
      const brands = resolved.find(u => /fa-brands-400\\.woff2/.test(u));
      res.faces.solid  = solid  ? await face(solid)  : false;
      res.faces.brands = brands ? await face(brands) : false;
      res.resolved = resolved;
      return res;
    `);
    out.info.detalhe = r;

    // a) CSS do Font Awesome servido como CSS, 200.
    chk(r.css.ok && r.css.status === 200 && /css/.test(r.css.ct),
      'font-awesome.min.css serve 200 text/css',
      `status=${r.css.status} ct=${r.css.ct || '∅'} cf=${r.css.cf || '∅'}`);

    // b) Achou pelo menos os webfonts esperados no CSS servido.
    chk(r.resolved && r.resolved.length >= 3,
      'CSS declara os webfonts via url()',
      `encontrados=${(r.resolved || []).length}`);

    // c) Cada .woff2 que o CSS referencia (path RESOLVIDO como o browser) serve
    //    200 e NÃO text/html — pega url() relativo quebrado e CSS stale do CDN.
    for (const a of r.fonts) {
      const nome = a.url.split('/').slice(-2).join('/').split('?')[0];
      chk(a.ok && a.status === 200 && !/text\/html/.test(a.ct),
        `webfont resolvido ${nome} serve 200 (não HTML)`,
        `status=${a.status} ct=${a.ct || '∅'} cf=${a.cf || '∅'}`);
    }

    // d) O glyph carrega de verdade (FontFace sobre o url() que o CSS declara).
    chk(r.faces.solid, 'Font Awesome Solid carrega e renderiza (FontFace sobre url() do CSS)');
    chk(r.faces.brands, 'Font Awesome Brands carrega e renderiza (FontFace sobre url() do CSS)');
  } catch (e) {
    bad('execução da suíte', e.message);
  }

  fs.writeFileSync(path.join(__dirname, 'resultado-simbolos.json'), JSON.stringify(out, null, 2));
  console.log(`\n  ${out.pass.length} pass, ${out.fail.length} fail  (base: ${BASE})`);
  console.log(out.fail.length ? 'FAIL — símbolos comprometidos, ver acima' : `PASS — símbolos íntegros na v${APP_VERSION}`);

  cdp.close(); b.proc.kill(); await sleep(400);
  try { fs.rmSync(b.profile, { recursive: true, force: true }); } catch (_) {}
  process.exit(out.fail.length ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
