#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   ENVIAR-RESUMO CLI — dispara o PNG do relatório mensal pelo Telegram fora
   do dia 1º (#156).

   Por que existe: o único chamador de telegram.sendPhoto era o job mensal do
   scheduler, dentro de uma função NÃO exportada. Até aqui, mandar uma prévia
   exigia colar um `node -e` de 8 linhas (a receita estava no CLAUDE.md), o
   que é fácil de errar e impossível de testar.

   Uso:
     node server/scripts/enviar-resumo.js --dry-run   # renderiza e NÃO envia
     node server/scripts/enviar-resumo.js             # renderiza e envia
     node server/scripts/enviar-resumo.js --mes=2026-10

   Rodar de dentro de server/ (os módulos resolvem por caminho relativo) e na
   máquina que tem o .env e o Chromium do Playwright — em produção, a LXC.

   Três coisas herdadas da receita antiga, e preservadas de propósito:
   1. usa os PRÓPRIOS módulos do app, então o TELEGRAM_BOT_TOKEN e o JWT_SECRET
      do render por loopback ficam dentro do processo — quem dispara não vê
      nem digita segredo nenhum;
   2. NÃO interfere no job automático: o dedup `_relatorioEnviado` é um Set em
      memória dentro do processo do veloce-api, e isto roda num processo
      separado;
   3. o toggle `relatorioMensalTelegram` do Perfil gateia só o JOB, não este
      caminho — por isso a legenda sai marcada como prévia, para não se
      confundir com o envio do dia 1º.
═══════════════════════════════════════════════════════════════════════ */
'use strict';
// Require TARDIO, dentro de main(): carregar report-render puxa db/init, que
// abre o banco e roda integrity_check + wal_checkpoint. Com require no topo,
// até `--help` fazia isso. Em produção o banco é o de verdade, e um
// --help/--mes inválido não tem motivo nenhum para tocá-lo.
let render, telegram;
function carregarModulos() {
  render   = require('../services/report-render');
  telegram = require('../services/telegram');
}

function parseArgs(argv) {
  const args = { dryRun: false, mes: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a.startsWith('--mes=')) args.mes = a.slice('--mes='.length);
    else if (a === '--help' || a === '-h') args.help = true;
    else { args.erro = a; }
  }
  return args;
}

const USO = `Uso: node server/scripts/enviar-resumo.js [--dry-run] [--mes=YYYY-MM]

  --dry-run, -n   renderiza e relata o resultado, SEM enviar nada
  --mes=YYYY-MM   mês da legenda (default: o mês fechado anterior)
  --help, -h      esta ajuda`;

// Mês fechado anterior, em hora LOCAL. setDate(0) recua para o último dia do
// mês anterior — mesma conta que a receita do CLAUDE.md usava.
function mesAnterior() {
  const d = new Date();
  d.setDate(0);
  return d;
}

function rotuloMes(mesArg) {
  if (mesArg) {
    const m = /^(\d{4})-(\d{2})$/.exec(mesArg);
    if (!m) { throw new Error(`--mes espera YYYY-MM, recebi "${mesArg}"`); }
    // Dia 2 e meio-dia: longe das bordas em que o fuso viraria o mês.
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 2, 12, 0, 0);
    if (isNaN(d.getTime())) throw new Error(`--mes inválido: "${mesArg}"`);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  return mesAnterior().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(USO); return 0; }
  if (args.erro) { console.error(`argumento desconhecido: ${args.erro}\n\n${USO}`); return 2; }

  const mes = rotuloMes(args.mes);   // valida os argumentos ANTES de abrir o banco
  carregarModulos();

  // Checa o Telegram ANTES de renderizar: render custa ~1,5s e um Chromium
  // inteiro, e seria desperdício descobrir depois que não há para onde enviar.
  // No dry-run não é impedimento — a ideia ali é justamente provar o render.
  if (!telegram.isConfigured()) {
    const msg = 'Telegram não configurado (faltam TELEGRAM_BOT_TOKEN e/ou TELEGRAM_CHAT_ID no .env)';
    if (!args.dryRun) { console.error('ERRO: ' + msg); return 1; }
    console.log('AVISO: ' + msg + ' — segue porque é --dry-run');
  }

  const t0 = Date.now();
  const { png, falhou, ruido } = await render.renderPng();
  const ms = Date.now() - t0;

  console.log('render: %d bytes em %d ms | falhou: %s | ruído no console: %d',
    png.length, ms, falhou ? 'SIM' : 'não', (ruido || []).length);
  if (ruido && ruido.length) ruido.slice(0, 5).forEach((r) => console.log('   ruído: %s', String(r).slice(0, 160)));

  // `falhou` significa que a página de impressão acusou erro ao montar: o PNG
  // sai, mas provavelmente incompleto. Não enviar é o certo — um relatório
  // quebrado no Telegram é pior que nenhum.
  if (falhou) {
    console.error('ERRO: o render acusou falha; não vou enviar um relatório possivelmente incompleto');
    return 1;
  }

  if (args.dryRun) {
    console.log('--dry-run: nada enviado. Legenda que seria usada:');
    console.log('   Veloce Labs · prévia · fechamento de %s', mes);
    return 0;
  }

  await telegram.sendPhoto(png, `Veloce Labs · prévia · fechamento de ${mes}`);
  console.log('enviado ao Telegram (fechamento de %s)', mes);
  return 0;
}

// Mesmo padrão do server/index.js: só executa quando é o entrypoint, para que
// o teste possa requerer o arquivo e exercitar parseArgs/rotuloMes sem
// disparar um render (e um Chromium) a cada require.
if (require.main === module) {
  main()
  .then(async (codigo) => {
    // report-render mantém um Chromium vivo entre chamadas; sem fechar, o
    // processo não termina. Pode nem ter sido carregado (--help).
    try { if (render) await render.close(); } catch (_) {}
    process.exit(codigo);
  })
  .catch(async (err) => {
    console.error('ERRO:', err && err.message ? err.message : err);
    try { if (render) await render.close(); } catch (_) {}
    process.exit(1);
  });
}

module.exports = { parseArgs, rotuloMes, mesAnterior };
