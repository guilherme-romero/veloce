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
     TB_CHROME=/usr/bin/google-chrome-stable TB_BASE=https://bike.arkhamcloud.net \
       node tests/simbolos.js
   Default BASE (config.js): http://127.0.0.1:8002 (nginx local, isola Cloudflare).
═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { launch, CDP, waitFor, evalJson, sleep } = require('./cdp.js');
const { BASE } = require('./config.js');

// Só os .woff2 são hospedados (os .ttf do CSS não existem por design).
const WEBFONTS = ['fa-solid-900.woff2', 'fa-brands-400.woff2', 'fa-regular-400.woff2'];

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
    const r = await evalJson(cdp, sid, `
      const V = ${JSON.stringify(APP_VERSION)};
      const fonts = ${JSON.stringify(WEBFONTS)};
      const res = { css: null, assets: {}, faces: {} };
      async function head(url) {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          const ct = (r.headers.get('content-type') || '').toLowerCase();
          return { status: r.status, ok: r.ok, ct };
        } catch (e) { return { status: 0, ok: false, ct: '', err: String(e) }; }
      }
      async function face(family, url) {
        try {
          const f = new FontFace(family, 'url(' + url + ')');
          await f.load();
          document.fonts.add(f);
          return document.fonts.check('16px "' + family + '"');
        } catch (e) { return false; }
      }
      res.css = await head('/css/font-awesome.min.css' + (V ? '?v=' + V : ''));
      for (const f of fonts) res.assets[f] = await head('/css/webfonts/' + f);
      res.faces.solid  = await face('fa_probe_solid',  '/css/webfonts/fa-solid-900.woff2');
      res.faces.brands = await face('fa_probe_brands', '/css/webfonts/fa-brands-400.woff2');
      return res;
    `);
    out.info.detalhe = r;

    // a) CSS do Font Awesome servido como CSS, 200.
    chk(r.css.ok && r.css.status === 200 && /css/.test(r.css.ct),
      'font-awesome.min.css serve 200 text/css',
      `status=${r.css.status} ct=${r.css.ct || '∅'}`);

    // b) Cada webfont .woff2 servido 200 e NÃO como text/html (sintoma do 404).
    for (const f of WEBFONTS) {
      const a = r.assets[f];
      chk(a.ok && a.status === 200 && !/text\/html/.test(a.ct),
        `webfont ${f} serve 200 (não HTML)`,
        `status=${a.status} ct=${a.ct || '∅'}`);
    }

    // c) O glyph carrega de verdade (FontFace parseou o .woff2). Só o solid é
    //    crítico — todos os ícones do app são fa-solid; brands é complementar.
    chk(r.faces.solid, 'Font Awesome Solid carrega e renderiza (FontFace.load + check)');
    chk(r.faces.brands, 'Font Awesome Brands carrega e renderiza (FontFace.load + check)');
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
