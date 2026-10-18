/* ═══════════════════════════════════════════════════════════════════════
   PUSH-DIGEST — digest da véspera (#3 F2). Para cada passeio de AMANHÃ, um
   push com horário + veredito do clima; no máximo UM push/dia (vários passeios
   → um push listando todos).

   `buildDigestPayload` é pura (testável). `runDigest` orquestra: seleciona os
   passeios de amanhã (reusa RidesSchedule), checa a dedup persistente
   (push_sent), busca o clima (proxy + WeatherRating) e dispara via
   services/push. As dependências externas são injetáveis para teste.
═══════════════════════════════════════════════════════════════════════ */
'use strict';
const pushDefault = require('./push');
const weatherDefault = require('../routes/weather');
const { WeatherRating, RidesSchedule } = require('../utils/core-modules');

// "07:00" → "7h"; "07:30" → "7h30"; vazio → "".
function fmtHora(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return '';
  const [h, m] = hhmm.split(':');
  const hi = String(parseInt(h, 10));
  if (isNaN(parseInt(h, 10))) return '';
  return m && m !== '00' ? `${hi}h${m}` : `${hi}h`;
}

/**
 * Monta o payload do push a partir dos passeios de amanhã + veredito do clima.
 * @param  {Array}  rides — passeios do dia (shape camelCase), já ordenados
 * @param  {Object|null} clima — saída de WeatherRating.rating, ou null
 * @return {Object} { title, body, tag, url }
 */
function buildDigestPayload(rides, clima) {
  const climaSuffix = clima && clima.label ? ` — clima ${clima.label}` : '';
  let body;
  if (rides.length === 1) {
    const r = rides[0];
    const hora = fmtHora(r.horaInicio);
    body = `${r.destino || 'Passeio'}${hora ? ' às ' + hora : ''}${climaSuffix}`;
  } else {
    const lista = rides.map(r => {
      const hora = fmtHora(r.horaInicio);
      return `${r.destino || 'Passeio'}${hora ? ' ' + hora : ''}`;
    }).join(', ');
    body = `${rides.length} passeios: ${lista}${climaSuffix}`;
  }
  return {
    title: 'Pedal amanhã 🚴',
    body,
    tag: 'veloce-digest',
    url: './#/passeios',
  };
}

/**
 * Roda o digest da véspera. Idempotente no dia via tabela push_sent.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} log
 * @param {Object} [deps] — { push, getForecastDaily } injetáveis p/ teste
 * @returns {Promise<{skipped?:string, passeios?:number, sent?:number}>}
 */
async function runDigest(db, log = console, deps = {}) {
  const push = deps.push || pushDefault;
  const getForecastDaily = deps.getForecastDaily || weatherDefault.getSpForecastDaily;

  if (!push.isConfigured()) {
    log.info?.('[push-digest] VAPID não configurado — pulando');
    return { skipped: 'no-vapid' };
  }

  // Amanhã em data LOCAL (não UTC) — mesmo cuidado de scheduler.diaLocalKey.
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const amanhaISO = [
    amanha.getFullYear(),
    String(amanha.getMonth() + 1).padStart(2, '0'),
    String(amanha.getDate()).padStart(2, '0'),
  ].join('-');

  const rows = db.prepare(
    'SELECT id, data, hora_inicio, destino, distancia FROM rides WHERE data = ?'
  ).all(amanhaISO);
  const rides = rows.map(r => ({
    id: r.id, data: r.data, horaInicio: r.hora_inicio || '',
    destino: r.destino || '', distancia: r.distancia ?? 0,
  }));
  const doDia = RidesSchedule.ridesOn(rides, amanhaISO);
  if (!doDia.length) {
    log.info?.('[push-digest] nenhum passeio amanhã — pulando');
    return { skipped: 'no-rides' };
  }

  // Dedup persistente: NO MÁXIMO um push por dia (requisito do #3). Se já há
  // qualquer passeio marcado para amanhã em push_sent, o digest do dia já saiu
  // — não reenvia, mesmo que um passeio novo tenha sido cadastrado depois (ele
  // entraria num segundo push no mesmo dia, o que o requisito proíbe). Como
  // runDigest só processa um dia por vez, basta checar a data.
  const jaDisparou = db.prepare('SELECT 1 FROM push_sent WHERE dia = ? LIMIT 1').get(amanhaISO);
  if (jaDisparou) {
    log.info?.('[push-digest] digest de amanhã já enviado hoje — pulando');
    return { skipped: 'already-sent' };
  }

  // Veredito do clima de amanhã (reusa o proxy cacheado + a regra do core).
  // Falha de clima não cancela o push — só sai sem o sufixo de clima.
  let clima = null;
  try {
    const daily = await getForecastDaily();
    const idx = daily && daily.time ? daily.time.indexOf(amanhaISO) : -1;
    if (idx >= 0) clima = WeatherRating.rating(WeatherRating.buildDay(daily, idx));
  } catch (e) {
    log.warn?.({ err: e.message }, '[push-digest] clima indisponível — segue sem veredito');
  }

  const payload = buildDigestPayload(doDia, clima);
  const res = await push.sendToAll(db, payload, log);

  // Só marca como notificado se houve envio de fato: sem assinante (sent=0) o
  // digest fica "pendente" e tenta de novo (barato, nada foi enviado). Marca
  // TODOS os passeios do dia — o push listou todos num só.
  if (res.sent > 0) {
    const marca = db.prepare('INSERT OR IGNORE INTO push_sent (ride_id, dia) VALUES (?, ?)');
    db.transaction(() => { for (const r of doDia) marca.run(r.id, amanhaISO); })();
  }

  log.info?.({ passeios: doDia.length, ...res }, '[push-digest] processado');
  return { passeios: doDia.length, sent: res.sent };
}

module.exports = { buildDigestPayload, runDigest, fmtHora };
