/* BORDAS que os DADOS REAIS nao exercitam.
   Forcadas no cliente com Fetch.enable (o banco nao e tocado):
     - perfil sem pesoMeta e sem dataNascimento
     - menos de 2 pesagens
     - nenhum passeio futuro
     - fadiga sem body_battery_drain / stress_avg (fonteCount < 3)
     - personal-records vazio */
const { launch, CDP, waitFor, evalJson, sleep, emularCelular } = require('./cdp.js');
const { saved } = require('./login.js');

const { BASE } = require('./config.js');
let pass = 0, fail = 0;
const chk = (c, n, d) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

/* overrides: mapa de "trecho da url" -> funcao(bodyOriginal) -> novoBody */
async function comOverrides(overrides, slug, extrai) {
  const b = await launch(9337 + Math.floor(Math.random() * 40));
  const cdp = new CDP(b.ws); await cdp.ready();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Page', 'Runtime', 'Network']) await cdp.send(d + '.enable', {}, sid);
  await emularCelular(cdp, sid);
  await cdp.send('Network.setCookie', { ...saved(), url: BASE }, sid);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Response' }] }, sid);

  cdp.on(async m => {
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request, responseStatusCode } = m.params;
    const alvo = Object.keys(overrides).find(k => request.url.includes(k));
    try {
      if (!alvo) return void await cdp.send('Fetch.continueRequest', { requestId }, sid);
      let original = '';
      try {
        const r = await cdp.send('Fetch.getResponseBody', { requestId }, sid);
        original = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
      } catch (_) {}
      const novo = overrides[alvo](original);
      await cdp.send('Fetch.fulfillRequest', {
        requestId, responseCode: responseStatusCode || 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(novo).toString('base64'),
      }, sid);
    } catch (e) { try { await cdp.send('Fetch.continueRequest', { requestId }, sid); } catch (_) {} }
  });

  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await waitFor(cdp, sid, `window.MRouter && document.querySelector('.m-tabbar')`, { timeout: 20000 });
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/${slug}'` }, sid);
  await sleep(3000);
  const r = await evalJson(cdp, sid, extrai);
  cdp.close(); b.proc.kill(); await sleep(400);
  try { require('fs').rmSync(b.profile, { recursive: true, force: true }); } catch (_) {}
  return r;
}

(async () => {
  console.log('\n== BORDA 1: perfil sem pesoMeta e sem dataNascimento ==');
  const r1 = await comOverrides({
    '/api/profile': (o) => { const p = JSON.parse(o || '{}');
      delete p.pesoMeta; delete p.dataNascimento; return JSON.stringify(p); },
  }, 'perfil', `
    const r = document.querySelector('#m-view-perfil');
    const t = r ? r.innerText : '';
    return { chars: t.length, zonas: r ? r.querySelectorAll('.m-zone').length : -1,
             nan: (t.match(/NaN/g)||[]).length, undef: (t.match(/undefined/g)||[]).length,
             amostra: t.slice(0,180).replace(/\\s+/g,' ') };`);
  console.log('  ', JSON.stringify(r1));
  chk(r1.chars > 40, 'Perfil sem meta/nascimento ainda renderiza', `${r1.chars} chars`);
  chk(r1.nan === 0, 'Perfil sem meta/nascimento: sem NaN', r1.nan ? `${r1.nan}x` : '');
  chk(r1.undef === 0, 'Perfil sem meta/nascimento: sem undefined', r1.undef ? `${r1.undef}x` : '');

  console.log('\n== BORDA 2: menos de 2 pesagens ==');
  const r2 = await comOverrides({
    '/api/weights': (o) => { const w = JSON.parse(o || '[]');
      return JSON.stringify(Array.isArray(w) ? w.slice(0, 1) : []); },
  }, 'perfil', `
    const r = document.querySelector('#m-view-perfil');
    const t = r ? r.innerText : '';
    return { chars: t.length, nan: (t.match(/NaN/g)||[]).length,
             undef: (t.match(/undefined/g)||[]).length,
             vazio: /sem dados|dados insuficientes|pesagen/i.test(t),
             amostra: t.slice(0,180).replace(/\\s+/g,' ') };`);
  console.log('  ', JSON.stringify(r2));
  chk(r2.chars > 40, '1 pesagem: Perfil renderiza', `${r2.chars} chars`);
  chk(r2.nan === 0 && r2.undef === 0, '1 pesagem: sem NaN/undefined');

  console.log('\n== BORDA 3: nenhum passeio futuro ==');
  const r3 = await comOverrides({ '/api/rides': () => '[]' }, 'passeios', `
    const r = document.querySelector('#m-view-passeios');
    const t = r ? r.innerText : '';
    return { chars: t.length, rides: r ? r.querySelectorAll('.m-ride').length : -1,
             dias: r ? r.querySelectorAll('.m-wx-day').length : -1,
             vazio: !!(r && r.querySelector('.m-empty')),
             nan: (t.match(/NaN/g)||[]).length, undef: (t.match(/undefined/g)||[]).length };`);
  console.log('  ', JSON.stringify(r3));
  chk(r3.rides === 0, 'Sem passeios: lista vazia', `${r3.rides}`);
  chk(r3.vazio, 'Sem passeios: estado vazio explicito exibido');
  chk(r3.dias === 7, 'Sem passeios: faixa de clima continua funcionando', `${r3.dias} dias`);
  chk(r3.nan === 0 && r3.undef === 0, 'Sem passeios: sem NaN/undefined');

  // fatigue.js:44 — zerar bb_drain E stress devolve ok:false (o card cai no
  // estado vazio). O sufixo "N/3 fontes" so e alcancavel quando falta APENAS
  // o HRV, que entra neutro (50) em vez de derrubar o indice.
  console.log('\n== BORDA 4a: fadiga sem HRV (fonteCount = 2) ==');
  const r4a = await comOverrides({
    '/api/garmin/health': (o) => { const h = JSON.parse(o || '[]');
      return JSON.stringify((Array.isArray(h) ? h : []).map(d =>
        ({ ...d, hrv_noite_avg: null }))); },
  }, 'insights', `
    const r = document.querySelector('#m-view-insights');
    const t = r ? r.innerText : '';
    return { chars: t.length, fontes: (t.match(/(\\d)\\/3 fontes/) || [])[1] || null,
             temFadiga: /fadiga/i.test(t), travessao: /—/.test(t),
             nan: (t.match(/NaN/g)||[]).length, undef: (t.match(/undefined/g)||[]).length };`);
  console.log('  ', JSON.stringify(r4a));
  chk(r4a.temFadiga, 'Fadiga sem HRV: card presente');
  chk(r4a.fontes === '2', 'Fadiga sem HRV: sufixo "2/3 fontes Garmin"', `fontes=${r4a.fontes}`);
  chk(r4a.travessao, 'Fadiga sem HRV: metrica ausente vira "—" (nao NaN)');
  chk(r4a.nan === 0 && r4a.undef === 0, 'Fadiga sem HRV: sem NaN/undefined');

  console.log('\n== BORDA 4b: fadiga sem body_battery_drain nem stress (ok:false) ==');
  const r4b = await comOverrides({
    '/api/garmin/health': (o) => { const h = JSON.parse(o || '[]');
      return JSON.stringify((Array.isArray(h) ? h : []).map(d =>
        ({ ...d, body_battery_drain: null, stress_avg: null }))); },
  }, 'insights', `
    const r = document.querySelector('#m-view-insights');
    const t = r ? r.innerText : '';
    return { chars: t.length, temFadiga: /fadiga/i.test(t),
             vazio: !!(r && r.querySelector('.m-empty')),
             nan: (t.match(/NaN/g)||[]).length, undef: (t.match(/undefined/g)||[]).length };`);
  console.log('  ', JSON.stringify(r4b));
  chk(r4b.chars > 40, 'Fadiga ok:false: Insights continua renderizando', `${r4b.chars} chars`);
  chk(r4b.nan === 0 && r4b.undef === 0, 'Fadiga ok:false: degrada sem NaN/undefined');

  console.log('\n== BORDA 5: sem recordes pessoais ==');
  const r5 = await comOverrides({
    '/api/garmin/personal-records': () => '[]',
    '/api/activities/weekly-records': () => 'null',
    '/api/garmin/vo2max': () => 'null',
  }, 'insights', `
    const r = document.querySelector('#m-view-insights');
    const t = r ? r.innerText : '';
    return { chars: t.length, prs: r ? r.querySelectorAll('.m-pr').length : -1,
             temRecordes: /recordes/i.test(t),
             nan: (t.match(/NaN/g)||[]).length, undef: (t.match(/undefined/g)||[]).length };`);
  console.log('  ', JSON.stringify(r5));
  chk(r5.chars > 40, 'Sem PRs: Insights continua renderizando', `${r5.chars} chars`);
  chk(r5.prs === 0, 'Sem PRs: nenhuma linha de recorde', `${r5.prs}`);
  chk(r5.nan === 0 && r5.undef === 0, 'Sem PRs: sem NaN/undefined');

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
