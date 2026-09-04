/* PERCURSO DAS 7 TELAS — contra o backend e o banco REAIS.
   Cobre: render de cada view, checagens de fundo (recordes, zonas, heatmap,
   condicao do clima) e as guardas de cache das v2.9.2/v2.9.3.
   Uso: node tests/run-all.js --only drive   (ou node drive.js com .cookie) */
const { launch, CDP, waitFor, evalJson, sleep, emularCelular } = require('./cdp.js');
const { saved } = require('./login.js');
const fs = require('fs');

const { BASE } = require('./config.js');
const SLUGS = ['inicio', 'atividades', 'insights', 'bikes', 'mais', 'perfil', 'passeios'];

const out = { pass: [], fail: [], info: {} };
const ok   = (n, d) => { out.pass.push(n + (d ? ` — ${d}` : '')); console.log('  PASS  ' + n + (d ? ` — ${d}` : '')); };
const bad  = (n, d) => { out.fail.push(n + (d ? ` — ${d}` : '')); console.log('  FAIL  ' + n + (d ? ` — ${d}` : '')); };
const chk  = (c, n, d) => c ? ok(n, d) : bad(n, d);

(async () => {
  const cookie = saved();
  if (!cookie) throw new Error('sem .cookie — rode: node login.js <user> <pass>');

  const b = await launch(9334);
  const cdp = new CDP(b.ws); await cdp.ready();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const console_errors = [];
  const netlog = [];
  cdp.on(m => {
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      console_errors.push({ type: m.params.type, text: (m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ') });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console_errors.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails.exception || {}) });
    }
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/')) {
      netlog.push({ url: m.params.request.url.replace(BASE, ''), t: m.params.timestamp });
    }
  });

  for (const d of ['Page', 'Runtime', 'Network', 'Log', 'Performance']) await cdp.send(d + '.enable', {}, sid);
  await emularCelular(cdp, sid);
  await cdp.send('Network.setCookie', { ...cookie, url: BASE }, sid);

  // ───────────────────────── boot ─────────────────────────
  console.log('\n== BOOT ==');
  await cdp.send('Page.navigate', { url: `${BASE}/mobile.html` }, sid);
  await waitFor(cdp, sid, `window.MRouter && document.querySelector('.m-tabbar')`, { label: 'MRouter + tabbar' });
  const bootInfo = await evalJson(cdp, sid, `
    return { url: location.pathname, ver: window.APP_VERSION,
             scripts: document.querySelectorAll('script[src]').length };`);
  chk(bootInfo.url === '/mobile.html', 'gate de auth deixa passar com sessao', bootInfo.url);
  out.info.boot = bootInfo;
  console.log('  info:', JSON.stringify(bootInfo));

  // ───────────────── 25.1 — percorrer as 7 views ─────────────────
  console.log('\n== 25.1 — VIEWS CONTRA DADOS REAIS ==');
  const perView = {};
  for (const slug of SLUGS) {
    netlog.length = 0;
    const before = console_errors.length;
    await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/${slug}'` }, sid);
    await sleep(2200);
    const v = await evalJson(cdp, sid, `
      const el = document.querySelector('#m-view-${slug}');
      const root = el || document.body;
      const txt = root.innerText || '';
      return {
        achou: !!el,
        visivel: !!(root.offsetParent !== null || root === document.body),
        chars: txt.length,
        nan: (txt.match(/NaN/g) || []).length,
        undef: (txt.match(/undefined/g) || []).length,
        nulo: (txt.match(/\\bnull\\b/g) || []).length,
        cards: root.querySelectorAll('.m-card').length,
        canvas: root.querySelectorAll('canvas').length,
        amostra: txt.slice(0, 260).replace(/\\s+/g, ' '),
      };`);
    const novos = console_errors.slice(before);
    perView[slug] = { ...v, apis: netlog.map(n => n.url), erros: novos };
    chk(v.chars > 40, `[${slug}] renderizou conteudo`, `${v.chars} chars, ${v.cards} cards, ${v.canvas} canvas`);
    chk(v.nan === 0, `[${slug}] sem NaN`, v.nan ? `${v.nan} ocorrencias` : '');
    chk(v.undef === 0, `[${slug}] sem undefined`, v.undef ? `${v.undef} ocorrencias` : '');
    chk(novos.filter(e => e.type !== 'warning').length === 0, `[${slug}] sem erro de console`,
        novos.length ? JSON.stringify(novos).slice(0, 200) : '');
    console.log(`  apis(${netlog.length}): ${netlog.map(n => n.url).join(' ') || '—'}`);
  }
  out.info.views = perView;

  // ─────────── 25.1 — checagens especificas ───────────
  console.log('\n== 25.1 — CHECAGENS ESPECIFICAS ==');

  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/perfil'` }, sid); await sleep(1800);
  const perfil = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-perfil');
    const t = r.innerText;
    return { zonas: r.querySelectorAll('.m-zone').length, temMeta: /70/.test(t),
             temPeso: /81[,.]8/.test(t), canvas: r.querySelectorAll('canvas').length,
             semPesagem: /sem pesagem|nenhuma pesagem/i.test(t),
             botaoPesagem: /registrar pesagem/i.test(t) };`);
  chk(perfil.zonas === 6, 'Perfil: 6 zonas de FC a partir de dataNascimento', `${perfil.zonas} zonas`);
  chk(perfil.temMeta, 'Perfil: meta de peso (70) exibida');
  chk(perfil.canvas >= 1 && !perfil.semPesagem, 'Perfil: grafico com as 13 pesagens (nao vazio)');
  chk(!perfil.botaoPesagem, 'Perfil: botao REGISTRAR PESAGEM removido (v2.9.0)');

  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/insights'` }, sid); await sleep(2600);
  const ins = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-insights');
    const t = r.innerText;
    return { txt: t.replace(/\\s+/g,' '),
             prs: r.querySelectorAll('.m-pr').length,
             temFadiga: /fadiga/i.test(t), temReadiness: /readiness|prontid/i.test(t),
             temRecordes: /recordes/i.test(t), fontes: (t.match(/(\\d)\\/3 fontes/) || [])[1] || null };`);
  chk(ins.temFadiga, 'Insights: card INDICE DE FADIGA presente');
  chk(ins.temReadiness, 'Insights: card TRAINING READINESS presente');
  chk(ins.temRecordes, 'Insights: card RECORDES PESSOAIS presente');
  // Esperado do banco: nativos 8/9/11 + 3 sinteticos; type_id 1,2,3,7,12..16 filtrados.
  chk(/82,5 km/.test(ins.txt), 'Recordes: type 8 cycling -> 82,5 km');
  chk(/1\.108 m/.test(ins.txt), 'Recordes: type 9 road_biking -> 1.108 m');
  chk(/1:51:23/.test(ins.txt), 'Recordes: type 11 cycling -> 1:51:23');
  chk(!/esteira|Corrida Leve|São Paulo - Base/i.test(ins.txt), 'Recordes: PRs de corrida (1,2,3,7) filtrados');
  chk(!/passos/i.test(ins.txt), 'Recordes: type 12/13/14 (passos) filtrados');
  // fatigue.js:69 so acrescenta "N/3 fontes" quando fonteCount < 3. Com as 3
  // fontes presentes (61 dias no banco) o sufixo NAO deve aparecer.
  chk(ins.fontes === null, 'Fadiga: sem sufixo de fontes (3/3 presentes)', `fontes=${ins.fontes}`);
  chk(/\d/.test(ins.txt.match(/FADIGA[^0-9]{0,40}(\d+)/)?.[1] || ''), 'Fadiga: indice numerico calculado');
  out.info.insights = { prs: ins.prs, fontes: ins.fontes };

  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/atividades'` }, sid); await sleep(2400);
  const atv = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-atividades');
    const cells = r.querySelectorAll('.m-grid7 > *').length;
    const legend = Array.from(r.querySelectorAll('canvas')).map(c => {
      const ch = window.Chart && Chart.getChart(c);
      return ch ? !!(ch.options.plugins && ch.options.plugins.legend && ch.options.plugins.legend.display) : null;
    });
    return { cells, legend, kpis: r.querySelectorAll('.m-kpi').length };`);
  chk(atv.cells > 0 && atv.cells % 7 === 0, 'Atividades: heatmap alinhado em 7 linhas', `${atv.cells} celulas`);
  chk(atv.legend.every(l => l !== true), 'Atividades: Volume Mensal sem legenda (BUG-071)', JSON.stringify(atv.legend));

  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/passeios'` }, sid); await sleep(3000);
  const pas = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-passeios');
    return { dias: r.querySelectorAll('.m-wx-day').length,
             barrasFaixa: r.querySelectorAll('.m-wx-day .m-wx-esf').length,
             barrasTotal: r.querySelectorAll('.m-wx-esf').length,
             rides: r.querySelectorAll('.m-ride').length };`);
  chk(pas.dias === 7, 'Passeios: faixa de 7 dias', `${pas.dias} dias`);
  chk(pas.barrasFaixa === pas.dias && pas.barrasFaixa > 0,
      'Passeios: barra de condicao em cada dia da faixa', `${pas.barrasFaixa} de ${pas.dias}`);
  chk(pas.barrasTotal > pas.barrasFaixa,
      'Passeios: cards de passeio tambem mostram condicao', `${pas.barrasTotal - pas.barrasFaixa} cards`);
  chk(pas.rides > 0, 'Passeios: passeios futuros listados', `${pas.rides} de 53 no banco`);
  out.info.passeios = pas;

  // ───────────── 25.5 — recarga por onEnter ─────────────
  console.log('\n== 25.5 — CHAMADAS POR RE-ENTRADA ==');
  const recarga = {};
  for (const slug of ['insights', 'inicio', 'atividades', 'passeios', 'perfil']) {
    await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/bikes'` }, sid); await sleep(900);
    netlog.length = 0;
    const t0 = Date.now();
    await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/${slug}'` }, sid);
    await sleep(2600);
    recarga[slug] = { chamadas: netlog.length, ms: Date.now() - t0, urls: netlog.map(n => n.url) };
    console.log(`  ${slug}: ${netlog.length} chamadas em ~${recarga[slug].ms} ms`);
  }
  out.info.recarga = recarga;

  // ── v2.9.2: guarda de cache (BUG-073 / BUG-074) ──────────────────────
  console.log('\n== v2.9.2 — GUARDA DE CACHE ==');

  // Escopo da v2.9.2: Insights (BUG-073) e Bikes (BUG-074).
  chk(recarga.insights.chamadas === 0, 'BUG-073: Insights nao refaz as 7 chamadas na re-entrada',
      `${recarga.insights.chamadas} chamadas (era 7)`);
  // As que ja tinham guarda continuam em 0.
  for (const v of ['atividades', 'passeios', 'perfil']) {
    chk(recarga[v].chamadas === 0, `guarda existente de ${v} intacta`, `${recarga[v].chamadas}`);
  }
  // BUG-077 corrigido na v2.9.3: Inicio passou a usar MShell.cached.
  chk(recarga.inicio.chamadas === 0, 'BUG-077: Inicio nao refaz as 2 chamadas na re-entrada',
      `${recarga.inicio.chamadas} chamadas (era 2)`);

  // Bikes entrou na medicao agora — faltava na tabela da FASE 25.
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/inicio'` }, sid); await sleep(900);
  netlog.length = 0;
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/bikes'` }, sid); await sleep(2600);
  const bikesRe = netlog.length;
  const bikesDom = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-bikes');
    return { itens: r ? r.querySelectorAll('.bike-card, .m-card').length : -1,
             chars: r ? r.innerText.length : 0 };`);
  chk(bikesRe === 0, 'BUG-074: Bikes nao refaz o fan-out na re-entrada', `${bikesRe} chamadas`);
  chk(bikesDom.chars > 40, 'Bikes com cache quente: lista continua renderizada',
      `${bikesDom.chars} chars`);

  // Insights com cache quente: os graficos PRECISAM ser recriados (o onLeave
  // destroi), e os dados continuam na tela.
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/insights'` }, sid); await sleep(2600);
  const insQuente = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-insights');
    const t = r ? r.innerText : '';
    const cvs = Array.from(r ? r.querySelectorAll('canvas') : []);
    return { graficos: cvs.filter(c => !!(window.Chart && Chart.getChart(c))).length,
             canvas: cvs.length, temRecorde: /82,5 km/.test(t), chars: t.length };`);
  console.log('  insights com cache quente:', JSON.stringify(insQuente));
  chk(insQuente.graficos > 0 && insQuente.graficos === insQuente.canvas,
      'Insights com cache quente: graficos recriados',
      `${insQuente.graficos}/${insQuente.canvas}`);
  chk(insQuente.temRecorde, 'Insights com cache quente: dados na tela (82,5 km)');

  // Invalidar tem de voltar a buscar — prova que o cache nao e eterno.
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/inicio'` }, sid); await sleep(900);
  await cdp.send('Runtime.evaluate', { expression: `window.MShell.invalidate()` }, sid);
  netlog.length = 0;
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/insights'` }, sid); await sleep(2800);
  chk(netlog.length === 7, 'MShell.invalidate() faz Insights buscar de novo',
      `${netlog.length} chamadas (esperado 7)`);

  // ── v2.9.3 ────────────────────────────────────────────────────────────
  console.log('\n== v2.9.3 — BUG-076 / BUG-078 ==');

  // BUG-076: o botao "registrar" da Home nao pode gravar vl.ui no
  // sessionStorage — era isso que prendia a aba na variante desktop.
  const fonte = await evalJson(cdp, sid, `
    const t = await (await fetch('js/mobile/home-mobile.js')).text();
    // Procura o ?ui= numa NAVEGACAO, nao em comentario: o proprio fix comenta
    // o motivo citando "?ui=desktop", e um regex solto pegaria o comentario.
    return { temUiDesktop: /location\.href\s*=\s*['\"][^'\"]*\?ui=/.test(t) };`);
  chk(!fonte.temUiDesktop, 'BUG-076: home-mobile.js nao usa mais ?ui=desktop');

  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/inicio'` }, sid);
  await sleep(1500);
  const varianteAntes = await evalJson(cdp, sid, `
    sessionStorage.removeItem('vl.ui');
    const b = document.getElementById('m-home-registrar');
    return { achou: !!b, ui: sessionStorage.getItem('vl.ui') };`);
  chk(varianteAntes.ui === null, 'BUG-076: vl.ui limpo antes do teste', String(varianteAntes.ui));

  // BUG-078: sair da aba durante a busca nao pode deixar Chart em canvas 0x0.
  await cdp.send('Runtime.evaluate', { expression: `window.MShell.invalidate()` }, sid);
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/insights'` }, sid);
  await sleep(120);                                    // sai ANTES da busca terminar
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/inicio'` }, sid);
  await sleep(3200);                                   // deixa a busca resolver sozinha
  const orfaos = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-insights');
    const cvs = Array.from(r ? r.querySelectorAll('canvas') : []);
    return { canvas: cvs.length,
             vivos: cvs.filter(c => !!(window.Chart && Chart.getChart(c))).length };`);
  console.log('  insights apos sair durante a busca:', JSON.stringify(orfaos));
  chk(orfaos.vivos === 0, 'BUG-078: sair durante a busca nao cria grafico orfao',
      `${orfaos.vivos} instancias vivas em ${orfaos.canvas} canvas`);

  // E voltar tem de renderizar normalmente.
  await cdp.send('Runtime.evaluate', { expression: `location.hash = '#/insights'` }, sid);
  await sleep(2800);
  const volta = await evalJson(cdp, sid, `
    const r = document.querySelector('#m-view-insights');
    const cvs = Array.from(r ? r.querySelectorAll('canvas') : []);
    return { vivos: cvs.filter(c => !!(window.Chart && Chart.getChart(c))).length,
             canvas: cvs.length, temRecorde: /82,5 km/.test(r ? r.innerText : '') };`);
  chk(volta.vivos === volta.canvas && volta.vivos > 0,
      'BUG-078: voltar a aba recria os graficos', `${volta.vivos}/${volta.canvas}`);
  chk(volta.temRecorde, 'BUG-078: dados intactos apos a corrida');

  const metrics = await cdp.send('Performance.getMetrics', {}, sid);
  out.info.metrics = Object.fromEntries(metrics.metrics
    .filter(m => ['Nodes', 'JSHeapUsedSize', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration'].includes(m.name))
    .map(m => [m.name, m.value]));
  console.log('  metrics:', JSON.stringify(out.info.metrics));

  out.info.console_errors = console_errors;
  fs.writeFileSync(__dirname + '/resultado.json', JSON.stringify(out, null, 2));
  console.log(`\n=== ${out.pass.length} PASS / ${out.fail.length} FAIL ===`);
  if (out.fail.length) out.fail.forEach(f => console.log('  ! ' + f));

  cdp.close(); b.proc.kill(); await sleep(500);
  try { fs.rmSync(b.profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(out.fail.length ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
