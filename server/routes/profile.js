/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/profile (perfil singleton) + /api/user/avatar
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs   = require('fs');
const { requireAuth } = require('../middleware/auth');

// Campos conhecidos do perfil (singleton). PUT /api/profile descarta chaves
// fora desta lista E valor com tipo/faixa invalidos — antes so a chave era
// checada, entao uma string arbitraria chegava crua ao banco e voltava para
// dentro de atributos HTML no frontend (BUG-056, XSS armazenado).
// Cada validador devolve o valor NORMALIZADO ou undefined para descartar.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const num = (min, max) => (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const str = (max) => (v) =>
  typeof v === 'string' && v.length <= max ? v : undefined;
const isoDate = (v) =>
  typeof v === 'string' && ISO_DATE.test(v) ? v : undefined;

const PROFILE_FIELDS = {
  nome:            str(120),
  dataNascimento:  isoDate,
  dataInicioPlano: isoDate,
  sexo:            (v) => (v === 'm' || v === 'f' ? v : undefined),
  altura:          num(50, 300),
  pesoAtual:       num(10, 600),
  pesoMeta:        num(10, 600),
  bikePeso:        num(1, 100),
  bikeModelo:      str(120),
  fcMax:           num(80, 250),
  hasAvatar:       (v) => (typeof v === 'boolean' ? v : undefined),
  // ISO string vinda do proprio POST /api/user/avatar (nao e' numero); vai
  // parar num ?ts= de cache-busting, entao basta ser string curta.
  avatarUpdatedAt: str(40),
};
const ALLOWED_PROFILE_KEYS = new Set(Object.keys(PROFILE_FIELDS));
const MAX_PROFILE_BYTES = 16 * 1024; // perfil e pequeno; teto generoso

const AVATAR_DIR  = path.resolve(__dirname, '..', '..', 'data', 'avatars');
const AVATAR_JPG  = path.join(AVATAR_DIR, 'avatar.jpg');
const AVATAR_PNG  = path.join(AVATAR_DIR, 'avatar.png');
const MAX_BYTES   = 3 * 1024 * 1024;        // 3 MB

if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

// ── dimensoes via parse de header (sem dependencias) ─────────────
function pngDims(buf) {
  // Assinatura: 89 50 4E 47 0D 0A 1A 0A, IHDR comeca em offset 8
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504E47) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}
function jpegDims(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const marker = buf[i + 1];
    i += 2;
    // SOF0..SOF15 exceto DHT(C4) DAC(CC) RST(C8 final) -> SOF: C0-CF excluindo C4, C8, CC
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      // segment: length(2) + precision(1) + height(2) + width(2)
      const h = buf.readUInt16BE(i + 3);
      const w = buf.readUInt16BE(i + 5);
      return { w, h };
    }
    const segLen = buf.readUInt16BE(i);
    i += segLen;
  }
  return null;
}

function clearAvatars() {
  for (const f of [AVATAR_JPG, AVATAR_PNG]) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
}

function currentAvatarPath() {
  if (fs.existsSync(AVATAR_PNG)) return { file: AVATAR_PNG, mime: 'image/png' };
  if (fs.existsSync(AVATAR_JPG)) return { file: AVATAR_JPG, mime: 'image/jpeg' };
  return null;
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/api/profile', async () => {
    const row = fastify.db
      .prepare('SELECT payload FROM user_profile WHERE id = 1')
      .get();
    if (!row) return {};
    try { return JSON.parse(row.payload); } catch (e) {
      fastify.log.warn({ err: e }, 'profile payload corrompido no banco — retornando vazio');
      return {};
    }
  });

  fastify.put('/api/profile', async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'payload invalido' });
    }
    // Mantem apenas campos conhecidos COM valor valido; loga o que caiu, para
    // nao mascarar nem campo novo do frontend fora da whitelist nem valor que
    // o cliente acha que salvou. Chave nula/vazia limpa o campo (o modal de
    // perfil envia '' para "sem valor").
    const clean = {};
    const dropped = [];
    const invalid = [];
    for (const k of Object.keys(body)) {
      if (!ALLOWED_PROFILE_KEYS.has(k)) { dropped.push(k); continue; }
      const raw = body[k];
      if (raw === null || raw === undefined || raw === '') continue;
      const val = PROFILE_FIELDS[k](raw);
      if (val === undefined) invalid.push(k);
      else clean[k] = val;
    }
    if (dropped.length) {
      fastify.log.warn({ dropped }, 'PUT /api/profile: campos desconhecidos descartados');
    }
    if (invalid.length) {
      fastify.log.warn({ invalid }, 'PUT /api/profile: valores invalidos descartados');
    }
    const json = JSON.stringify(clean);
    if (Buffer.byteLength(json, 'utf8') > MAX_PROFILE_BYTES) {
      return reply.code(413).send({ error: 'perfil muito grande' });
    }
    fastify.db
      .prepare(`INSERT INTO user_profile (id, payload, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`)
      .run(json);
    return clean;
  });

  // ── GET /api/user/avatar — serve a foto (publico-ish; precisa de auth) ──
  fastify.get('/api/user/avatar', async (req, reply) => {
    const cur = currentAvatarPath();
    if (!cur) return reply.code(404).send({ error: 'sem avatar' });
    reply.header('Content-Type', cur.mime);
    reply.header('Cache-Control', 'private, max-age=60');
    return reply.send(fs.createReadStream(cur.file));
  });

  // ── POST /api/user/avatar — upload base64 ────────────────────────
  // Body: { data: "<base64>", mime: "image/jpeg" | "image/png" }
  fastify.post('/api/user/avatar', {
    bodyLimit: 5 * 1024 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { data, mime } = req.body || {};
    if (!data || typeof data !== 'string') return reply.code(400).send({ error: 'data ausente' });
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      return reply.code(400).send({ error: 'mime invalido (use jpeg ou png)' });
    }
    let buf;
    try { buf = Buffer.from(data, 'base64'); }
    catch { return reply.code(400).send({ error: 'base64 invalido' }); }
    if (!buf.length) return reply.code(400).send({ error: 'arquivo vazio' });
    if (buf.length > MAX_BYTES) {
      return reply.code(413).send({ error: `arquivo maior que 3MB (${buf.length} bytes)` });
    }
    // Valida cabecalho e dimensoes (evita decompression bomb)
    const dims = mime === 'image/png' ? pngDims(buf) : jpegDims(buf);
    if (!dims) return reply.code(400).send({ error: 'cabecalho de imagem invalido' });
    const MAX_DIM = 4096;
    if (dims.w <= 0 || dims.h <= 0 || dims.w > MAX_DIM || dims.h > MAX_DIM) {
      return reply.code(400).send({ error: `dimensoes invalidas (${dims.w}x${dims.h}, max ${MAX_DIM}x${MAX_DIM})` });
    }
    clearAvatars();
    const dest = mime === 'image/png' ? AVATAR_PNG : AVATAR_JPG;
    fs.writeFileSync(dest, buf);
    const updatedAt = new Date().toISOString();
    return { ok: true, mime, bytes: buf.length, updatedAt };
  });

  // ── DELETE /api/user/avatar ──────────────────────────────────────
  fastify.delete('/api/user/avatar', async () => {
    clearAvatars();
    return { ok: true };
  });
}

module.exports = routes;
