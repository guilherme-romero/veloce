/* ═══════════════════════════════════════════════════════════════════════
   TELEGRAM — envio do relatório resumido (PNG) pelo bot (#95, Fase 2).

   Sem dependência nova: usa o fetch/FormData/Blob nativos do Node 18+ para
   falar com a Bot API (https://api.telegram.org/bot<TOKEN>/sendPhoto). Setup
   do bot (token + chat_id no .env) via scripts/telegram-setup.sh.

   Segue o padrão opt-in das outras integrações (Strava/Gemini): se o token ou
   o chat_id não estão configurados, `isConfigured()` é false e o chamador
   simplesmente pula o envio — nunca quebra o scheduler.
═══════════════════════════════════════════════════════════════════════ */
const config = require('../config');

const API_BASE = 'https://api.telegram.org';

function isConfigured() {
  return !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);
}

/**
 * Envia uma foto (PNG/JPG) para o chat configurado.
 * @param {Buffer} buffer   — bytes da imagem
 * @param {string} caption  — legenda (texto simples)
 * @returns {Promise<{ok:boolean, messageId?:number}>}
 */
async function sendPhoto(buffer, caption = '') {
  if (!isConfigured()) throw new Error('telegram não configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');

  const form = new FormData();
  form.append('chat_id', String(config.TELEGRAM_CHAT_ID));
  if (caption) form.append('caption', caption.slice(0, 1024)); // limite da Bot API
  form.append('photo', new Blob([buffer], { type: 'image/png' }), 'relatorio.png');

  const url = `${API_BASE}/bot${config.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  } catch (netErr) {
    // Relança SANITIZADO: um erro de rede do undici pode carregar a URL (com o
    // token) no `cause`, que subiria pro logger do scheduler. Nunca propagar.
    throw new Error(`telegram: falha de rede ao enviar (${netErr.name || 'erro'})`);
  }
  let data = null;
  try { data = await resp.json(); } catch (_) {}

  if (!resp.ok || !data || !data.ok) {
    const desc = (data && data.description) ? data.description : `HTTP ${resp.status}`;
    throw new Error(`telegram sendPhoto falhou: ${desc}`);
  }
  return { ok: true, messageId: data.result && data.result.message_id };
}

module.exports = { isConfigured, sendPhoto };
