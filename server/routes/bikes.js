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
    createdAt:          c.created_at,
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

/* ──────────────────────────────────────────────────────────────────────
   Cálculo central — km total acumulado pela bike
   km_inicial + soma de distâncias Garmin + Strava desde active_since
─────────────────────────────────────────────────────────────────────── */
// Tipos excluídos do acumulado de km da bike: e-bike e indoor/virtual
// contam para fitness mas não desgastam a bike física.
const EXCLUDED_STRAVA_TYPES = "('VirtualRide','EBikeRide')";
const EXCLUDED_GARMIN_TYPES = "('virtual_ride','indoor_cycling','e_bike_fitness')";

function calcBikeKm(db, bike) {
  const base = +(bike.km_inicial || 0);
  if (!bike.active_since) return +base.toFixed(1);
  const garmin = db.prepare(
    `SELECT COALESCE(SUM(distancia_m), 0) AS t
     FROM garmin_activities
     WHERE data_inicio >= ?
       AND (tipo IS NULL OR tipo NOT IN ${EXCLUDED_GARMIN_TYPES})`
  ).get(bike.active_since).t / 1000;
  const strava = db.prepare(
    `SELECT COALESCE(SUM(distancia_m), 0) AS t
     FROM strava_activities s
     LEFT JOIN activity_links l ON l.strava_id = s.id_strava
     WHERE s.data_inicio >= ?
       AND l.strava_id IS NULL
       AND (s.tipo IS NULL OR s.tipo NOT IN ${EXCLUDED_STRAVA_TYPES})`
  ).get(bike.active_since).t / 1000;
  return +(base + garmin + strava).toFixed(1);
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
    return bikes.map(b => ({ ...rowToBike(b), kmTotal: calcBikeKm(fastify.db, b) }));
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
    return reply.code(201).send({ ...rowToBike(row), kmTotal: calcBikeKm(fastify.db, row) });
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
    return { ...rowToBike(row), kmTotal: calcBikeKm(fastify.db, row) };
  });

  // ── Deletar bike (cascade em componentes e log) ──────────────────────
  fastify.delete('/api/bikes/:id', async (req, reply) => {
    const info = fastify.db.prepare('DELETE FROM bikes WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return reply.code(404).send({ error: 'bike nao encontrada' });
    return { ok: true };
  });

  // ── Ativar bike (única) — desativa todas as outras ───────────────────
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

    const tx = fastify.db.transaction(() => {
      fastify.db.prepare('UPDATE bikes SET active = 0').run();
      fastify.db.prepare('UPDATE bikes SET active = 1, active_since = ? WHERE id = ?')
        .run(activeSince, id);
    });
    tx();
    const row = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    return { ...rowToBike(row), kmTotal: calcBikeKm(fastify.db, row) };
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
    return comps.map(c => {
      const dto = rowToComponent(c);
      dto.kmDesgastado = +(kmBike - dto.kmAtInstall).toFixed(1);
      dto.kmDesdeUltimaLimpeza = dto.temLimpeza
        ? +(kmBike - dto.kmAtLastClean).toFixed(1)
        : null;
      return dto;
    });
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

    try {
      fastify.db.prepare(`INSERT INTO bike_components
        (id, bike_id, tipo, vida_util_km, km_at_install, tem_limpeza, intervalo_limpeza_km, km_at_last_clean)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(body.id, id, n.tipo, n.vidaUtilKm, n.kmAtInstall, n.temLimpeza, n.intervaloLimpezaKm, kmAtLastClean);
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
      intervalo_limpeza_km = ?, km_at_last_clean = ? WHERE id = ?`)
      .run(n.tipo, n.vidaUtilKm, n.kmAtInstall, n.temLimpeza, n.intervaloLimpezaKm, n.kmAtLastClean, cid);
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

  // ── Substituir componente (zera desgaste + opcional nova vida útil) ──
  fastify.post('/api/bikes/:id/components/:cid/substituir', async (req, reply) => {
    const { id, cid } = req.params;
    const bike = fastify.db.prepare('SELECT * FROM bikes WHERE id = ?').get(id);
    if (!bike) return reply.code(404).send({ error: 'bike nao encontrada' });
    const comp = fastify.db.prepare('SELECT * FROM bike_components WHERE id = ?').get(cid);
    if (!comp) return reply.code(404).send({ error: 'componente nao encontrado' });

    const kmBike = calcBikeKm(fastify.db, bike);
    const data = (req.body && req.body.data) ? String(req.body.data).slice(0, 10) : todayISO();
    const notas = String((req.body && req.body.notas) || '');
    const novaVidaUtil = isFinite(parseFloat(req.body && req.body.vidaUtilKm))
      ? parseFloat(req.body.vidaUtilKm)
      : comp.vida_util_km;
    const logId = `bml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tx = fastify.db.transaction(() => {
      fastify.db.prepare(`UPDATE bike_components SET
        vida_util_km = ?, km_at_install = ?, km_at_last_clean = ? WHERE id = ?`)
        .run(novaVidaUtil, kmBike, kmBike, cid);
      fastify.db.prepare(`INSERT INTO bike_maintenance_log
        (id, bike_id, component_id, tipo_evento, data, km_bike, notas)
        VALUES (?, ?, ?, 'substituicao', ?, ?, ?)`)
        .run(logId, id, cid, data, kmBike, notas);
    });
    tx();
    return { ok: true, kmBike };
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
