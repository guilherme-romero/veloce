#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   VAPID-SETUP — gera o par de chaves VAPID para o push ativo (#3 Nivel B)

   As chaves VAPID identificam este servidor junto aos serviços de push dos
   navegadores (FCM/Mozilla/etc). São um par fixo por ambiente — gere UMA vez,
   cole as 3 linhas no server/.env (produção) e não troque depois: trocar a
   chave pública invalida todas as subscriptions já salvas.

   Uso:
     node scripts/vapid-setup.js
═══════════════════════════════════════════════════════════════════════ */
const webpush = require('web-push');
const config = require('../config');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('\nCole estas 3 linhas no seu server/.env:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${config.VAPID_SUBJECT}\n`);
console.log('(VAPID_SUBJECT pode ser um mailto: ou uma URL do seu site — ajuste se quiser.)\n');
