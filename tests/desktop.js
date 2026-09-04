/* Fumaca da DESKTOP — js/app.js teve o gate e o doLogout alterados na v2.9.1. */
const { launch, CDP, waitFor, evalJson, sleep } = require('./cdp.js');
const { saved } = require('./login.js');
const { BASE } = require('./config.js');
(async () => {
  const b = await launch(9380);
  const cdp = new CDP(b.ws); await cdp.ready();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const erros = [];
  cdp.on(m => {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      erros.push((m.params.args || []).map(a => a.value ?? a.description).join(' ').slice(0, 160));
    if (m.method === 'Runtime.exceptionThrown') erros.push('EXCEPTION');
  });
  for (const d of ['Page', 'Runtime', 'Network']) await cdp.send(d + '.enable', {}, sid);
  await cdp.send('Network.setCookie', { ...saved(), url: BASE }, sid);
  await cdp.send('Page.navigate', { url: `${BASE}/index.html` }, sid);
  await waitFor(cdp, sid, `window.Router && document.querySelector('nav')`, { timeout: 25000, label: 'boot desktop' });
  await sleep(2500);
  const r = await evalJson(cdp, sid, `
    return { url: location.pathname, ver: window.APP_VERSION,
             secoes: document.querySelectorAll('section').length,
             temNav: !!document.querySelector('nav'),
             temLogout: !!document.getElementById('btn-logout'),
             corpo: (document.body.innerText||'').length };`);
  console.log('desktop:', JSON.stringify(r));
  console.log('erros de console:', erros.length ? JSON.stringify(erros.slice(0, 5)) : 'nenhum');
  // Versao lida do proprio js/version.js — nao cravar, senao o teste falha a
  // cada release por motivo errado (foi o que aconteceu no bump 2.9.1->2.9.2).
  const esperada = (require('fs')
    .readFileSync(require('path').join(__dirname, '..', 'js', 'version.js'), 'utf8')
    .match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  const ok = r.url === '/index.html' && r.ver === esperada && r.temNav && r.corpo > 200 && erros.length === 0;
  if (r.ver !== esperada) console.log(`  versao: esperava ${esperada}, veio ${r.ver}`);
  console.log(ok ? `\nPASS — desktop bootou normalmente na v${esperada}` : '\nFAIL — ver acima');
  cdp.close(); b.proc.kill(); await sleep(400);
  try { require('fs').rmSync(b.profile, { recursive: true, force: true }); } catch (_) {}
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
