/* ═══════════════════════════════════════════════════════════════════════
   DATAS — helpers de data LOCAL (America/Sao_Paulo na LXC), compartilhados
   entre o scheduler e os services que precisam chavear algo por dia.

   Por que local e não UTC: para um horário fixo perto da meia-noite,
   toISOString() (UTC) deslocaria a chave para o dia errado num fuso -03:00.
   Mesmo cuidado de js/core/suggestion-history.js e do "amanhã" do digest de
   push (server/services/push-digest.js:69, que mantém o seu próprio cálculo
   porque a janela dele é outra).
═══════════════════════════════════════════════════════════════════════ */
'use strict';

// 'YYYY-MM-DD' no fuso local do processo.
function diaLocalKey(d) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

// Converte um CURRENT_TIMESTAMP do SQLite ('YYYY-MM-DD HH:MM:SS', sempre
// UTC) para Date. Sem o 'Z' explícito, o Node interpretaria a string como
// hora LOCAL e o instante sairia deslocado em 3h — o bastante para um
// registro da madrugada cair no dia anterior na comparação.
function dataDeTimestampSqlite(ts) {
  if (typeof ts !== 'string' || !ts) return null;
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

module.exports = { diaLocalKey, dataDeTimestampSqlite };
