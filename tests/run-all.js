/* ═══════════════════════════════════════════════════════════════════════
   RUN-ALL — roda as quatro suítes na ordem certa.

   O detalhe que justifica este script: `pwa.js` termina fazendo um LOGOUT
   DE VERDADE, que revoga a sessão no servidor. Quem rodar as suítes na mão,
   em sequência, vê a seguinte falhar inteira por 401 — e parece regressão
   quando é só sessão expirada. Aqui cada suíte é precedida de um login novo.

   Uso:
     TB_USER=… TB_PASS=… node tests/run-all.js
     node tests/run-all.js <user> <pass>
     node tests/run-all.js --only drive
═══════════════════════════════════════════════════════════════════════ */
const { spawnSync } = require('child_process');
const path = require('path');
const cfg = require('./config.js');
const { login } = require('./login.js');

const SUITES = [
  { nome: 'simbolos', arquivo: 'simbolos.js', desc: 'carregamento dos ícones Font Awesome (assets públicos)', semLogin: true },
  { nome: 'drive',   arquivo: 'drive.js',   desc: 'percurso das 7 telas + guardas de cache' },
  { nome: 'bordas',  arquivo: 'bordas.js',  desc: 'bordas forçadas via Fetch.enable' },
  { nome: 'desktop', arquivo: 'desktop.js', desc: 'fumaça da variante desktop' },
  // pwa.js por ULTIMO: termina com logout real.
  { nome: 'pwa',     arquivo: 'pwa.js',     desc: 'service worker, offline e cache de dados' },
];

(async () => {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]
            || (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null);

  const user = cfg.USER || args[0];
  const pass = cfg.PASS || args[1];

  const alvos = only ? SUITES.filter(s => s.nome === only) : SUITES;
  if (!alvos.length) {
    console.error(`suíte desconhecida: ${only}. Disponíveis: ${SUITES.map(s => s.nome).join(', ')}`);
    process.exit(1);
  }

  // Credenciais só são necessárias se alguma suíte selecionada autentica.
  // A suíte 'simbolos' valida assets públicos e roda sem login.
  if (alvos.some(s => !s.semLogin) && (!user || !pass)) {
    console.error('uso: TB_USER=… TB_PASS=… node tests/run-all.js   (ou: node tests/run-all.js <user> <pass>)');
    process.exit(1);
  }

  const resultados = [];
  for (const s of alvos) {
    console.log(`\n${'═'.repeat(66)}\n  ${s.nome.toUpperCase()} — ${s.desc}\n${'═'.repeat(66)}`);
    if (!s.semLogin) {
      try {
        await login(user, pass);                   // sessão nova para cada suíte
      } catch (e) {
        console.error(`  login falhou: ${e.message}`);
        resultados.push({ nome: s.nome, code: 99 });
        continue;
      }
    }
    const r = spawnSync(process.execPath, [path.join(__dirname, s.arquivo)],
      { stdio: 'inherit' });
    resultados.push({ nome: s.nome, code: r.status });
  }

  console.log(`\n${'═'.repeat(66)}\n  RESUMO\n${'═'.repeat(66)}`);
  let falhou = 0;
  for (const r of resultados) {
    const ok = r.code === 0;
    if (!ok) falhou++;
    console.log(`  ${ok ? 'OK  ' : 'FALHA'}  ${r.nome}${ok ? '' : `  (exit ${r.code})`}`);
  }
  console.log(falhou ? `\n${falhou} suíte(s) com falha.` : '\nTodas as suítes passaram.');
  process.exit(falhou ? 1 : 0);
})();
