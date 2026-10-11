/* ═══════════════════════════════════════════════════════════════════════
   ROTAS — /api/backup
   GET  /api/backup/data-zip       → baixa training.db + avatars/ em ZIP (download direto)
   POST /api/backup/snapshot       → escreve snapshot em data/backups/ (Fase 13.1.1)
   GET  /api/backup/list           → lista snapshots disponíveis  (Fase 13.1.2)
   GET  /api/backup/file/:name     → download de snapshot específico (Fase 13.1.2)
   POST /api/backup/restore        → restaura training.db a partir de um ZIP (Fase 15.1)
═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const Database = require('better-sqlite3');
const archiver = require('archiver');
const { requireAuth } = require('../middleware/auth');

const DATA_DIR    = path.resolve(__dirname, '..', '..', 'data');
const DB_FILE     = path.join(DATA_DIR, 'training.db');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const RESTORE_TMP = path.join(DATA_DIR, 'restore-tmp');
const RETENTION   = 8;  // mantém últimos 8 snapshots (≈ 2 meses semanais)
const RESTORE_MAX = 50 * 1024 * 1024;  // 50 MB — limite do upload de restore

// Transição treino-bike → veloce (#16): gera snapshots com o prefixo/app NOVOS,
// mas list/restore aceitam também os LEGADOS para não perder os backups que já
// existem em produção nem travar o restore de um ZIP antigo.
const SNAP_PREFIX   = 'veloce-data-';
const SNAP_NAME_RE  = /^(?:veloce|treino-bike)-data-\d{4}-\d{2}-\d{2}\.zip$/;  // whitelist de download
const SNAP_LIST_RE  = /^(?:veloce|treino-bike)-data-.+\.zip$/;                 // filtro da listagem
const BACKUP_APP          = 'veloce';                 // gravado no METADATA dos novos
const BACKUP_APP_ACCEPTED = ['veloce', 'treino-bike']; // aceitos no restore

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Cria pasta backups/ se não existir (idempotente)
function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// Lista snapshots ordenados do mais novo para o mais antigo.
// Ordem primária por nome (que começa com YYYY-MM-DD — estável e robusto
// contra cliques no mesmo segundo); mtime apenas como desempate.
function listSnapshots() {
  ensureBackupsDir();
  return fs.readdirSync(BACKUPS_DIR)
    .filter(n => SNAP_LIST_RE.test(n))
    .map(n => {
      const full = path.join(BACKUPS_DIR, n);
      const st = fs.statSync(full);
      return { name: n, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => {
      const byName = b.name.localeCompare(a.name);
      return byName !== 0 ? byName : b.mtime.localeCompare(a.mtime);
    });
}

// Gera um ZIP no caminho informado (usado por snapshot CLI e endpoint POST)
function buildZipToFile(destPath, fastify) {
  return new Promise((resolve, reject) => {
    try { fastify.db.pragma('wal_checkpoint(TRUNCATE)'); }
    catch (e) { /* não fatal */ }

    const out = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    out.on('close', () => resolve({ path: destPath, size: archive.pointer() }));
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[snapshot] warn', err); });
    archive.on('error', reject);

    archive.pipe(out);
    if (fs.existsSync(DB_FILE))     archive.file(DB_FILE, { name: 'training.db' });
    if (fs.existsSync(AVATARS_DIR)) archive.directory(AVATARS_DIR, 'avatars');
    archive.append(JSON.stringify({
      app: BACKUP_APP,
      version: require('../package.json').version,
      exportedAt: new Date().toISOString(),
      kind: 'snapshot',
      contents: ['training.db', 'avatars/'],
      excluded: ['garmin_session/ (tokens sensiveis)'],
    }, null, 2), { name: 'METADATA.json' });
    archive.finalize();
  });
}

// Apaga snapshots além dos mais recentes (mantém RETENTION).
// Guard: nunca apaga o snapshot do dia atual, mesmo se algum sort
// embaralhar a ordem (BUG-010).
function pruneSnapshots() {
  const list = listSnapshots();
  if (list.length <= RETENTION) return [];
  const todaySnap = `${SNAP_PREFIX}${todayISO()}.zip`;
  const toDelete = list.slice(RETENTION).filter(f => f.name !== todaySnap);
  for (const f of toDelete) {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, f.name)); }
    catch (e) { console.warn('[snapshot/prune]', f.name, e); }
  }
  return toDelete.map(f => f.name);
}

// Remove recursivamente um diretório (idempotente, tolera ausência).
function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignora */ }
}

// Valida que um arquivo é um SQLite íntegro e tem o schema esperado.
// Abre numa conexão readonly separada (não toca o banco vivo). Lança em erro.
function assertValidDb(dbPath) {
  if (!fs.existsSync(dbPath)) throw new Error('training.db ausente no ZIP');
  let probe;
  try {
    probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = probe.pragma('integrity_check', { simple: false });
    const ok = Array.isArray(rows) && rows.length === 1 && rows[0]?.integrity_check === 'ok';
    if (!ok) throw new Error('integrity_check falhou no banco do ZIP');
    // Sanidade do schema: tabela singleton do perfil deve existir.
    const t = probe.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_profile'"
    ).get();
    if (!t) throw new Error('estrutura inesperada (user_profile ausente)');
  } finally {
    try { probe && probe.close(); } catch (e) { /* ignora */ }
  }
}

// Reinicia o serviço via systemd (db é reaberto limpo no boot por db/init.js).
// Roda destacado para sobreviver ao SIGTERM que o próprio restart dispara.
function scheduleRestart(log) {
  setTimeout(() => {
    try {
      const child = spawn('sudo', ['-n', 'systemctl', 'restart', 'veloce-api'], {
        detached: true, stdio: 'ignore',
      });
      child.on('error', (e) => {
        log && log.error({ err: e }, 'restart via systemctl falhou; saindo com código 1');
        process.exit(1);  // Restart=on-failure cobre o fallback
      });
      child.unref();
    } catch (e) {
      log && log.error({ err: e }, 'spawn systemctl lançou; saindo com código 1');
      process.exit(1);
    }
  }, 600);
}

async function routes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // Parser de corpo bruto para o upload do ZIP de restore. Escopo do plugin
  // backup apenas — não interfere nas demais rotas. bodyLimit dedicado (50MB).
  fastify.addContentTypeParser(
    'application/zip',
    { parseAs: 'buffer', bodyLimit: RESTORE_MAX },
    (req, body, done) => done(null, body)
  );

  // Download imediato (já existia)
  fastify.get('/api/backup/data-zip', async (req, reply) => {
    try { fastify.db.pragma('wal_checkpoint(TRUNCATE)'); }
    catch (e) { req.log.warn({ err: e }, 'wal_checkpoint pre-zip falhou'); }

    const filename = `${SNAP_PREFIX}${todayISO()}.zip`;
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('warning', (err) => { if (err.code !== 'ENOENT') req.log.warn({ err }, 'archiver warning'); });
    archive.on('error', (err) => req.log.error({ err }, 'archiver error'));

    if (fs.existsSync(DB_FILE))     archive.file(DB_FILE, { name: 'training.db' });
    if (fs.existsSync(AVATARS_DIR)) archive.directory(AVATARS_DIR, 'avatars');
    archive.append(JSON.stringify({
      app: BACKUP_APP,
      version: require('../package.json').version,
      exportedAt: new Date().toISOString(),
      contents: ['training.db', 'avatars/'],
      excluded: ['garmin_session/ (tokens sensiveis)'],
    }, null, 2), { name: 'METADATA.json' });
    archive.finalize();

    return reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(archive);
  });

  // Cria snapshot no filesystem (chamado por timer ou via UI manualmente)
  // Rate-limit: zip nivel 9 e' caro; o limite e' opt-in no server/index.js.
  fastify.post('/api/backup/snapshot', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    ensureBackupsDir();
    const filename = `${SNAP_PREFIX}${todayISO()}.zip`;
    const fullPath = path.join(BACKUPS_DIR, filename);
    try {
      const result = await buildZipToFile(fullPath, fastify);
      const removed = pruneSnapshots();
      return { ok: true, file: filename, size: result.size, removed };
    } catch (err) {
      req.log.error({ err }, 'snapshot error');
      return reply.code(500).send({ ok: false, error: 'Não foi possível gerar o backup agora. Tente novamente em alguns minutos.' });
    }
  });

  // Lista snapshots disponíveis
  fastify.get('/api/backup/list', async () => ({ items: listSnapshots() }));

  // Download de snapshot por nome (com proteção contra path traversal)
  fastify.get('/api/backup/file/:name', async (req, reply) => {
    const name = String(req.params.name || '');
    // Whitelist estrita: veloce-data- (novo) ou treino-bike-data- (legado).
    if (!SNAP_NAME_RE.test(name)) {
      return reply.code(400).send({ error: 'nome inválido' });
    }
    const full = path.join(BACKUPS_DIR, name);
    // Segurança extra: confirma que resolve dentro de BACKUPS_DIR
    if (!full.startsWith(BACKUPS_DIR + path.sep)) {
      return reply.code(400).send({ error: 'path traversal' });
    }
    if (!fs.existsSync(full)) return reply.code(404).send({ error: 'não encontrado' });
    return reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .send(fs.createReadStream(full));
  });

  // Restaura training.db (e avatars) a partir de um ZIP enviado.
  // Fluxo: valida → backup pré-restore → fecha banco → swap → reinicia.
  // Rate-limit apertado: a rota troca o banco e REINICIA o servico. Em laco
  // (ex.: via XSS autenticado) deixaria a API em ciclo de restart.
  fastify.post('/api/backup/restore', {
    config: { rateLimit: { max: 2, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return reply.code(400).send({ error: 'corpo vazio — envie um .zip' });
    }
    // Assinatura ZIP ("PK\x03\x04")
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return reply.code(400).send({ error: 'arquivo não é um ZIP válido' });
    }

    ensureBackupsDir();
    rmrf(RESTORE_TMP);
    fs.mkdirSync(RESTORE_TMP, { recursive: true });
    const zipPath     = path.join(RESTORE_TMP, 'upload.zip');
    const extractDir  = path.join(RESTORE_TMP, 'extracted');

    try {
      // 1. Grava e extrai (unzip CLI, sem shell)
      fs.writeFileSync(zipPath, buf);
      fs.mkdirSync(extractDir, { recursive: true });
      try {
        execFileSync('unzip', ['-o', '-q', zipPath, '-d', extractDir], { timeout: 30000 });
      } catch (e) {
        req.log.error({ err: e }, 'unzip falhou');
        return reply.code(400).send({ error: 'falha ao extrair o ZIP' });
      }

      // 2. Valida METADATA (backup do veloce; aceita também o legado treino-bike)
      const metaPath = path.join(extractDir, 'METADATA.json');
      if (!fs.existsSync(metaPath)) {
        return reply.code(400).send({ error: 'METADATA.json ausente — não parece um backup do Veloce' });
      }
      let meta;
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
      catch { return reply.code(400).send({ error: 'METADATA.json corrompido' }); }
      if (!BACKUP_APP_ACCEPTED.includes(meta.app)) {
        return reply.code(400).send({ error: `backup de outro app (${meta.app || '?'})` });
      }

      // 3. Valida o training.db do ZIP (conexão readonly isolada)
      const newDbPath = path.join(extractDir, 'training.db');
      try {
        assertValidDb(newDbPath);
      } catch (e) {
        req.log.warn({ err: e }, 'db do ZIP inválido');
        return reply.code(400).send({ error: 'Banco de dados inválido no arquivo de backup.' });
      }

      // 4. Backup pré-restore do banco atual (segurança / rollback manual)
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const preRestore = path.join(BACKUPS_DIR, `pre-restore-${ts}.db`);
      try { fastify.db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* não fatal */ }
      try {
        fs.copyFileSync(DB_FILE, preRestore);
      } catch (e) {
        req.log.error({ err: e }, 'falha ao criar backup pré-restore');
        return reply.code(500).send({ error: 'não foi possível salvar backup de segurança; restore abortado' });
      }

      // 5. Fecha o banco vivo e faz o swap do arquivo.
      try { fastify.db.close(); } catch (e) { req.log.warn({ err: e }, 'db.close pré-swap'); }
      try {
        fs.copyFileSync(newDbPath, DB_FILE);
        // Remove WAL/SHM antigos para não misturar com o banco restaurado.
        for (const ext of ['-wal', '-shm']) {
          try { fs.unlinkSync(DB_FILE + ext); } catch (e) { /* pode não existir */ }
        }
        // Avatars (opcional) — substitui o diretório se presente no ZIP.
        const newAvatars = path.join(extractDir, 'avatars');
        if (fs.existsSync(newAvatars) && fs.statSync(newAvatars).isDirectory()) {
          rmrf(AVATARS_DIR);
          fs.cpSync(newAvatars, AVATARS_DIR, { recursive: true });
        }
      } catch (e) {
        // Rollback: restaura o banco a partir do backup pré-restore.
        req.log.error({ err: e }, 'swap do banco falhou — tentando rollback');
        try { fs.copyFileSync(preRestore, DB_FILE); } catch (e2) { req.log.error({ err: e2 }, 'ROLLBACK FALHOU'); }
        return reply.code(500).send({ error: 'falha no swap do banco; rollback aplicado. Serviço será reiniciado.' });
      }

      // 6. Sucesso — responde e agenda reinício (banco reabre limpo no boot).
      req.log.info({ meta, preRestore: path.basename(preRestore) }, 'restore aplicado; reiniciando');
      scheduleRestart(req.log);
      return {
        ok: true,
        restart: true,
        preRestore: path.basename(preRestore),
        restoredFrom: { version: meta.version || null, exportedAt: meta.exportedAt || null },
      };
    } finally {
      // Limpeza do tmp (não falha o restore se der erro aqui)
      rmrf(RESTORE_TMP);
    }
  });
}

// Exporta helpers para o script CLI standalone usar
module.exports = routes;
module.exports.buildZipToFile = buildZipToFile;
module.exports.pruneSnapshots = pruneSnapshots;
module.exports.listSnapshots  = listSnapshots;
module.exports.BACKUPS_DIR    = BACKUPS_DIR;
