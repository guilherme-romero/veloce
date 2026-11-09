/* ═══════════════════════════════════════════════════════════════════════
   SHELL PÚBLICO — toda entrada do SHELL é servível pela URL REAL.

   Nasceu da Issue #175, depois de a v2.12.19 subir com os gráficos do desktop
   quebrados: o Chart.js auto-hospedado foi para `js/vendor/`, e o WAF do
   Cloudflare devolve **403 para qualquer caminho contendo `/vendor/`**
   (assinatura de exploit do tipo /vendor/phpunit/...). O nginx servia 200 — só
   a borda barrava.

   O que torna isso perigoso é que NADA local percebe. O arquivo existia no
   disco (`tests/assets.test.js` confere isso), estava no array SHELL (dois
   testes conferem isso) e os 210 testes ficavam verdes. Entre o disco e o
   navegador existem quatro coisas que quebram em silêncio: regra de WAF,
   `location` do nginx, Content-Type e cache do Cloudflare servindo versão
   velha.

   É a mesma classe da #71 (ícones existiam no repo e eram servidos com MIME
   errado), e a resposta ali foi o tests/simbolos.js — que cobre só as fontes.
   Este cobre o SHELL inteiro.

   Por que `cache.addAll` torna isto crítico: ele é ATÔMICO. Uma única entrada
   que responda 403/404 derruba o pré-cache INTEIRO, e hoje o `.catch` no
   install só escreve um warn no console — o app fica sem offline em silêncio.

   Uso (passo 5.5 do deploy, ao lado do smoke de símbolos):
     TB_BASE=https://veloce.arkhamcloud.net node tests/shell-publico.js

   Default (config.js): http://127.0.0.1:8002 — isola o nginx e, por isso,
   NÃO cobre o Cloudflare, que é exatamente onde o incidente aconteceu. A
   execução que vale é contra a URL pública.
═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { BASE } = require('./config.js');

const RAIZ = path.join(__dirname, '..');
const SW = fs.readFileSync(path.join(RAIZ, 'service-worker.js'), 'utf8');

function arrayDoSW(nome) {
  const m = SW.match(new RegExp('const ' + nome + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

// Content-Type aceitável por extensão. O sintoma clássico de 403/404 é o
// servidor devolver `text/html` (a página de erro) com status 200 ou não —
// por isso HTML só é aceito para quem é HTML de verdade.
const CT_ESPERADO = {
  '.js': /javascript|ecmascript/i,
  '.css': /text\/css/i,
  '.html': /text\/html/i,
  '.json': /json/i,
  '.png': /image\/png/i,
  '.jpg': /image\/jpe?g/i,
  '.svg': /image\/svg/i,
  '.ico': /icon|image\//i,
  '.woff2': /font|octet-stream/i,
  '.webmanifest': /manifest|json/i,
};

const out = { pass: [], fail: [] };
const ok = (nome, cond, extra = '') => {
  (cond ? out.pass : out.fail).push(nome);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${nome}${extra ? ' — ' + extra : ''}`);
};

async function checar(entrada) {
  const rel = entrada.replace(/^\.\//, '');
  const url = BASE.replace(/\/$/, '') + '/' + rel;
  let r;
  try {
    r = await fetch(url, { redirect: 'manual' });
  } catch (e) {
    return { rel, erro: e.message };
  }
  const ct = r.headers.get('content-type') || '';
  const esperado = CT_ESPERADO[path.extname(rel).toLowerCase()];
  return {
    rel, status: r.status, ct,
    cf: r.headers.get('cf-ray') ? 'cloudflare' : '',
    ctOk: !esperado || esperado.test(ct),
  };
}

// Motivo legível: um 403 de WAF e um 404 de arquivo ausente exigem correções
// completamente diferentes, e a saída tem de deixar isso claro de cara.
function motivo(r) {
  if (r.erro) return 'rede: ' + r.erro;
  if (r.status === 403) return `403 — bloqueado${r.cf ? ' na borda (Cloudflare)' : ''}; suspeite de regra de WAF no caminho`;
  if (r.status === 404) return '404 — não existe nesta URL (arquivo ausente no deploy ou location do nginx)';
  if (r.status >= 300 && r.status < 400) return `${r.status} — redirect; o SW cacheia a resposta, não o destino`;
  if (r.status !== 200) return `status ${r.status}`;
  if (!r.ctOk) return `200 mas Content-Type "${r.ct}" — típico de página de erro servida como HTML`;
  return '';
}

(async () => {
  const shell = arrayDoSW('SHELL');
  const externos = arrayDoSW('EXTERNAL_ASSETS') || [];
  if (!shell) { console.error('ERRO: não achei o array SHELL em service-worker.js'); process.exit(2); }

  const locais = shell.filter((e) => !/^https?:/.test(e));
  console.log(`\n  SHELL: ${shell.length} entradas (${locais.length} locais) · base: ${BASE}\n`);

  // Em lotes, para não abrir 70 conexões de uma vez contra a borda.
  const resultados = [];
  for (let i = 0; i < locais.length; i += 8) {
    resultados.push(...await Promise.all(locais.slice(i, i + 8).map(checar)));
  }

  const ruins = resultados.filter((r) => motivo(r));
  for (const r of ruins) ok(`SHELL ${r.rel}`, false, motivo(r));
  ok(`as ${locais.length} entradas locais do SHELL servem 200 com Content-Type coerente`,
     ruins.length === 0, ruins.length ? `${ruins.length} com problema (acima)` : '');

  // EXTERNAL_ASSETS é best-effort no install (não derruba o pré-cache), então
  // falha aqui é AVISO, não erro — mas aparece, porque resposta opaca `no-cors`
  // esconde 404 do CDN como se fosse sucesso (é a #169).
  if (externos.length) {
    console.log('');
    for (const u of externos) {
      let s = '?';
      try { s = (await fetch(u, { method: 'GET' })).status; } catch (e) { s = 'rede: ' + e.message; }
      console.log(`  ${s === 200 ? 'ok  ' : 'AVISO'}  externo ${u.split('/').slice(-1)[0]} — status ${s}`
        + (s === 200 ? '' : ' (best-effort: não derruba o pré-cache, mas o offline fica incompleto)'));
    }
  }

  console.log(`\n  ${out.pass.length} pass, ${out.fail.length} fail  (base: ${BASE})`);
  console.log(out.fail.length
    ? 'FAIL — entrada do SHELL não servível: cache.addAll é atômico e o pré-cache INTEIRO cai'
    : 'PASS — SHELL íntegro na URL pública');
  process.exit(out.fail.length ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(2); });
