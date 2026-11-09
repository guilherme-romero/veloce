/* ═══════════════════════════════════════════════════════════════════════
   TREINO IA MOBILE — suíte de navegador (#166, #167).

   Roda o app de verdade num Chromium contra o Fastify real, sobre SQLite
   temporário. As quatro ações de ESCRITA são exercitadas e o banco é conferido
   depois de cada uma — é o tipo de verificação que a suíte e2e de
   tests/run-all.js não pode fazer, porque aquela usa o banco de produção.

   Uso:  node tests/browser-treino-ia-mobile.js
   (local apenas — a CI não tem Chromium)

   Por que existe, além de cobrir as duas issues: a #166 foi uma barra âmbar
   VAZIA que passou por uma validação em navegador porque eu testei o ATRIBUTO
   `hidden` em vez do `display` computado. As asserções aqui medem estilo
   computado e bounding box de propósito.
═══════════════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');
const { abrirApp, fechar, placar, RAIZ } = require('./browser-setup.js');

process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];

// Carrega o js/utils.js real para usar a MESMA conta de semana que o app usa.
if (!global.window) global.window = {};
require(path.join(RAIZ, 'js', 'utils.js'));
const Utils = global.window.Utils;

const semanaDe = (iso) => DIAS.map((dia, i) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + i);
  return {
    dia, data: d.toISOString().slice(0, 10), descanso: i === 0, tipo: 'resistencia',
    duracaoMin: 60, rpe: [3, 4], titulo: { a: 'A', b: 'B' }, resumo: 'r', descricao: 'd', blocos: [],
  };
});

const ATUAL = Utils.segundaDaSemanaISO();
const ANTERIOR = (() => { const d = new Date(ATUAL + 'T12:00:00'); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();

function semear(db) {
  db.prepare('INSERT OR REPLACE INTO user_profile (id, payload) VALUES (1, ?)').run(JSON.stringify({
    nome: 'Teste', peso: 80, altura: 180, fcMax: 185,
    objetivosPrioridade: ['condicionamento'], diasDisponiveis: ['terca'],
    duracaoSessaoMin: 60, diaLongao: 'domingo', nivelExperiencia: 'intermediario',
  }));
  const ins = db.prepare('INSERT INTO weekly_training_plans (ativo,favorito,payload,gerado_em) VALUES (?,?,?,?)');
  // id 1: inativo comum (excluível) · id 2: vira favorito no teste · id 3: ativo da semana
  ins.run(0, 0, JSON.stringify({ objetivo: 'plano antigo comum', dias: semanaDe(ANTERIOR) }), '2026-11-01 12:00:00');
  ins.run(0, 0, JSON.stringify({ objetivo: 'plano a favoritar',  dias: semanaDe(ANTERIOR) }), '2026-11-02 12:00:00');
  // 09:03:11 UTC = 06:03 local: serve de prova para a #158 (data local, sem rótulo UTC).
  ins.run(1, 0, JSON.stringify({ objetivo: 'plano ativo',        dias: semanaDe(ATUAL)    }), '2026-11-09 09:03:11');
}

(async () => {
  const p = placar();
  const ctx = await abrirApp({ mobile: true, semear });
  const { pg, db } = ctx;
  const linhas = () => db.prepare('SELECT id,ativo,favorito FROM weekly_training_plans ORDER BY id').all();

  await pg.waitForTimeout(1200);
  await pg.evaluate(() => window.MRouter.navigate('treino-ia'));
  await pg.waitForSelector('#mtia-body:not([hidden])', { timeout: 15000 });

  console.log('\n== #166 · o aviso oculto não pode ocupar espaço ==');
  const aviso = await pg.evaluate(() => {
    const e = document.getElementById('mtia-vencido');
    return { display: getComputedStyle(e).display, h: Math.round(e.getBoundingClientRect().height) };
  });
  // Asserção sobre DISPLAY e ALTURA, nunca sobre o atributo: era o atributo
  // que estava certo enquanto a barra aparecia.
  p.ok('oculto com display:none e altura 0', aviso.display === 'none' && aviso.h === 0,
       `display=${aviso.display} altura=${aviso.h}px`);

  console.log('\n== #158 · data local, sem rótulo de fuso ==');
  const meta = await pg.evaluate(() => document.getElementById('mtia-meta').innerText);
  p.ok('09:03 UTC é exibido como 06:03 local', /06:03/.test(meta) && !/09:03/.test(meta), meta.slice(0, 50));
  p.ok('sem rótulo " UTC"', !/UTC/.test(meta));

  console.log('\n== #167 · abre em bottom sheet ==');
  await pg.click('#mtia-btn-historico');
  await pg.waitForSelector('.modal-backdrop', { timeout: 10000 });
  p.ok('abre em sheet, não lista no fim da tela', true);
  p.ok('o container inline antigo não existe mais', !(await pg.$('#mtia-historico')));
  const ancora = await pg.evaluate(() => getComputedStyle(document.querySelector('.modal-backdrop')).alignItems);
  p.ok('ancorado embaixo (align-items: flex-end)', ancora === 'flex-end', ancora);
  p.ok('lista os 3 planos', (await pg.$$('.mtia-hist-item')).length === 3);
  const larguraLimpar = await pg.evaluate(() => {
    const b = document.getElementById('mtia-hist-limpar');
    return { b: Math.round(b.getBoundingClientRect().width), pai: Math.round(b.parentElement.getBoundingClientRect().width) };
  });
  p.ok('"Limpar histórico" não ocupa a largura toda', larguraLimpar.b < larguraLimpar.pai * 0.6,
       `${larguraLimpar.b}px de ${larguraLimpar.pai}px`);

  const estado = () => pg.evaluate(() => [...document.querySelectorAll('.mtia-hist-item')].map((it) => ({
    id: it.dataset.id,
    excluir: !it.querySelector('[data-act="excluir"]').disabled,
    selecionar: !it.querySelector('[data-act="selecionar"]').disabled,
  })));
  let e = await estado();
  p.ok('o plano ATIVO não é excluível nem selecionável',
       !e.find((x) => x.id === '3').excluir && !e.find((x) => x.id === '3').selecionar);
  p.ok('os inativos são excluíveis', e.find((x) => x.id === '1').excluir && e.find((x) => x.id === '2').excluir);

  console.log('\n== #167 · FAVORITAR ==');
  await pg.click('.mtia-hist-item[data-id="2"] [data-act="favorito"]');
  await pg.waitForTimeout(1500);
  p.ok('gravou no banco', linhas().find((r) => r.id === 2).favorito === 1, JSON.stringify(linhas()));
  e = await estado();
  p.ok('favoritado deixa de ser excluível', !e.find((x) => x.id === '2').excluir);

  console.log('\n== #167 · SELECIONAR ==');
  await pg.click('.mtia-hist-item[data-id="1"] [data-act="selecionar"]');
  await pg.waitForTimeout(1800);
  const ls = linhas();
  p.ok('o plano 1 virou o ativo e o 3 saiu',
       ls.find((r) => r.id === 1).ativo === 1 && ls.find((r) => r.id === 3).ativo === 0, JSON.stringify(ls));
  p.ok('o sheet fecha ao selecionar', !(await pg.$('.modal-backdrop')));

  console.log('\n== #167 · EXCLUIR (com confirmação) ==');
  await pg.click('#mtia-btn-historico');
  await pg.waitForSelector('.mtia-hist-item', { timeout: 10000 });
  await pg.click('.mtia-hist-item[data-id="3"] [data-act="excluir"]');
  await pg.waitForTimeout(800);
  p.ok('pede confirmação', await pg.evaluate(() => /Excluir este plano/.test(document.body.innerText)));
  p.ok('NÃO apaga enquanto não confirmar', linhas().length === 3, linhas().length + ' linhas');
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('.modal button')].find((x) => /^Excluir$/.test(x.textContent.trim()));
    if (b) b.click();
  });
  await pg.waitForTimeout(1800);
  p.ok('apaga depois de confirmar', linhas().length === 2 && !linhas().find((r) => r.id === 3), JSON.stringify(linhas()));

  console.log('\n== #167 · LIMPAR HISTÓRICO ==');
  await pg.waitForSelector('.mtia-hist-item', { timeout: 10000 }).catch(() => {});
  // Sobraram o ativo (1) e o favoritado (2): nada é apagável, botão desabilitado.
  p.ok('desabilitado quando só restam ativo e favoritado',
       await pg.evaluate(() => document.getElementById('mtia-hist-limpar').disabled) === true);

  db.prepare('INSERT INTO weekly_training_plans (ativo,favorito,payload,gerado_em) VALUES (0,0,?,?)')
    .run(JSON.stringify({ objetivo: 'descartavel', dias: semanaDe(ANTERIOR) }), '2026-11-03 12:00:00');
  await pg.evaluate(() => Modals.close());
  await pg.waitForTimeout(500);
  await pg.click('#mtia-btn-historico');
  await pg.waitForSelector('.mtia-hist-item', { timeout: 10000 });
  p.ok('habilita quando há item apagável',
       await pg.evaluate(() => document.getElementById('mtia-hist-limpar').disabled) === false);
  await pg.click('#mtia-hist-limpar');
  await pg.waitForTimeout(800);
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('.modal button')].find((x) => /Limpar hist/.test(x.textContent.trim()));
    if (b) b.click();
  });
  await pg.waitForTimeout(1800);
  const fim = linhas();
  p.ok('preserva o ativo e o favoritado, apaga só o descartável',
       fim.length === 2 && !!fim.find((r) => r.id === 1 && r.ativo === 1) && !!fim.find((r) => r.id === 2 && r.favorito === 1),
       JSON.stringify(fim));

  await fechar(ctx);
  process.exit(p.fim() ? 1 : 0);
})().catch((e) => { console.error('ERRO NA SUÍTE:', e); process.exit(2); });
