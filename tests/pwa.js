/* PWA — service worker, pre-cache, offline e cache de dados.
   localhost e secure context, entao SW/Cache API funcionam sem HTTPS.

   ATENCAO: a ultima secao faz LOGOUT de verdade, o que revoga a sessao
   server-side. Rode `node login.js <user> <pass>` ANTES de cada execucao. */
const { launch, CDP, waitFor, evalJson, sleep, emularCelular } = require('./cdp.js');
const { saved } = require('./login.js');
const fs = require('fs');

const { BASE } = require('./config.js');
const out = { pass: [], fail: [], info: {} };
const ok  = (n, d) => { out.pass.push(n); console.log('  PASS  ' + n + (d ? ` — ${d}` : '')); };
const bad = (n, d) => { out.fail.push(n + (d ? ` — ${d}` : '')); console.log('  FAIL  ' + n + (d ? ` — ${d}` : '')); };
const chk = (c, n, d) => c ? ok(n, d) : bad(n, d);

(async () => {
  const cookie = saved();
  if (!cookie) throw new Error('sem .cookie — rode: node login.js <user> <pass>');

  const b = await launch(9335);
  const cdp = new CDP(b.ws); await cdp.ready();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Page', 'Runtime', 'Network']) await cdp.send(d + '.enable', {}, sid);
  await emularCelular(cdp, sid);
  await cdp.send('Network.setCookie', { ...cookie, url: BASE }, sid);

  console.log('\n== 25.2 — SERVICE WORKER ==');
  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await waitFor(cdp, sid, `window.MRouter`, { label: 'app carregado' });

  // Ativacao do SW (o registro e feito por js/pwa.js).
  // serviceWorker.ready resolve assim que existe um worker ativo, mas o estado
  // pode ainda ser 'activating' por alguns ms — esperar 'activated' de fato.
  const reg = await evalJson(cdp, sid, `
    const r = await navigator.serviceWorker.ready;
    for (let i = 0; i < 60 && r.active && r.active.state !== 'activated'; i++) {
      await new Promise(res => setTimeout(res, 100));
    }
    return { escopo: r.scope, ativo: !!r.active, script: r.active && r.active.scriptURL,
             estado: r.active && r.active.state };`);
  chk(reg.ativo && reg.estado === 'activated', 'SW registra e ativa a partir de mobile.html', reg.estado);
  chk(/service-worker\.js$/.test(reg.script || ''), 'SW correto', reg.script);
  out.info.reg = reg;

  // Pre-cache: cache.addAll e atomico e o .catch em service-worker.js:96
  // mascara a falha. Aqui a contagem prova se completou.
  const cache = await evalJson(cdp, sid, `
    const nomes = await caches.keys();
    const res = {};
    for (const n of nomes) { res[n] = (await (await caches.open(n)).keys()).length; }
    return { nomes, contagem: res };`);
  out.info.cache = cache;
  const total = Object.values(cache.contagem).reduce((a, c) => a + c, 0);
  console.log('  caches:', JSON.stringify(cache.contagem));
  chk(total >= 68, 'pre-cache do SHELL completou (>= 68 entradas)', `${total} entradas em ${cache.nomes.length} cache(s)`);

  // Confere item a item se algo do SHELL ficou de fora.
  const shell = fs.readFileSync(require('path').join(__dirname, '..', 'service-worker.js'), 'utf8')
    .match(/const SHELL\s*=\s*\[([\s\S]*?)\];/)[1]
    .match(/'([^']+)'/g).map(s => s.slice(1, -1));
  const faltando = await evalJson(cdp, sid, `
    const lista = ${JSON.stringify(shell)};
    const nomes = await caches.keys();
    const falta = [];
    for (const item of lista) {
      let achou = false;
      for (const n of nomes) { if (await (await caches.open(n)).match(item)) { achou = true; break; } }
      if (!achou) falta.push(item);
    }
    return falta;`);
  chk(faltando.length === 0, `todos os ${shell.length} itens do SHELL estao no cache`,
      faltando.length ? faltando.join(', ') : '');
  out.info.faltando = faltando;

  // manifest — checado ONLINE, antes de ir offline (offline a pagina e
  // redirecionada para login.html, que nao declara manifest).
  console.log('\n== 25.2 — MANIFEST ==');
  const man = await evalJson(cdp, sid, `
    const l = document.querySelector('link[rel=manifest]');
    if (!l) return { link: null };
    const m = await (await fetch(l.href)).json();
    return { link: l.getAttribute('href'), start_url: m.start_url, scope: m.scope,
             display: m.display, icons: (m.icons||[]).length };`);
  out.info.manifest = man;
  console.log('  manifest:', JSON.stringify(man));
  chk(man.link != null, 'mobile.html declara o manifest', man.link);
  chk(man.icons >= 2, 'manifest tem icones', `${man.icons}`);
  chk(man.display === 'standalone', 'manifest pede standalone', man.display);
  // start_url './' resolve para a raiz: instalar pelo mobile abre index.html,
  // e variant.js so redireciona de volta se a deteccao de dispositivo pegar.
  // BUG-080 corrigido na v2.9.3: mobile.html tem manifest proprio, com
  // start_url apontando para a propria variante.
  chk(/manifest-mobile\.json/.test(man.link || ''), 'BUG-080: mobile usa manifest proprio', man.link);
  chk(man.start_url === './mobile.html', 'BUG-080: start_url abre a variante mobile',
      `start_url='${man.start_url}'`);

  // ── offline ──────────────────────────────────────────────────────────
  console.log('\n== 25.2 — OFFLINE ==');
  await cdp.send('Network.emulateNetworkConditions',
    { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid);

  // (a) o SW cumpre a parte dele? Pergunta direto ao cache, sem passar pelo
  //     boot da pagina — separa a falha do service worker da falha do app.
  const swOff = await evalJson(cdp, sid, `
    const r = await fetch('./mobile.html');
    const t = await r.text();
    return { status: r.status, mobile: /m-tabbar/.test(t), desktop: /class="nav"/.test(t),
             bytes: t.length };`);
  console.log('  fetch offline de ./mobile.html ->', JSON.stringify(swOff));
  chk(swOff.status === 200 && swOff.mobile,
      'SW serve mobile.html do cache offline', `${swOff.bytes} bytes`);
  chk(!swOff.desktop, 'SW NAO cai para index.html (fallback por variante correto)');

  // (b) e o app? Navegacao real offline.
  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await sleep(3000);
  const off = await evalJson(cdp, sid, `
    return { url: location.pathname, temTabbar: !!document.querySelector('.m-tabbar'),
             temLogin: !!document.querySelector('form') && /senha/i.test(document.body.innerText) };`);
  out.info.offline = { sw: swOff, app: off };
  console.log('  navegacao offline ->', JSON.stringify(off));
  chk(off.temTabbar,
      'app abre offline (SEM rede) na UI mobile',
      off.temLogin ? 'caiu na tela de LOGIN — ver BUG-079' : JSON.stringify(off));

  await cdp.send('Network.emulateNetworkConditions',
    { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid);

  // ── v2.9.1: o cache de dados (BUG-079) ────────────────────────────────
  console.log('\n== v2.9.1 — CACHE DE DADOS ==');

  // Online: percorre as telas para popular o cache de dados.
  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await waitFor(cdp, sid, `window.MRouter`, { label: 'app recarregado' });
  for (const slug of ['insights', 'perfil', 'atividades', 'passeios']) {
    await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/${slug}'` }, sid);
    await sleep(2600);
  }

  const dados = await evalJson(cdp, sid, `
    const nomes = await caches.keys();
    if (!nomes.includes('treino-bike-data')) return { existe: false, nomes };
    const ks = await (await caches.open('treino-bike-data')).keys();
    const urls = ks.map(r => new URL(r.url).pathname + new URL(r.url).search);
    return { existe: true, n: urls.length, auth: urls.filter(u => u.startsWith('/api/auth/')),
             amostra: urls.slice(0, 6) };`);
  console.log('  treino-bike-data:', JSON.stringify(dados).slice(0, 300));
  chk(dados.existe && dados.n > 0, 'cache de dados criado e populado', `${dados.n} respostas`);
  chk(dados.existe && dados.auth.length === 0,
      '/api/auth/* NAO e cacheado', dados.auth ? dados.auth.join(', ') : '');

  // Offline: o app tem de abrir NA UI MOBILE e COM dados.
  await cdp.send('Network.emulateNetworkConditions',
    { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid);
  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await sleep(3500);
  const appOff = await evalJson(cdp, sid, `
    return { url: location.pathname, temTabbar: !!document.querySelector('.m-tabbar'),
             temLogin: /senha/i.test(document.body.innerText) };`);
  console.log('  navegacao offline ->', JSON.stringify(appOff));
  chk(appOff.temTabbar, 'BUG-079: app abre offline na UI mobile',
      appOff.temLogin ? 'ainda cai no LOGIN' : JSON.stringify(appOff));

  if (appOff.temTabbar) {
    await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/insights'` }, sid);
    await sleep(3000);
    const insOff = await evalJson(cdp, sid, `
      const r = document.querySelector('#m-view-insights');
      const t = r ? r.innerText : '';
      return { chars: t.length, cards: r ? r.querySelectorAll('.m-card').length : 0,
               temRecordes: /82,5 km/.test(t), vazio: /falha|indisponiv/i.test(t) };`);
    console.log('  insights offline ->', JSON.stringify(insOff));
    chk(insOff.temRecordes, 'offline COM dados: recorde real (82,5 km) renderizado',
        `${insOff.chars} chars, ${insOff.cards} cards`);

    await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/perfil'` }, sid);
    await sleep(2600);
    const perfOff = await evalJson(cdp, sid, `
      const r = document.querySelector('#m-view-perfil');
      const t = r ? r.innerText : '';
      return { temPeso: /81[,.]8/.test(t), zonas: r ? r.querySelectorAll('.m-zone').length : 0 };`);
    chk(perfOff.temPeso && perfOff.zonas === 6, 'offline COM dados: Perfil completo',
        JSON.stringify(perfOff));
  }

  await cdp.send('Network.emulateNetworkConditions',
    { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid);

  // ── v2.9.3: BUG-075 — logout offline NAO pode fingir que deslogou ─────
  console.log('\n== v2.9.3 — BUG-075: LOGOUT COM REDE CAIDA ==');
  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await waitFor(cdp, sid, `window.MRouter`, { label: 'app para logout offline' });
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/mais'` }, sid);
  await sleep(1600);

  await cdp.send('Network.emulateNetworkConditions',
    { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid);
  await cdp.send('Runtime.evaluate', {
    expression: `document.getElementById('m-logout') && document.getElementById('m-logout').click()`,
  }, sid);
  await sleep(2600);
  const offLogout = await evalJson(cdp, sid, `
    return { url: location.pathname,
             temTabbar: !!document.querySelector('.m-tabbar'),
             temToast: !!document.querySelector('.toast, .m-toast') ||
                       /não foi poss[ií]vel/i.test(document.body.innerText) };`);
  console.log('  logout offline ->', JSON.stringify(offLogout));
  chk(offLogout.url !== '/login.html',
      'BUG-075: logout offline NAO manda para o login', `url=${offLogout.url}`);
  chk(offLogout.temToast, 'BUG-075: avisa o usuario que a sessao nao foi encerrada');

  // A sessao tem de continuar VALIDA — era a mentira do bug.
  await cdp.send('Network.emulateNetworkConditions',
    { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid);
  const aindaLogado = await evalJson(cdp, sid, `
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    return { status: r.status };`);
  chk(aindaLogado.status === 200, 'BUG-075: sessao segue valida apos o logout falhar',
      `/api/auth/me -> ${aindaLogado.status}`);

  // Logout tem de apagar o cache de dados.
  console.log('\n== v2.9.1 — LOGOUT LIMPA O CACHE ==');
  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await waitFor(cdp, sid, `window.MRouter`, { label: 'app para logout' });
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/mais'` }, sid);
  await sleep(1600);
  await cdp.send('Runtime.evaluate', {
    expression: `document.getElementById('m-logout') && document.getElementById('m-logout').click()`,
  }, sid);
  await sleep(2600);
  const posLogout = await evalJson(cdp, sid, `
    return { url: location.pathname, temData: (await caches.keys()).includes('treino-bike-data') };`);
  console.log('  pos-logout ->', JSON.stringify(posLogout));
  chk(posLogout.temData === false, 'logout apaga treino-bike-data',
      posLogout.temData ? 'cache SOBREVIVEU ao logout' : '');

  fs.writeFileSync(__dirname + '/resultado-pwa.json', JSON.stringify(out, null, 2));
  console.log(`\n=== ${out.pass.length} PASS / ${out.fail.length} FAIL ===`);
  out.fail.forEach(f => console.log('  ! ' + f));

  cdp.close(); b.proc.kill(); await sleep(500);
  try { fs.rmSync(b.profile, { recursive: true, force: true }); } catch (e) {}
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
