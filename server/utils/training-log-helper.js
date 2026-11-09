/* ═══════════════════════════════════════════════════════════════════════
   TRAINING_LOG_HELPER — funcoes compartilhadas para enriquecer entradas
   do training_log a partir de sync (Strava/Garmin).

   Regras (Fase 4.6a):
     - Cada dia no training_log pode ter payload JSON com:
         { manual: bool, sources: ["strava","garmin"], bike: {...}, fisico: {...} }
     - Se payload.manual === true, o sync NAO sobrescreve bike/fisico
       (usuario editou manualmente, sua vontade prevalece)
     - Sources eh acumulativo (set)
     - Entre fontes automaticas: Garmin > Strava (Garmin sobrescreve campos
       previamente preenchidos por Strava, mas Strava nao sobrescreve Garmin)
═══════════════════════════════════════════════════════════════════════ */

const SOURCE_PRIORITY = { manual: 99, garmin: 2, strava: 1 };

function parsePayload(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function shouldOverwrite(currentFonte, newFonte) {
  // Se nao havia fonte anterior, preenche
  if (!currentFonte) return true;
  // Se manual, nunca sobrescreve
  if (currentFonte === 'manual') return false;
  // Comparar prioridade
  return (SOURCE_PRIORITY[newFonte] || 0) >= (SOURCE_PRIORITY[currentFonte] || 0);
}

/**
 * Auto-fill um dia do training_log com metricas de bike vindas de Strava/Garmin.
 * @param {Database} db  - instancia better-sqlite3
 * @param {string} dataISO - YYYY-MM-DD
 * @param {object} bike - { km, tempoMovS, elevM, fcMedia, fcMax }
 * @param {string} fonte - "strava" | "garmin"
 * @param {string|number} fonteId - id da atividade na fonte
 * @param {string} idPrefix - prefixo para criar id novo se nao houver entrada
 * @returns {"created"|"updated"|"locked"|"noop"}
 */
// #168: statements preparados UMA vez por instância de `db`, não por chamada.
// A função é invocada uma vez por atividade em quatro pontos de sync
// (scheduler.js, routes/garmin.js, routes/strava.js), e preparava três SQLs em
// cada uma.
//
// Medido antes de mudar, para não deixar a impressão errada: em 109 chamadas o
// ganho é 0,53 ms por sync — ~25 ms por DIA, com o scheduler rodando a cada 30
// min. **Não é otimização que se sinta**; o valor aqui é não recompilar SQL
// conhecido num laço, que é o padrão que o resto do backend já segue.
//
// WeakMap e não variável de módulo: os testes criam várias instâncias de `db`
// (SQLite temporário por arquivo de teste), e um statement preparado está
// amarrado à conexão que o criou — cacheá-lo globalmente vazaria entre bancos.
const _stmts = new WeakMap();
function stmts(db) {
  let s = _stmts.get(db);
  if (!s) {
    s = {
      sel: db.prepare('SELECT * FROM training_log WHERE data = ?'),
      upd: db.prepare('UPDATE training_log SET tipos = ?, payload = ? WHERE id = ?'),
      ins: db.prepare('INSERT INTO training_log (id, data, tipos, notas, payload) VALUES (?, ?, ?, ?, ?)'),
    };
    _stmts.set(db, s);
  }
  return s;
}

function autoFillBike(db, dataISO, bike, fonte, fonteId, idPrefix = 'tl') {
  const st = stmts(db);
  const row = st.sel.get(dataISO);

  let tipos, payload;
  if (row) {
    try { tipos = JSON.parse(row.tipos); if (!Array.isArray(tipos)) tipos = []; } catch { tipos = []; }
    payload = parsePayload(row.payload) || {};
  } else {
    tipos = [];
    payload = {};
  }

  // Se usuario descartou a bike deste dia (Fase 4.6c), nao reintroduz nada
  if (payload.bikeDiscarded === true) {
    return 'noop';
  }

  // 1. Adiciona "bike" ao array de tipos se ainda nao tem
  const hadBikeTipo = tipos.includes('bike');
  if (!hadBikeTipo) tipos.push('bike');

  // 2. Sources (set acumulativo)
  if (!Array.isArray(payload.sources)) payload.sources = [];
  if (!payload.sources.includes(fonte)) payload.sources.push(fonte);

  // 3. Bike: respeita manual e prioridade
  const currentFonte = payload.bike?.fonte;
  let bikeWritten = false;
  if (payload.manual === true) {
    // Lock total — nao mexe em bike
  } else if (shouldOverwrite(currentFonte, fonte)) {
    payload.bike = {
      ...bike,
      fonte,
      fonteId,
    };
    bikeWritten = true;
  }

  const payloadJson = JSON.stringify(payload);
  const tiposJson   = JSON.stringify(tipos);

  if (row) {
    st.upd.run(tiposJson, payloadJson, row.id);
    // Mudou algo se gravou a bike OU se acabou de adicionar o tipo "bike".
    // (No caminho manual, bikeWritten é sempre false → decide só pelo tipo.)
    const changed = bikeWritten || !hadBikeTipo;
    return changed ? 'updated' : 'noop';
  } else {
    const id = `${idPrefix}_${fonte}_${dataISO.replace(/-/g, '')}`;
    st.ins.run(id, dataISO, tiposJson, '', payloadJson);
    return 'created';
  }
}

module.exports = { autoFillBike };
