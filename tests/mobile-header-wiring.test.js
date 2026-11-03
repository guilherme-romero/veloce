/* ═══════════════════════════════════════════════════════════════════════
   WIRING DOS BOTÕES DO HEADER MOBILE — guarda de regressão da Issue #131.

   O header do shell mobile (`#m-header-actions`, ver js/mobile/shell.js) é
   IRMÃO das views `#m-view-*`, não descendente. Então um botão declarado em
   `actions:` do MShell.setHeader NUNCA é encontrado por
   `view.querySelector('#id')` — o seletor devolve null, o `?.` engole em
   silêncio e o clique não dispara nada, sem erro no console. Foi assim que
   o botão GERAR do Treino IA ficou morto (Issue #131).

   Este teste é estático: lê os módulos de js/mobile/, descobre quais ids
   nascem no markup do header e falha se algum deles for buscado a partir da
   view. O padrão correto é `document.getElementById(...)` dentro do onEnter
   — ver js/mobile/bikes-mobile.js e js/mobile/rides-mobile.js.
═══════════════════════════════════════════════════════════════════════ */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'js', 'mobile');

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function coletarIds(fragmento, destino) {
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(fragmento))) destino.add(m[1]);
}

// Corpo de `function nome() { ... }` ou `const nome = (…) => { … }`,
// equilibrando as chaves — usado quando as actions vêm de um helper
// (ex.: `actions: headerActions()`).
function corpoDaFuncao(src, nome) {
  const abre = new RegExp(
    '(?:function\\s+' + escRe(nome) + '\\s*\\([^)]*\\)\\s*\\{'
      + '|(?:const|let|var)\\s+' + escRe(nome) + '\\s*=\\s*(?:function\\s*)?\\([^)]*\\)\\s*(?:=>\\s*)?\\{)',
  );
  const m = abre.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let nivel = 1;
  while (i < src.length && nivel > 0) {
    const c = src[i];
    if (c === '{') nivel++;
    else if (c === '}') nivel--;
    i++;
  }
  return src.slice(m.index, i);
}

// Ids que nascem no header: `actions:` com template literal inline, ou
// `actions:` chamando um helper do próprio módulo.
function idsDoHeader(src) {
  const ids = new Set();
  let m;

  const inline = /actions:\s*`([^`]*)`/g;
  while ((m = inline.exec(src))) coletarIds(m[1], ids);

  const viaHelper = /actions:\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/g;
  while ((m = viaHelper.exec(src))) {
    const corpo = corpoDaFuncao(src, m[1]);
    if (corpo) coletarIds(corpo, ids);
  }

  return ids;
}

// Qualquer `algo.querySelector('#id')` em que `algo` NÃO seja `document`:
// o header não está sob nenhuma view/container do módulo, então qualquer
// raiz que não seja o documento erra o alvo. Não restringir à variável
// chamada `view` é o que impede falso-verde quando alguém renomeia.
function buscadoForaDoDocumento(src, id) {
  const re = new RegExp(
    '([A-Za-z_$][\\w$]*)\\s*\\??\\.\\s*querySelector(?:All)?\\(\\s*[\'"`]#' + escRe(id) + '[\'"`]',
    'g',
  );
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== 'document') return true;
  }
  return false;
}

test('botões do header mobile não são buscados a partir da view', () => {
  const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  assert.ok(arquivos.length > 0, 'nenhum módulo encontrado em js/mobile/');

  const falhas = [];
  for (const arquivo of arquivos) {
    const src = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
    for (const id of idsDoHeader(src)) {
      if (buscadoForaDoDocumento(src, id)) {
        falhas.push(`js/mobile/${arquivo}: #${id} nasce no header mas é buscado por querySelector de um container`);
      }
    }
  }

  assert.deepStrictEqual(
    falhas,
    [],
    'botão do header buscado a partir da view (listener nunca registrado — Issue #131):\n  '
      + falhas.join('\n  ')
      + '\n  use document.getElementById(...) no onEnter, como em bikes-mobile.js',
  );
});

test('o detector reconhece os ids de header dos módulos que os usam', () => {
  // Blindagem do próprio teste: se o jeito de declarar actions mudar e o
  // detector parar de ver os ids, ele passaria a dar falso-verde em tudo.
  const casos = [
    ['treino-ia-mobile.js', 'mtia-btn-gerar'],      // actions: headerActions()
    ['treino-ia-mobile.js', 'mtia-btn-historico'],  // idem, 2º botão
    ['bikes-mobile.js', 'btn-add-bike'],            // actions: template inline
    ['rides-mobile.js', 'm-passeios-add'],          // idem, outro módulo
  ];
  for (const [arquivo, id] of casos) {
    const src = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
    assert.ok(
      idsDoHeader(src).has(id),
      `detector não achou #${id} no header de js/mobile/${arquivo} — a extração precisa de ajuste`,
    );
  }
});
