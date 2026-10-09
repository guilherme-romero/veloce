'use strict';

// Smoke test de assets estáticos (issue #72, item 1).
//
// Varre os HTML da raiz e os CSS self-hosted e garante que todo asset LOCAL
// referenciado existe no disco. Pega a classe de bug da #71, em que
// `css/font-awesome.min.css` apontava via `url(...)` para um arquivo
// inexistente e quebrou todos os ícones em produção.
//
// Puro filesystem: sem browser, sem rede, sem banco. Roda com `node --test`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Referências externas / não-arquivo que não devem ser resolvidas no disco.
function isExternal(ref) {
  return (
    ref === '' ||
    ref.startsWith('#') ||
    ref.startsWith('http:') ||
    ref.startsWith('https:') ||
    ref.startsWith('//') ||
    ref.startsWith('data:') ||
    ref.startsWith('mailto:') ||
    ref.startsWith('tel:') ||
    ref.startsWith('javascript:')
  );
}

// Remove a query de cache-busting (?v=2.10.0) e qualquer fragmento (#...).
function stripQuery(ref) {
  return ref.split('?')[0].split('#')[0];
}

// Extrai os valores de href="..."/src="..." (aspas simples ou duplas).
function extractHtmlRefs(html) {
  const refs = [];
  const re = /(?:href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    refs.push(m[2] !== undefined ? m[2] : m[3]);
  }
  return refs;
}

// Extrai os url(...) de um CSS com a posição de cada um (com ou sem aspas).
function extractCssUrls(css) {
  const refs = [];
  const re = /url\(\s*("([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    refs.push({ ref: raw.trim(), index: m.index });
  }
  return refs;
}

// Intervalos [início, fim) de cada declaração `src: ...;` (fallback chains
// de @font-face, onde o browser usa só o primeiro formato suportado).
function srcRanges(css) {
  const ranges = [];
  const re = /src\s*:[^;}]*/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function inSameRange(index, ranges) {
  return ranges.find(([a, b]) => index >= a && index < b) || null;
}

test('HTML da raiz: todo href/src local existe no disco', () => {
  const htmlFiles = ['index.html', 'mobile.html', 'login.html'];
  for (const file of htmlFiles) {
    const abs = path.join(ROOT, file);
    assert.ok(fs.existsSync(abs), `HTML esperado não encontrado: ${file}`);
    const html = fs.readFileSync(abs, 'utf8');
    for (const ref of extractHtmlRefs(html)) {
      if (isExternal(ref)) continue;
      const clean = stripQuery(ref);
      if (clean === '') continue; // href="#algo" vira "" após stripQuery
      const target = path.resolve(ROOT, clean);
      assert.ok(
        fs.existsSync(target),
        `${file}: referência "${ref}" aponta para arquivo inexistente (${path.relative(ROOT, target)})`
      );
    }
  }
});

test('CSS self-hosted: todo url() local resolve relativo ao próprio CSS', () => {
  const cssDir = path.join(ROOT, 'css');
  const cssFiles = fs
    .readdirSync(cssDir)
    .filter((f) => f.endsWith('.css'));
  assert.ok(cssFiles.length > 0, 'nenhum CSS encontrado em css/');
  for (const file of cssFiles) {
    const abs = path.join(cssDir, file);
    const css = fs.readFileSync(abs, 'utf8');
    const ranges = srcRanges(css);
    const urls = extractCssUrls(css);

    // url() dentro de uma mesma declaração `src:` formam uma cadeia de
    // fallback: basta um formato local resolver (o browser escolhe um só).
    // url() fora de src (ex. background-image) precisam resolver individualmente.
    const bySrc = new Map(); // range -> [{ref, resolvido}]
    for (const { ref, index } of urls) {
      if (isExternal(ref)) continue;
      const clean = stripQuery(ref);
      if (clean === '') continue;
      // url() é relativo ao diretório do CSS, não à raiz do repo.
      const target = path.resolve(cssDir, clean);
      const exists = fs.existsSync(target);
      const range = inSameRange(index, ranges);
      if (range) {
        const key = range.join(':');
        if (!bySrc.has(key)) bySrc.set(key, []);
        bySrc.get(key).push({ ref, exists });
      } else {
        assert.ok(
          exists,
          `css/${file}: url("${ref}") aponta para arquivo inexistente (${path.relative(ROOT, target)})`
        );
      }
    }

    for (const chain of bySrc.values()) {
      assert.ok(
        chain.some((u) => u.exists),
        `css/${file}: nenhum formato da cadeia src resolve (${chain.map((u) => u.ref).join(', ')})`
      );
    }
  }
});
