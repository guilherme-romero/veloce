/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/bikes (Fase 11.4)
   Garagem virtual: bicicletas + componentes + log de manutenção.
   Modelo "bike ativa": apenas 1 bike acumula km de cada vez.
═══════════════════════════════════════════════════════════════════════ */
const { requireAuth } = require('../middleware/auth');

const TIPOS_BIKE = ['Fixa', 'Gravel', 'MTB', 'Speed'];
const TIPOS_EVENTO = ['substituicao', 'limpeza', 'revisao_completa'];

/* ──────────────────────────────────────────────────────────────────────
   Mappers — row → DTO
─────────────────────────────────────────────────────────────────────── */
function rowToBike(r) {
  return {
    id:           r.id,
    nome:         r.nome,
    marca:        r.marca || '',
    modelo:       r.modelo || '',
    tipo:         r.tipo || '',
    pesoKg:       r.peso_kg ?? null,
    ano:          r.ano ?? null,
    kmInicial:    r.km_inicial ?? 0,
    activeSince:  r.active_since || null,
    active:       !!r.active,
    deactivatedAt: r.deactivated_at || null,
    createdAt:    r.created_at,
  };
}

function rowToComponent(c) {
  return {
    id:                 c.id,
    bikeId:             c.bike_id,
    tipo:               c.tipo,
    vidaUtilKm:         c.vida_util_km,
    kmAtInstall:        c.km_at_install ?? 0,
    temLimpeza:         !!c.tem_limpeza,
    intervaloLimpezaKm: c.intervalo_limpeza_km ?? null,
    kmAtLastClean:      c.km_at_last_clean ?? 0,
    pressao:            c.pressao || '',
    marca:              c.marca || '',
    modelo:             c.modelo || '',
    observacao:         c.observacao || '',
    dataInstall:        c.data_install || null,
    createdAt:          c.created_at,
  };
}

// Componente retirado (geração anterior de um slot) → DTO
function rowToRetired(r) {
  return {
    id:               r.id,
    bikeId:           r.bike_id,
    componentId:      r.component_id || null,
    tipo:             r.tipo,
    marca:            r.marca || '',
    modelo:           r.modelo || '',
    observacao:       r.observacao || '',
    vidaUtilKm:       r.vida_util_km ?? null,
    kmRodado:         r.km_rodado ?? null,
    diasUso:          r.dias_uso ?? null,
    dataInstall:      r.data_install || null,
    dataSubstituicao: r.data_substituicao || null,
    rating:           r.rating ?? null,
    review:           r.review || '',
    createdAt:        r.created_at,
  };
}

function rowToLog(l) {
  return {
    id:          l.id,
    bikeId:      l.bike_id,
    componentId: l.component_id || null,
    tipoEvento:  l.tipo_evento,
    data:        l.data,
    kmBike:      l.km_bike ?? 0,
    notas:       l.notas || '',
    createdAt:   l.created_at,
  };
}

// Intervalo de serviço recorrente. `kmBike` é o km atual da bike; calcula
// o restante (km ou dias) até o próximo serviço e a % decorrida.
function rowToInterval(r, kmBike) {
  const base       = r.base === 'dias' ? 'dias' : 'km';
  const intervalo  = +r.intervalo || 0;
  let decorrido;
  if (base === 'km') {
    decorrido = Math.max(0, +(kmBike - (r.km_at_last || 0)).toFixed(1));
  } else {
    const ref = r.data_last || (r.created_at ? String(r.created_at).slice(0, 10) : null);
    if (ref) {
      const ms = Date.now() - new Date(ref + 'T12:00:00').getTime();
      decorrido = Math.max(0, Math.floor(ms / 86400000));
    } else {
      decorrido = 0;
    }
  }
  const restante = +(intervalo - decorrido).toFixed(base === 'km' ? 1 : 0);
  const pct      = intervalo > 0 ? Math.round((decorrido / intervalo) * 100) : 0;
  return {
    id:         r.id,
    componentId: r.component_id,
    nome:       r.nome,
    base,
    intervalo,
    kmAtLast:   r.km_at_last ?? 0,
    dataLast:   r.data_last || null,
    decorrido,
    restante,
    pct,
    createdAt:  r.created_at,
  };
}

/* ──────────────────────────────────────────────────────────────────────
   Cálculo central — km total acumulado pela bike
   km_inicial + soma de distâncias Garmin + Strava desde active_since
─────────────────────────────────────────────────────────────────────── */
// Tipos excluídos do acumulado de km da bike: e-bike e indoor/virtual
// contam para fitness mas não desgastam a bike física.
const EXCLUDED_STRAVA_TYPES = ['VirtualRide', 'EBikeRide'];
const EXCLUDED_GARMIN_TYPES = ['virtual_ride', 'indoor_cycling', 'e_bike_fitness'];
// Placeholders `?,?,...` para bind parametrizado (o IN é sempre a última
// condição do WHERE, então os valores de tipo entram por último no .get/.all).
const _ph = (arr) => arr.map(() => '?').join(',');

// Agrega km + tempo em movimento + ganho de elevação + nº de atividades
// que a bike acumulou desde active_since (Garmin tem prioridade; Strava só
// entra quando não há link de dedup). Retorna objeto de stats.
function calcBikeStats(db, bike) {
  const base      = +(bike.km_inicial || 0);
  const tempoBase = +(bike.tempo_base || 0);
  const elevBase  = +(bike.elev_base || 0);
  const atvBase   = +(bike.atividades_base || 0);
  const out = { kmTotal: +base.toFixed(1), tempoMovS: tempoBase, elevM: elevBase, atividades: atvBase };
  if (!bike.active_since) return out;
  const garmin = db.prepare(
    `SELECT COALESCE(SUM(distancia_m), 0) AS dist,
            COALESCE(SUM(tempo_mov_s), 0) AS tempo,
            COALESCE(SUM(elevacao_m),  0) AS elev,
            COUNT(*) AS n
     FROM garmin_activities
     WHERE data_inicio >= ?
       AND (tipo IS NULL OR tipo NOT IN (${_ph(EXCLUDED_GARMIN_TYPES)}))`
  ).get(bike.active_since, ...EXCLUDED_GARMIN_TYPES);
  const strava = db.prepare(
    `SELECT COALESCE(SUM(distancia_m), 0) AS dist,
            COALESCE(SUM(tempo_mov_s), 0) AS tempo,
            COALESCE(SUM(elevacao_m),  0) AS elev,
            COUNT(*) AS n
     FROM strava_activities s
     LEFT JOIN activity_links l ON l.strava_id = s.id_strava
     WHERE s.data_inicio >= ?
       AND l.strava_id IS NULL
       AND (s.tipo IS NULL OR s.tipo NOT IN (${_ph(EXCLUDED_STRAVA_TYPES)}))`
  ).get(bike.active_since, ...EXCLUDED_STRAVA_TYPES);
  out.kmTotal   = +(base + (garmin.dist + strava.dist) / 1000).toFixed(1);
  out.tempoMovS = tempoBase + (garmin.tempo || 0) + (strava.tempo || 0);
  out.elevM     = elevBase + Math.round((garmin.elev || 0) + (strava.elev || 0));
  out.atividades = atvBase + (garmin.n || 0) + (strava.n || 0);
  return out;
}

// Mantém compat: apenas o km (usado em pontos que só precisam disso)
function calcBikeKm(db, bike) {
  return calcBikeStats(db, bike).kmTotal;
}

// Stats acumuladas pela bike no intervalo [active_since, upTo] (inclusivo).
// Usado ao inativar: congela km + tempo + elevação + nº de atividades até a
// data de inativação. Já soma as bases existentes (para múltiplos ciclos).
function calcBikeStatsUpTo(db, bike, upTo) {
  const base      = +(bike.km_inicial || 0);
  const tempoBase = +(bike.tempo_base || 0);
  const elevBase  = +(bike.elev_base || 0);
  const atvBase   = +(bike.atividades_base || 0);
  const out = { kmTotal: +base.toFixed(1), tempoMovS: tempoBase, elevM: elevBase, atividades: atvBase };
  if (!bike.active_since) return out;
  const garmin = db.prepare(
    `SELECT COALESCE(SUM(distancia_m), 0) AS dist,
            COALESCE(SUM(tempo_mov_s), 0) AS tempo,
            COALESCE(SUM(elevacao_m),  0) AS elev,
            COUNT(*) AS n
     FROM garmin_activities
     WHERE data_inicio >= ? AND data_inicio <= ?
       AND (tipo IS NULL OR tipo NOT IN (${_ph(EXCLUDED_GARMIN_TYPES)}))`
  ).get(bike.active_since, upTo, ...EXCLUDED_GARMIN_TYPES);
  const strava = db.prepare(
    `SELECT COALESCE(SUM(distancia_m), 0) AS dist,
            COALESCE(SUM(tempo_mov_s), 0) AS tempo,
            COALESCE(SUM(elevacao_m),  0) AS elev,
            COUNT(*) AS n
     FROM strava_activities s
     LEFT JOIN activity_links l ON l.strava_id = s.id_strava
     WHERE s.data_inicio >= ? AND s.data_inicio <= ?
       AND l.strava_id IS NULL
       AND (s.tipo IS NULL OR s.tipo NOT IN (${_ph(EXCLUDED_STRAVA_TYPES)}))`
  ).get(bike.active_since, upTo, ...EXCLUDED_STRAVA_TYPES);
  out.kmTotal    = +(base + (garmin.dist + strava.dist) / 1000).toFixed(1);
  out.tempoMovS  = tempoBase + (garmin.tempo || 0) + (strava.tempo || 0);
  out.elevM      = elevBase + Math.round((garmin.elev || 0) + (strava.elev || 0));
  out.atividades = atvBase + (garmin.n || 0) + (strava.n || 0);
  return out;
}

// Estatísticas detalhadas: totais + médias + máximos por atividade.
// Reúne atividades Garmin + Strava (não-linkadas) desde active_since.
function calcBikeStatsDetailed(db, bike) {
  const base      = +(bike.km_inicial || 0);
  const tempoBase = +(bike.tempo_base || 0);
  const elevBase  = +(bike.elev_base || 0);
  const atvBase   = +(bike.atividades_base || 0);
  const empty = {
    kmTotal: +base.toFixed(1), tempoMovS: tempoBase, elevM: elevBase, atividades: atvBase, calorias: 0,
    avg: { km: null, tempoS: null, elevM: null, velKmh: null, fc: null, watts: null },
    max: { km: null, velKmh: null, elevM: null, watts: null, fc: null },
  };
  if (!bike.active_since) return empty;

  const garmin = db.prepare(
    `SELECT distancia_m, tempo_mov_s, elevacao_m, velocidade_avg, velocidade_max,
            fc_media, fc_max, watts_avg, watts_max, calorias
     FROM garmin_activities
     WHERE data_inicio >= ?
       AND (tipo IS NULL OR tipo NOT IN (${_ph(EXCLUDED_GARMIN_TYPES)}))`
  ).all(bike.active_since, ...EXCLUDED_GARMIN_TYPES);
  const strava = db.prepare(
    `SELECT s.distancia_m, s.tempo_mov_s, s.elevacao_m, s.velocidade_avg, s.velocidade_max,
            s.fc_media, s.fc_max, s.watts_avg, NULL AS watts_max, NULL AS calorias
     FROM strava_activities s
     LEFT JOIN activity_links l ON l.strava_id = s.id_strava
     WHERE s.data_inicio >= ?
       AND l.strava_id IS NULL
       AND (s.tipo IS NULL OR s.tipo NOT IN (${_ph(EXCLUDED_STRAVA_TYPES)}))`
  ).all(bike.active_since, ...EXCLUDED_STRAVA_TYPES);

  const acts = garmin.concat(strava);
  if (acts.length === 0) return empty;
  // Médias/máximos refletem apenas as atividades da janela ativa atual; os
  // totais somam as bases congeladas de ciclos anteriores.

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const valid = (arr) => arr.filter(v => v != null && isFinite(v));
  const avg = (arr) => { const v = valid(arr); return v.length ? sum(v) / v.length : null; };
  const max = (arr) => { const v = valid(arr); return v.length ? Math.max(...v) : null; };
  const r1 = (v) => v == null ? null : +v.toFixed(1);

  const kmArr    = acts.map(a => (a.distancia_m || 0) / 1000);
  const tempoArr = acts.map(a => a.tempo_mov_s).filter(v => v != null);
  const elevArr  = acts.map(a => a.elevacao_m);
  const velAvg   = acts.map(a => a.velocidade_avg != null ? a.velocidade_avg * 3.6 : null);
  const velMax   = acts.map(a => a.velocidade_max != null ? a.velocidade_max * 3.6 : null);
  const fcAvg    = acts.map(a => a.fc_media);
  const fcMax    = acts.map(a => a.fc_max);
  const wAvg     = acts.map(a => a.watts_avg);
  const wMax     = acts.map(a => a.watts_max);

  return {
    kmTotal:    +(base + sum(kmArr)).toFixed(1),
    tempoMovS:  tempoBase + sum(tempoArr.map(v => +v || 0)),
    elevM:      elevBase + Math.round(sum(valid(elevArr))),
    atividades: atvBase + acts.length,
    calorias:   Math.round(sum(valid(acts.map(a => a.calorias)))),
    avg: {
      km:     r1(avg(kmArr)),
      tempoS: avg(tempoArr.map(v => +v || 0)) != null ? Math.round(avg(tempoArr.map(v => +v || 0))) : null,
      elevM:  avg(elevArr) != null ? Math.round(avg(elevArr)) : null,
      velKmh: r1(avg(velAvg)),
      fc:     avg(fcAvg) != null ? Math.round(avg(fcAvg)) : null,
      watts:  avg(wAvg) != null ? Math.round(avg(wAvg)) : null,
    },
    max: {
      km:     r1(max(kmArr)),
      velKmh: r1(max(velMax)),
      elevM:  max(elevArr) != null ? Math.round(max(elevArr)) : null,
      watts:  max(wMax) != null ? Math.round(max(wMax)) : null,
      fc:     max(fcMax) != null ? Math.round(max(fcMax)) : null,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────
   Normalização de inputs
─────────────────────────────────────────────────────────────────────── */
function normalizeBike(input) {
  const b = input || {};
  return {
    nome:         String(b.nome || '').trim(),
    marca:        String(b.marca || '').trim(),
    modelo:       String(b.modelo || '').trim(),
    tipo:         TIPOS_BIKE.includes(b.tipo) ? b.tipo : '',
    pesoKg:       isFinite(parseFloat(b.pesoKg))    ? parseFloat(b.pesoKg)    : null,
    ano:          isFinite(parseInt(b.ano, 10))     ? parseInt(b.ano, 10)     : null,
    kmInicial:    isFinite(parseFloat(b.kmInicial)) ? parseFloat(b.kmInicial) : 0,
    activeSince:  b.activeSince ? String(b.activeSince).slice(0, 10) : null,
  };
}

function normalizeComponent(input) {
  const c = input || {};
  return {
    tipo:               String(c.tipo || '').trim(),
    vidaUtilKm:         isFinite(parseFloat(c.vidaUtilKm))         ? parseFloat(c.vidaUtilKm)         : 0,
    kmAtInstall:        isFinite(parseFloat(c.kmAtInstall))        ? parseFloat(c.kmAtInstall)        : 0,
    temLimpeza:         c.temLimpeza ? 1 : 0,
    intervaloLimpezaKm: isFinite(parseFloat(c.intervaloLimpezaKm)) ? parseFloat(c.intervaloLimpezaKm) : null,
    kmAtLastClean:      isFinite(parseFloat(c.kmAtLastClean))      ? parseFloat(c.kmAtLastClean)      : 0,
    pressao:            String(c.pressao || '').trim(),
    marca:              String(c.marca || '').trim(),
    modelo:             String(c.modelo || '').trim(),
    observacao:         String(c.observacao || '').trim(),
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ──────────────────────────────────────────────────────────────────────
   Routes
─────────────────────────────────────────────────────────────────────── */
async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // ── Listar todas as bikes (com km calculado) ────────────────────────
  fastify.get('/api/bikes', async () => {
    const bikes = fastify.db.prepare('SELECT * FROM bikes ORDER BY active DESC, nome ASC').all();
    return bikes.map(b => ({ ...rowToBike(b), ...calcBikeStats(fastify.db, b) }));
  });

  // ── Criar bike ───────────────────────────────────────────────────────
  fastify.post('/api/bikes', async (req, reply) => {
    const body = req.body || {};
    if (!body.id || !body.nome) return reply.code(400).send({ error: 'id e nome obrigatorios' });
    const n = normalizeBike(body);
    try {
      fastify.db.prepare(`INSERT INTO bikes
        (id, nome, marca, modelo, tipo, peso_kg, ano, km_inicial, active_since, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(body.id, n.nome, n.marca, n.modelo, n.tipo, n.pesoKg, n.ano, n.kmInicial, n.activeSince);
    } catch (e) {
      return reply.code(409).send({ error: 'bike ja existe' });
    }
    const row = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(body.id);
    return reply.code(201).send({ ...rowToBike(row), ...calcBikeStats(fastify.db, row) });
  });

  // ── Editar bike ──────────────────────────────────────────────────────
  fastify.put('/api/bikes/:id', async (req, reply) => {
    const { id } = req.params;
    const cur = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!cur) return reply.code(404).send({ error: 'bike nao encontrada' });
    const merged = { ...rowToBike(cur), ...(req.body || {}) };
    const n = normalizeBike(merged);
    fastify.db.prepare(`UPDATE bikes SET
      nome = ?, marca = ?, modelo = ?, tipo = ?, peso_kg = ?, ano = ?,
      km_inicial = ?, active_since = ? WHERE id = ?`)
      .run(n.nome, n.marca, n.modelo, n.tipo, n.pesoKg, n.ano, n.kmInicial, n.activeSince, id);
    const row = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    return { ...rowToBike(row), ...calcBikeStats(fastify.db, row) };
  });

  // ── Deletar bike (cascade em componentes e log) ──────────────────────
  fastify.delete('/api/bikes/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM bikes WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'bike nao encontrada' });
    return { ok: true };
  });

  // ── Ativar bike — mantém outras ativas intactas ──────────────────────
  fastify.post('/api/bikes/:id/activate', async (req, reply) => {
    const { id } = req.params;
    const cur = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!cur) return reply.code(404).send({ error: 'bike nao encontrada' });

    // Valida formato ISO antes de salvar (BUG-013)
    let activeSince;
    if (req.body && req.body.activeSince) {
      const s = String(req.body.activeSince).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return reply.code(400).send({ error: 'activeSince deve estar em YYYY-MM-DD' });
      }
      activeSince = s;
    } else {
      activeSince = cur.active_since || todayISO();
    }

    // Reativar: nova data de início e limpa a data de inativação. A
    // quilometragem preservada fica em km_inicial (congelada na inativação)
    // e novas atividades a partir de activeSince são somadas por cima.
    fastify.db.prepare('UPDATE bikes SET active = 1, active_since = ?, deactivated_at = NULL WHERE id = ?')
      .run(activeSince, id);
    const row = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    return { ...rowToBike(row), ...calcBikeStats(fastify.db, row) };
  });

  // ── Inativar bike individualmente ────────────────────────────────────
  // Congela a quilometragem rodada até a data informada em km_inicial e
  // zera active_since, de modo que atividades posteriores não sejam mais
  // somadas. A data de inativação fica registrada em deactivated_at.
  fastify.post('/api/bikes/:id/deactivate', async (req, reply) => {
    const { id } = req.params;
    const cur = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!cur) return reply.code(404).send({ error: 'bike nao encontrada' });

    let deactivatedAt = todayISO();
    if (req.body && req.body.deactivatedAt) {
      const s = String(req.body.deactivatedAt).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return reply.code(400).send({ error: 'deactivatedAt deve estar em YYYY-MM-DD' });
      }
      deactivatedAt = s;
    }

    const congelado = calcBikeStatsUpTo(fastify.db, cur, deactivatedAt);
    fastify.db.prepare(
      `UPDATE bikes SET active = 0, km_inicial = ?, tempo_base = ?, elev_base = ?,
       atividades_base = ?, active_since = NULL, deactivated_at = ? WHERE id = ?`
    ).run(congelado.kmTotal, congelado.tempoMovS, congelado.elevM,
          congelado.atividades, deactivatedAt, id);
    const row = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    return { ...rowToBike(row), ...calcBikeStats(fastify.db, row) };
  });

  // ── Listar componentes da bike ───────────────────────────────────────
  fastify.get('/api/bikes/:id/components', async (req, reply) => {
    const { id } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const kmBike = calcBikeKm(fastify.db, bike);
    const comps = fastify.db.prepare(
      'SELECT * FROM bike_components WHERE bike_id = ? ORDER BY created_at ASC'
    ).all(id);
    const intervalStmt = fastify.db.prepare(
      'SELECT * FROM bike_service_intervals WHERE component_id = ? ORDER BY created_at ASC'
    );
    return comps.map(c => {
      const dto = rowToComponent(c);
      dto.kmDesgastado = +(kmBike - dto.kmAtInstall).toFixed(1);
      dto.kmDesdeUltimaLimpeza = dto.temLimpeza
        ? +(kmBike - dto.kmAtLastClean).toFixed(1)
        : null;
      dto.intervals = intervalStmt.all(c.id).map(r => rowToInterval(r, kmBike));
      return dto;
    });
  });

  // ── Estatísticas detalhadas da bike ──────────────────────────────────
  fastify.get('/api/bikes/:id/stats', async (req, reply) => {
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(req.params.id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    return calcBikeStatsDetailed(fastify.db, bike);
  });

  // ── Adicionar componente ─────────────────────────────────────────────
  fastify.post('/api/bikes/:id/components', async (req, reply) => {
    const { id } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const body = req.body || {};
    if (!body.id || !body.tipo) return reply.code(400).send({ error: 'id e tipo obrigatorios' });
    const n = normalizeComponent(body);
    if (n.vidaUtilKm <= 0) return reply.code(400).send({ error: 'vida_util_km > 0 obrigatoria' });

    // Se kmAtLastClean não veio, usa kmAtInstall (limpeza fresca = sem desgaste)
    const kmAtLastClean = isFinite(parseFloat(body.kmAtLastClean))
      ? parseFloat(body.kmAtLastClean)
      : n.kmAtInstall;
    // Data de instalação: aceita override (componente instalado no passado),
    // senão assume hoje.
    const dataInstall = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dataInstall || ''))
      ? String(body.dataInstall).slice(0, 10)
      : todayISO();

    try {
      fastify.db.prepare(`INSERT INTO bike_components
        (id, bike_id, tipo, vida_util_km, km_at_install, tem_limpeza, intervalo_limpeza_km, km_at_last_clean, pressao, marca, modelo, observacao, data_install)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(body.id, id, n.tipo, n.vidaUtilKm, n.kmAtInstall, n.temLimpeza, n.intervaloLimpezaKm, kmAtLastClean, n.pressao, n.marca, n.modelo, n.observacao, dataInstall);
    } catch (e) {
      return reply.code(409).send({ error: 'componente ja existe' });
    }
    const row = fastify.db.prepare('SELECT * FROM bike_components WHERE id = ?').get(body.id);
    return reply.code(201).send(rowToComponent(row));
  });

  // ── Editar componente ────────────────────────────────────────────────
  fastify.put('/api/bikes/:id/components/:cid', async (req, reply) => {
    const { cid } = req.params;
    const cur = fastify.db.prepare('SELECT * FROM bike_components WHERE id = ?').get(cid);
    if (!cur) return reply.code(404).send({ error: 'componente nao encontrado' });
    const merged = { ...rowToComponent(cur), ...(req.body || {}) };
    const n = normalizeComponent(merged);
    fastify.db.prepare(`UPDATE bike_components SET
      tipo = ?, vida_util_km = ?, km_at_install = ?, tem_limpeza = ?,
      intervalo_limpeza_km = ?, km_at_last_clean = ?, pressao = ?,
      marca = ?, modelo = ?, observacao = ? WHERE id = ?`)
      .run(n.tipo, n.vidaUtilKm, n.kmAtInstall, n.temLimpeza, n.intervaloLimpezaKm, n.kmAtLastClean, n.pressao, n.marca, n.modelo, n.observacao, cid);
    return rowToComponent(fastify.db.prepare('SELECT * FROM bike_components WHERE id = ?').get(cid));
  });

  // ── Deletar componente ───────────────────────────────────────────────
  fastify.delete('/api/bikes/:id/components/:cid', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM bike_components WHERE id = ?').run(req.params.cid);
    if (info.changes === 0) return reply.code(404).send({ error: 'componente nao encontrado' });
    return { ok: true };
  });

  // ── Registrar limpeza de componente ──────────────────────────────────
  fastify.post('/api/bikes/:id/components/:cid/limpar', async (req, reply) => {
    const { id, cid } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const comp = fastify.db.prepare('SELECT * FROM bike_components WHERE id = ?').get(cid);
    if (!comp) return reply.code(404).send({ error: 'componente nao encontrado' });
    if (!comp.tem_limpeza) return reply.code(400).send({ error: 'componente nao tem ciclo de limpeza' });

    const kmBike = calcBikeKm(fastify.db, bike);
    const data = (req.body && req.body.data) ? String(req.body.data).slice(0, 10) : todayISO();
    const notas = String((req.body && req.body.notas) || '');
    const logId = `bml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tx = fastify.db.transaction(() => {
      fastify.db.prepare('UPDATE bike_components SET km_at_last_clean = ? WHERE id = ?')
        .run(kmBike, cid);
      fastify.db.prepare(`INSERT INTO bike_maintenance_log
        (id, bike_id, component_id, tipo_evento, data, km_bike, notas)
        VALUES (?, ?, ?, 'limpeza', ?, ?, ?)`)
        .run(logId, id, cid, data, kmBike, notas);
    });
    tx();
    return { ok: true, kmBike };
  });

  // ── Substituir componente ────────────────────────────────────────────
  // Antes de zerar o desgaste, arquiva a geração que sai em
  // bike_retired_components (km rodado real, dias de uso, vida planejada +
  // avaliação por estrelas/review). Depois aplica os dados do NOVO item.
  fastify.post('/api/bikes/:id/components/:cid/substituir', async (req, reply) => {
    const { id, cid } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const comp = fastify.db.prepare('SELECT * FROM bike_components WHERE id = ?').get(cid);
    if (!comp) return reply.code(404).send({ error: 'componente nao encontrado' });

    const body = req.body || {};
    const kmBike = calcBikeKm(fastify.db, bike);
    const data = body.data ? String(body.data).slice(0, 10) : todayISO();
    const notas = String(body.notas || '');

    // Dados do NOVO item (fallback para os do item que sai)
    const novaVidaUtil = isFinite(parseFloat(body.vidaUtilKm)) ? parseFloat(body.vidaUtilKm) : comp.vida_util_km;
    const novaMarca = body.novaMarca != null ? String(body.novaMarca).trim() : (comp.marca || '');
    const novoModelo = body.novoModelo != null ? String(body.novoModelo).trim() : (comp.modelo || '');
    const novaObs = body.novaObservacao != null ? String(body.novaObservacao).trim() : '';

    // Avaliação do item que SAI
    const ratingRaw = parseInt(body.rating, 10);
    const rating = isFinite(ratingRaw) ? Math.max(1, Math.min(5, ratingRaw)) : null;
    const review = String(body.review || '').trim();

    // Snapshot da geração que sai
    const kmRodado = +(kmBike - (comp.km_at_install || 0)).toFixed(1);
    const instISO = comp.data_install
      || (comp.created_at ? String(comp.created_at).slice(0, 10) : null);
    let diasUso = null;
    if (instISO && /^\d{4}-\d{2}-\d{2}$/.test(instISO)) {
      const ms = new Date(data + 'T12:00:00') - new Date(instISO + 'T12:00:00');
      if (isFinite(ms)) diasUso = Math.max(0, Math.round(ms / 86400000));
    }

    const retiredId = `brc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const logId = `bml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tx = fastify.db.transaction(() => {
      fastify.db.prepare(`INSERT INTO bike_retired_components
        (id, bike_id, component_id, tipo, marca, modelo, observacao,
         vida_util_km, km_rodado, dias_uso, data_install, data_substituicao, rating, review)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(retiredId, id, cid, comp.tipo, comp.marca || '', comp.modelo || '', comp.observacao || '',
             comp.vida_util_km, kmRodado, diasUso, instISO, data, rating, review);
      fastify.db.prepare(`UPDATE bike_components SET
        vida_util_km = ?, km_at_install = ?, km_at_last_clean = ?,
        marca = ?, modelo = ?, observacao = ?, data_install = ? WHERE id = ?`)
        .run(novaVidaUtil, kmBike, kmBike, novaMarca, novoModelo, novaObs, data, cid);
      fastify.db.prepare(`INSERT INTO bike_maintenance_log
        (id, bike_id, component_id, tipo_evento, data, km_bike, notas)
        VALUES (?, ?, ?, 'substituicao', ?, ?, ?)`)
        .run(logId, id, cid, data, kmBike, notas);
    });
    tx();
    return { ok: true, kmBike, retiredId };
  });

  // ── Componentes retirados (histórico + agregado por tipo+marca) ──────
  fastify.get('/api/bikes/:id/retired-components', async (req, reply) => {
    const { id } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });

    const compId = req.query && req.query.componentId;
    const rows = compId
      ? fastify.db.prepare('SELECT * FROM bike_retired_components WHERE bike_id = ? AND component_id = ? ORDER BY data_substituicao DESC, created_at DESC').all(id, compId)
      : fastify.db.prepare('SELECT * FROM bike_retired_components WHERE bike_id = ? ORDER BY data_substituicao DESC, created_at DESC').all(id);
    const items = rows.map(rowToRetired);

    // Agregado por tipo+marca: nº de trocas, km médio rodado, nota média.
    const groups = new Map();
    for (const r of items) {
      const key = r.tipo + '|' + (r.marca || '');
      if (!groups.has(key)) {
        groups.set(key, { tipo: r.tipo, marca: r.marca || '', modelos: new Set(), trocas: 0, kmSum: 0, kmN: 0, ratingSum: 0, ratingN: 0 });
      }
      const g = groups.get(key);
      g.trocas++;
      if (r.modelo) g.modelos.add(r.modelo);
      if (r.kmRodado != null && isFinite(r.kmRodado)) { g.kmSum += r.kmRodado; g.kmN++; }
      if (r.rating != null) { g.ratingSum += r.rating; g.ratingN++; }
    }
    const aggregates = [...groups.values()].map(g => ({
      tipo:        g.tipo,
      marca:       g.marca,
      modelos:     [...g.modelos],
      trocas:      g.trocas,
      kmMedia:     g.kmN ? Math.round(g.kmSum / g.kmN) : null,
      ratingMedia: g.ratingN ? +(g.ratingSum / g.ratingN).toFixed(1) : null,
    })).sort((a, b) => b.trocas - a.trocas);

    return { items, aggregates };
  });

  // ── Marcas/modelos já usados (datalist no formulário) ────────────────
  fastify.get('/api/bikes/meta/brands', async () => {
    const q = (sql) => fastify.db.prepare(sql).all().map(r => Object.values(r)[0]).filter(Boolean);
    const marcas = q("SELECT DISTINCT marca FROM bike_components WHERE marca <> ''")
      .concat(q("SELECT DISTINCT marca FROM bike_retired_components WHERE marca <> ''"));
    const modelos = q("SELECT DISTINCT modelo FROM bike_components WHERE modelo <> ''")
      .concat(q("SELECT DISTINCT modelo FROM bike_retired_components WHERE modelo <> ''"));
    const uniq = (a) => [...new Set(a)].sort((x, y) => String(x).localeCompare(String(y)));
    return { marcas: uniq(marcas), modelos: uniq(modelos) };
  });

  // ── Intervalos de serviço recorrentes ───────────────────────────────
  // Criar intervalo num componente
  fastify.post('/api/bikes/:id/components/:cid/intervals', async (req, reply) => {
    const { id, cid } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const comp = fastify.db.prepare('SELECT * FROM bike_components WHERE id = ?').get(cid);
    if (!comp) return reply.code(404).send({ error: 'componente nao encontrado' });
    const body = req.body || {};
    const nome = String(body.nome || '').trim();
    const base = body.base === 'dias' ? 'dias' : 'km';
    const intervalo = parseFloat(body.intervalo);
    if (!nome) return reply.code(400).send({ error: 'nome obrigatorio' });
    if (!isFinite(intervalo) || intervalo <= 0) return reply.code(400).send({ error: 'intervalo > 0 obrigatorio' });

    const kmBike = calcBikeKm(fastify.db, bike);
    const intId  = `bsi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dataLast = base === 'dias' ? todayISO() : null;
    fastify.db.prepare(`INSERT INTO bike_service_intervals
      (id, component_id, nome, base, intervalo, km_at_last, data_last)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(intId, cid, nome, base, intervalo, kmBike, dataLast);
    const row = fastify.db.prepare('SELECT * FROM bike_service_intervals WHERE id = ?').get(intId);
    return reply.code(201).send(rowToInterval(row, kmBike));
  });

  // Editar intervalo
  fastify.put('/api/bikes/:id/components/:cid/intervals/:iid', async (req, reply) => {
    const { id, iid } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    const cur  = fastify.db.prepare('SELECT * FROM bike_service_intervals WHERE id = ?').get(iid);
    if (!cur) return reply.code(404).send({ error: 'intervalo nao encontrado' });
    const body = req.body || {};
    const nome = body.nome != null ? String(body.nome).trim() : cur.nome;
    const base = body.base ? (body.base === 'dias' ? 'dias' : 'km') : cur.base;
    const intervalo = isFinite(parseFloat(body.intervalo)) ? parseFloat(body.intervalo) : cur.intervalo;
    if (!nome) return reply.code(400).send({ error: 'nome obrigatorio' });
    if (intervalo <= 0) return reply.code(400).send({ error: 'intervalo > 0 obrigatorio' });
    fastify.db.prepare('UPDATE bike_service_intervals SET nome = ?, base = ?, intervalo = ? WHERE id = ?')
      .run(nome, base, intervalo, iid);
    const kmBike = calcBikeKm(fastify.db, bike);
    return rowToInterval(fastify.db.prepare('SELECT * FROM bike_service_intervals WHERE id = ?').get(iid), kmBike);
  });

  // Deletar intervalo
  fastify.delete('/api/bikes/:id/components/:cid/intervals/:iid', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM bike_service_intervals WHERE id = ?').run(req.params.iid);
    if (info.changes === 0) return reply.code(404).send({ error: 'intervalo nao encontrado' });
    return { ok: true };
  });

  // Registrar serviço — reseta o contador (km_at_last + data_last) e loga
  fastify.post('/api/bikes/:id/components/:cid/intervals/:iid/register', async (req, reply) => {
    const { id, cid, iid } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const interval = fastify.db.prepare('SELECT * FROM bike_service_intervals WHERE id = ?').get(iid);
    if (!interval) return reply.code(404).send({ error: 'intervalo nao encontrado' });

    const kmBike = calcBikeKm(fastify.db, bike);
    const data   = (req.body && req.body.data) ? String(req.body.data).slice(0, 10) : todayISO();
    const notas  = String((req.body && req.body.notas) || `Serviço: ${interval.nome}`);
    const logId  = `bml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tx = fastify.db.transaction(() => {
      fastify.db.prepare('UPDATE bike_service_intervals SET km_at_last = ?, data_last = ? WHERE id = ?')
        .run(kmBike, data, iid);
      fastify.db.prepare(`INSERT INTO bike_maintenance_log
        (id, bike_id, component_id, tipo_evento, data, km_bike, notas)
        VALUES (?, ?, ?, 'limpeza', ?, ?, ?)`)
        .run(logId, id, cid, data, kmBike, notas);
    });
    tx();
    return rowToInterval(fastify.db.prepare('SELECT * FROM bike_service_intervals WHERE id = ?').get(iid), kmBike);
  });

  // ── Revisão completa — zera contadores de limpeza, mantém desgaste ───
  fastify.post('/api/bikes/:id/revisao-completa', async (req, reply) => {
    const { id } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });

    const kmBike = calcBikeKm(fastify.db, bike);
    const data = (req.body && req.body.data) ? String(req.body.data).slice(0, 10) : todayISO();
    const notas = String((req.body && req.body.notas) || '');
    const logId = `bml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tx = fastify.db.transaction(() => {
      fastify.db.prepare(
        'UPDATE bike_components SET km_at_last_clean = ? WHERE bike_id = ? AND tem_limpeza = 1'
      ).run(kmBike, id);
      fastify.db.prepare(`INSERT INTO bike_maintenance_log
        (id, bike_id, component_id, tipo_evento, data, km_bike, notas)
        VALUES (?, ?, NULL, 'revisao_completa', ?, ?, ?)`)
        .run(logId, id, data, kmBike, notas);
    });
    tx();
    return { ok: true, kmBike };
  });

  // ── Histórico de manutenção da bike ──────────────────────────────────
  fastify.get('/api/bikes/:id/maintenance-log', async (req, reply) => {
    const { id } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const rows = fastify.db.prepare(`
      SELECT l.*, c.tipo AS component_tipo
      FROM bike_maintenance_log l
      LEFT JOIN bike_components c ON c.id = l.component_id
      WHERE l.bike_id = ? ORDER BY l.data DESC, l.created_at DESC
    `).all(id);
    return rows.map(r => ({
      ...rowToLog(r),
      componentTipo: r.component_tipo || null,
    }));
  });
}

module.exports = routes;
