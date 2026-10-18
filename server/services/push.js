/* ═══════════════════════════════════════════════════════════════════════
   PUSH — envio de web-push (notificação ativa no celular, #3 Nível B).

   Segue o padrão opt-in das outras integrações (Telegram/Strava/Gemini): sem o
   par de chaves VAPID, `isConfigured()` é false e o chamador pula o envio —
   nunca quebra o scheduler. As chaves vêm do .env (gere com
   scripts/vapid-setup.js).

   `sendToAll` dispara o mesmo payload para todas as subscriptions salvas e faz
   auto-limpeza: subscription expirada/cancelada (web-push responde 404/410) é
   removida do banco na hora, para a tabela não acumular endpoints mortos.
═══════════════════════════════════════════════════════════════════════ */
const webpush = require('web-push');
const config = require('../config');

let _initialized = false;

function isConfigured() {
  return !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
}

// Registra as chaves VAPID no web-push uma única vez (lazy — só quando há envio
// de fato, e só se configurado).
function _init() {
  if (_initialized) return;
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  _initialized = true;
}

// Reconstrói o objeto PushSubscription que o web-push espera a partir da linha
// do banco.
function _toSubscription(row) {
  return { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
}

/**
 * Envia um payload para todas as subscriptions. Remove as expiradas (410/404).
 * @param {import('better-sqlite3').Database} db
 * @param {Object} payload — objeto serializável (o SW lê no evento `push`)
 * @param {Object} [log]   — logger opcional (fastify/pino); cai no console.
 * @returns {Promise<{sent:number, removed:number, failed:number}>}
 */
async function sendToAll(db, payload, log = console) {
  if (!isConfigured()) {
    log.info?.('[push] VAPID não configurado — envio pulado');
    return { sent: 0, removed: 0, failed: 0 };
  }
  _init();

  const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
  const del = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const body = JSON.stringify(payload);
  let sent = 0, removed = 0, failed = 0;

  for (const row of rows) {
    try {
      await webpush.sendNotification(_toSubscription(row), body);
      sent++;
    } catch (err) {
      // 404/410 = subscription cancelada ou expirada no serviço de push →
      // limpa do banco. Outros erros (rede, 5xx do provedor) não removem: a
      // subscription pode voltar a funcionar no próximo ciclo.
      if (err.statusCode === 404 || err.statusCode === 410) {
        del.run(row.endpoint);
        removed++;
      } else {
        failed++;
        (log.warn || log.log).call(log, `[push] falha ao enviar (${err.statusCode || err.name}): ${err.message}`);
      }
    }
  }

  log.info?.({ sent, removed, failed }, '[push] envio concluído');
  return { sent, removed, failed };
}

module.exports = { isConfigured, sendToAll };
