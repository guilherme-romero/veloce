'use strict';
/* Guard de `hidden` no CSS (#166).
 *
 * O atributo `hidden` só esconde porque a folha do NAVEGADOR traz
 * `[hidden] { display: none }` — e essa regra tem especificidade zero. Qualquer
 * `.minha-classe { display: flex }` nossa vence, e o elemento continua na tela,
 * ocupando espaço, normalmente vazio.
 *
 * Foi assim que a v2.12.14 pôs uma barra âmbar vazia de 22px na aba Treino do
 * mobile. O detalhe que fez isso passar pela validação em navegador: eu testei
 * `el.hidden` e `#id:not([hidden])` — o ATRIBUTO —, que estavam corretos. Só o
 * display computado denunciava. Este teste existe porque a asserção certa é
 * estática e barata, e ninguém precisa lembrar dela de novo.
 *
 * Regra: elemento que nasce com `hidden` e tem classe cujo CSS define
 * `display` diferente de `none` precisa de um guard `[hidden]` — na classe ou
 * no id. Precedentes anteriores à issue: css/mobile.css (.m-view),
 * css/mobile-desempenho.css (3) e css/style.css (2).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function listar(dir, ext, acc = []) {
  for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) listar(rel, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(rel);
  }
  return acc;
}

const CSS = listar('css', '.css').map((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');
const FONTES = [
  ...fs.readdirSync(RAIZ).filter((f) => f.endsWith('.html')),
  ...listar('js', '.js'),
];

// `hidden` de verdade: não `aria-hidden`, não `data-hidden`. O lookbehind evita
// o falso positivo que me enganou na primeira varredura — `aria-hidden` casava
// e enchia a lista de ícones do Font Awesome.
//
// A segunda forma cobre o atributo CONDICIONAL de template string,
// `${cond ? '' : 'hidden'}` — é como js/app.js:72 esconde o botão de remover
// avatar, e a primeira versão deste teste passava por cima dele justamente
// porque ali o `hidden` está entre aspas, não solto no markup.
const ATTR_HIDDEN = /(?<![-\w])hidden(?=[\s/>=])|\$\{[^}]*['"`]hidden['"`][^}]*\}/;

function alvos() {
  const achados = [];
  for (const arquivo of FONTES) {
    const src = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    for (const m of src.matchAll(/<(\w+)([^>]*)>/g)) {
      const attrs = m[2];
      if (!ATTR_HIDDEN.test(attrs)) continue;
      const cm = /class=['"`]([^'"`]+)['"`]/.exec(attrs);
      if (!cm) continue;
      const idm = /id=['"`]([\w-]+)['"`]/.exec(attrs);
      for (const classe of cm[1].split(/\s+/)) {
        if (!classe || classe.includes('${')) continue;
        achados.push({ arquivo, id: idm ? idm[1] : null, classe });
      }
    }
  }
  return achados;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// Varre TODAS as regras da classe, não só a primeira.
//
// A primeira versão parava na primeira, e isso a cegava para o caso real de
// `.btn`: a primeira regra `.btn` do CSS concatenado é `.btn{flex:1 1 45%}`,
// sem `display`, então o alvo era descartado antes de chegar à regra que
// define `display:inline-flex`. Cheguei a declarar isso como "o regex do
// atributo não funciona" — diagnóstico errado; o regex sempre casou.
function displayDaClasse(classe) {
  const re = new RegExp('\\.' + esc(classe) + '\\s*(?:,[^{]*?)?\\{([^}]*)\\}', 'g');
  for (const m of CSS.matchAll(re)) {
    const d = /display\s*:\s*([\w-]+)/.exec(m[1]);
    if (d && d[1] !== 'none') return d[1];
  }
  return null;
}

function temGuard(classe, id) {
  if (new RegExp('\\.' + esc(classe) + '\\[hidden\\]').test(CSS)) return true;
  return !!id && new RegExp('#' + esc(id) + '\\[hidden\\]').test(CSS);
}

test('todo elemento com `hidden` cuja classe define display tem guard [hidden]', () => {
  const faltando = alvos()
    .filter((a) => displayDaClasse(a.classe))
    .filter((a) => !temGuard(a.classe, a.id))
    .map((a) => `${a.arquivo}: .${a.classe}${a.id ? ' (#' + a.id + ')' : ''} → display:${displayDaClasse(a.classe)}`);

  assert.deepEqual(faltando, [],
    'Sem o guard, o atributo `hidden` NÃO esconde — a regra de classe vence o ' +
    '[hidden]{display:none} do navegador e o elemento fica na tela, vazio.\n' +
    'Acrescente `.<classe>[hidden] { display: none; }` junto da regra:\n  ' +
    faltando.join('\n  '));
});

test('a varredura realmente encontra elementos (o teste não pode passar vazio)', () => {
  // Um teste cuja lista de alvos silenciosamente zerasse passaria para sempre
  // sem checar nada — mesma armadilha do fuso em TZ=UTC documentada no projeto.
  const todos = alvos();
  assert.ok(todos.length >= 10, `só ${todos.length} elementos com hidden+classe — a varredura quebrou?`);
  assert.ok(todos.some((a) => a.classe === 'm-view'), 'as .m-view do mobile.html deveriam estar na lista');
});

test('o guard do aviso de plano vencido existe (o caso concreto da #166)', () => {
  assert.match(CSS, /\.mtia-vencido\[hidden\]/,
    'foi a regressão da v2.12.14: barra âmbar vazia de 22px na aba Treino do mobile');
});
