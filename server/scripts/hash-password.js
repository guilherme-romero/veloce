#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   HASH-PASSWORD — gera bcrypt hash para colar no .env

   Uso:
     npm run hash-password "minhaSenha123!"
     ou
     node scripts/hash-password.js "minhaSenha123!"
═══════════════════════════════════════════════════════════════════════ */
const password = require('../utils/password');

const plain = process.argv[2];
if (!plain) {
  console.error('Uso: node scripts/hash-password.js "<senha>"');
  process.exit(1);
}

if (plain.length < 8) {
  console.error('Senha deve ter no minimo 8 caracteres');
  process.exit(1);
}

password.hash(plain).then(hash => {
  console.log('\nCole no seu server/.env:\n');
  console.log(`ADMIN_PASS_HASH=${hash}\n`);
});
