/* ═══════════════════════════════════════════════════════════════════════
   CONFIG — o que muda de máquina para máquina. Tudo sobrescrevível por
   variável de ambiente, para o harness não depender deste caminho exato.
═══════════════════════════════════════════════════════════════════════ */
const os = require('os');
const path = require('path');

// O nginx serve o repositório inteiro aqui, contra o backend e o banco de
// PRODUÇÃO (/etc/nginx/sites-available/treino_bike). Como localhost é secure
// context, service worker e Cache API funcionam sem HTTPS.
const BASE = process.env.TB_BASE || 'http://127.0.0.1:8002';

// chrome-headless-shell do cache do Playwright. Qualquer build recente serve.
const CHROME = process.env.TB_CHROME || path.join(os.homedir(),
  '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell');

// Credenciais: preferir as variáveis de ambiente — argv fica no histórico do
// shell.
const USER = process.env.TB_USER || null;
const PASS = process.env.TB_PASS || null;

module.exports = { BASE, CHROME, USER, PASS };
