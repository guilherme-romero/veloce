'use strict';
// Job automático do Treino IA (#136) — as três peças que o scheduler chama:
// montarInsumos, planoGeradoHoje e lerPerfilTreinoIa. Mesmo molde de
// tests/push-digest.test.js: env ANTES dos requires (config/db-init leem no
// 1º require), SQLite temporário, service chamado direto.
//
// O que NÃO está coberto aqui, e declaro em vez de fingir: o encadeamento
// dentro de setup() (setInterval e os guards de dia/hora). Testá-lo exigiria
// falsear o relógio do processo. Cubro as peças, não o agendamento.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-treino-ia-'));
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASS_HASH = '$2b$12$ZSJrjrNAiKHPNUWEbcoteeCmdEQXDRVhfz7fbTPIxpQRWGzHilBT2';
process.env.JWT_SECRET = 'test-secret';
process.env.DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'training.db');

// Fuso FIXO, e não o da máquina. O guard de duplicata compara um
// CURRENT_TIMESTAMP (UTC) com o dia LOCAL, então em TZ=UTC — o default de
// container, que é o que a CI usa — local e UTC coincidem e os testes de fuso
// ficariam vacuamente verdes: sabotar a conversão não os derrubaria. São
// Paulo não tem horário de verão desde 2019, então isto é determinístico.
process.env.TZ = 'America/Sao_Paulo';

// Stub de ai-providers instalado ANTES de requerer o service, para testar o
// caminho de falha de IA sem rede e sem gastar cota. `respostaIa` controla o
// comportamento por teste; nenhum outro teste deste arquivo chama a IA.
let respostaIa = () => { throw new Error('gerarAnalise não deveria ser chamada neste teste'); };
const aiPath = require.resolve('../server/services/ai-providers.js');
require.cache[aiPath] = {
  id: aiPath, filename: aiPath, path: path.dirname(aiPath), loaded: true, children: [], paths: [],
  exports: { gerarAnalise: async (...args) => respostaIa(...args) },
};

const db = require('../server/db/init.js');
const svc = require('../server/services/weekly-training-plan.js');
const { Metrics, WeightStats } = require('../server/utils/core-modules.js');
const { getUnifiedActivities } = require('../server/services/activities.js');

test.after(() => {
  try { db.close(); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

const DIA_MS = 86400_000;
const isoAtras = (n) => new Date(Date.now() - n * DIA_MS).toISOString().slice(0, 10);

function limpar() {
  db.prepare('DELETE FROM garmin_activities').run();
  db.prepare('DELETE FROM weights').run();
  db.prepare('DELETE FROM user_profile').run();
  db.prepare('DELETE FROM weekly_training_plans').run();
}

function salvarPerfil(obj) {
  db.prepare('INSERT OR REPLACE INTO user_profile (id, payload) VALUES (1, ?)').run(JSON.stringify(obj));
}

function semearAtividades() {
  const ins = db.prepare(`INSERT INTO garmin_activities
    (id_garmin, nome, tipo, data_inicio, inicio_local, tempo_mov_s, fc_media, distancia_m, elevacao_m)
    VALUES (?, 'Pedal', 'cycling', ?, ?, ?, ?, ?, ?)`);
  // Dentro da janela de 60 dias que calcTSBMetrics olha — fora dela o CTL
  // sairia zero e o teste perderia o sentido.
  [2, 5, 9, 14, 20, 27, 35].forEach((atras, i) => {
    const d = isoAtras(atras);
    ins.run(1000 + i, d, `${d}T06:00:00`, 3600 + i * 600, 138 + i, 30000, 300);
  });
}

const PERFIL_COMPLETO = {
  nome: 'Tester',
  fcMax: 185,
  pesoMeta: 78,
  objetivosPrioridade: ['performance'],
  diasDisponiveis: ['segunda', 'quarta', 'sabado'],
  duracaoSessaoMin: 60,
  diaLongao: 'sabado',
  nivelExperiencia: 'intermediario',
};

// ── montarInsumos ───────────────────────────────────────────────────────
test('montarInsumos: CTL/ATL/TSB saem do banco com números REAIS', () => {
  limpar();
  salvarPerfil(PERFIL_COMPLETO);
  semearAtividades();

  const insumos = svc.montarInsumos(db);

  // O ponto do teste: o shape do banco (tempo_mov_s/fc_media) é mapeado por
  // getUnifiedActivities para tempoMovS/fcMedia, que é o que tssDeAtividade
  // consome. Se algum desses nomes divergir, calcTSBMetrics devolve ZERO sem
  // erro nenhum e o prompt da IA vai mentir em silêncio — nenhuma leitura de
  // código pega isso, só a comparação com o cálculo direto.
  const { items } = getUnifiedActivities(db, 365);
  const esperado = Metrics.calcTSBMetrics(items, PERFIL_COMPLETO.fcMax);

  assert.equal(items.length, 7, 'as 7 atividades semeadas viraram items');
  assert.ok(insumos.ctl > 0, `CTL precisa ser > 0, veio ${insumos.ctl}`);
  assert.ok(insumos.atl > 0, `ATL precisa ser > 0, veio ${insumos.atl}`);
  assert.equal(insumos.ctl, esperado.ctl);
  assert.equal(insumos.atl, esperado.atl);
  assert.equal(insumos.tsb, esperado.tsb);
});

test('montarInsumos: sem fcMax, CTL é null e não zero', () => {
  limpar();
  salvarPerfil({ ...PERFIL_COMPLETO, fcMax: undefined });
  semearAtividades();

  const insumos = svc.montarInsumos(db);
  // Zero no prompt ("CTL: 0") afirmaria carga nenhuma; null omite a linha.
  assert.equal(insumos.ctl, null);
  assert.equal(insumos.atl, null);
  assert.equal(insumos.tsb, null);
});

test('montarInsumos: tendência de peso é exatamente a de weightAnalysis', () => {
  limpar();
  salvarPerfil(PERFIL_COMPLETO);
  const ins = db.prepare("INSERT INTO weights (data, peso, tipo, fonte) VALUES (?, ?, ?, 'manual')");
  ins.run(isoAtras(30), 84, 'atual');
  ins.run(isoAtras(20), 83, 'atual');
  ins.run(isoAtras(10), 82, 'atual');
  ins.run(isoAtras(2), 81.2, 'atual');
  // Pesagem 'historico' no meio: dailyWeights precisa IGNORÁ-LA. Se um dia
  // alguém trocar o filtro, a taxa muda e este teste cai.
  ins.run(isoAtras(15), 95, 'historico');

  const insumos = svc.montarInsumos(db);
  const esperado = WeightStats.weightAnalysis(
    JSON.parse(db.prepare('SELECT payload FROM user_profile WHERE id=1').get().payload),
    db.prepare('SELECT data, peso, tipo FROM weights ORDER BY data ASC').all(),
  );

  assert.ok(esperado.ok, 'a regressão fecha com os dados semeados');
  assert.ok(insumos.tendenciaPeso, 'tendenciaPeso preenchido');
  assert.equal(insumos.tendenciaPeso.taxaKgSem, esperado.taxaKgSem);
  assert.equal(insumos.tendenciaPeso.msg, esperado.msg);
  assert.ok(insumos.tendenciaPeso.taxaKgSem < 0, 'peso caindo → taxa negativa');
});

test('montarInsumos: msg longa é truncada em 200 (sanitizarInsumos fecha a saída)', () => {
  // Garantia estrutural: montarInsumos termina em sanitizarInsumos, a mesma
  // função que trata o body do POST. Aqui exercito o contrato direto, porque
  // weight-stats hoje só produz literais curtos — o teste protege o caso de
  // alguém passar a interpolar algo longo lá.
  const longa = 'x'.repeat(500);
  const out = svc.sanitizarInsumos({ ctl: 1, tendenciaPeso: { taxaKgSem: -0.5, msg: longa } });
  assert.equal(out.tendenciaPeso.msg.length, 200);
  assert.equal(out.atl, null, 'campo ausente vira null, não undefined');
});

test('montarInsumos: limiares é null por decisão de escopo (#136)', () => {
  limpar();
  salvarPerfil(PERFIL_COMPLETO);
  semearAtividades();
  // O cálculo mora no closure da rota /api/garmin/calibration e renderia uma
  // linha no prompt. Se alguém extrair aquilo para um service, este assert
  // cai — de propósito: é o lembrete de atualizar montarInsumos junto.
  assert.equal(svc.montarInsumos(db).limiares, null);
});

test('montarInsumos: banco vazio não lança, devolve tudo null', () => {
  limpar();
  const insumos = svc.montarInsumos(db);
  assert.deepEqual(insumos, { ctl: null, atl: null, tsb: null, tendenciaPeso: null, limiares: null });
});

test('montarInsumos: perfil com fcMax mas sem atividades devolve ZERO, não null', () => {
  limpar();
  salvarPerfil(PERFIL_COMPLETO);
  const insumos = svc.montarInsumos(db);
  // Documentando o que é: calcTSBMetrics devolve zeros com lista vazia, e o
  // frontend se comporta igual — paridade deliberada, não descuido. É
  // diferente do caso "sem fcMax", que devolve null porque ali o número não
  // existe em vez de ser realmente zero.
  assert.equal(insumos.ctl, 0);
  assert.equal(insumos.tsb, 0);
  assert.equal(insumos.tendenciaPeso, null, 'sem pesagens não há tendência');
});

// ── planoGeradoHoje (critério de aceite nº 2) ───────────────────────────
const inserirPlano = (geradoEm, ativo = 1) => db
  .prepare('INSERT INTO weekly_training_plans (ativo, payload, gerado_em) VALUES (?, ?, ?)')
  .run(ativo, JSON.stringify({ objetivo: 'x', dias: [] }), geradoEm);

// gerado_em é CURRENT_TIMESTAMP do SQLite: 'YYYY-MM-DD HH:MM:SS' em UTC.
const tsUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

test('planoGeradoHoje: tabela vazia → false', () => {
  limpar();
  assert.equal(svc.planoGeradoHoje(db), false);
});

test('planoGeradoHoje: plano de agora → true (bloqueia o 2º slot e o restart)', () => {
  limpar();
  inserirPlano(tsUtc(new Date()));
  assert.equal(svc.planoGeradoHoje(db), true);
});

test('planoGeradoHoje: plano de ontem → false (a segunda seguinte gera)', () => {
  limpar();
  inserirPlano(tsUtc(new Date(Date.now() - DIA_MS)));
  assert.equal(svc.planoGeradoHoje(db), false);
});

test('planoGeradoHoje: compara em dia LOCAL, não em UTC', () => {
  limpar();
  // Timestamps FIXOS, não derivados da hora em que o teste roda: 2026-11-03
  // 02:30 UTC é 2026-11-02 23:30 em São Paulo. Quem lê o gerado_em como hora
  // local (sem o 'Z'), ou compara pelo dia UTC, conclui "03" e devolve false.
  inserirPlano('2026-11-03 02:30:00');
  const local2330 = new Date(2026, 10, 2, 23, 30, 0);
  assert.equal(svc.planoGeradoHoje(db, local2330), true,
    'o plano das 23:30 locais é do MESMO dia local, embora seja o dia seguinte em UTC');

  // E o espelho: 2026-11-02 02:30 UTC é 2026-11-01 23:30 local — dia local
  // anterior, então não bloqueia.
  limpar();
  inserirPlano('2026-11-02 02:30:00');
  assert.equal(svc.planoGeradoHoje(db, local2330), false, 'véspera em dia local não bloqueia');
});

test('planoGeradoHoje: olha a última linha inserida, não a ativa', () => {
  limpar();
  // Cenário real: o job gerou hoje e depois o usuário reativou um plano
  // antigo pelo popup "Planos anteriores" — ativo=1 volta para a linha
  // velha. Um guard baseado em `ativo` liberaria uma 2ª geração no mesmo dia.
  inserirPlano(tsUtc(new Date(Date.now() - 30 * DIA_MS)), 1);
  inserirPlano(tsUtc(new Date()), 0);
  assert.equal(svc.planoGeradoHoje(db), true);
});

// ── Falha de IA preserva o plano ativo (critério de aceite nº 4) ────────
test('gerarEArmazenarPlano: cascata de IA falhando NÃO desativa o plano atual', async () => {
  limpar();
  salvarPerfil(PERFIL_COMPLETO);
  inserirPlano(tsUtc(new Date(Date.now() - 7 * DIA_MS)), 1);
  const antes = svc.lerCacheAtivo(db);

  const erro = Object.assign(new Error('todos os provedores falharam'), { cascata: ['gemini', 'groq'] });
  respostaIa = () => { throw erro; };

  await assert.rejects(
    () => svc.gerarEArmazenarPlano(db, { perfil: svc.lerPerfilTreinoIa(db), insumos: svc.montarInsumos(db) }),
    /provedores falharam/,
  );

  // É o que o usuário vê: a semana continua com o plano que já tinha, em vez
  // de ficar sem nenhum porque a IA caiu. Depende de a transação de
  // UPDATE ativo=0 + INSERT vir DEPOIS da chamada de IA.
  const depois = svc.lerCacheAtivo(db);
  assert.ok(depois, 'ainda existe plano ativo');
  assert.equal(depois.id, antes.id, 'é o mesmo plano de antes');
  assert.equal(depois.ativo, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM weekly_training_plans').get().n, 1,
    'nenhuma linha nova foi inserida');

  respostaIa = () => { throw new Error('gerarAnalise não deveria ser chamada neste teste'); };
});

// ── lerPerfilTreinoIa (critério de aceite nº 3) ─────────────────────────
test('lerPerfilTreinoIa: perfil completo devolve só os campos do intake', () => {
  limpar();
  salvarPerfil(PERFIL_COMPLETO);
  const p = svc.lerPerfilTreinoIa(db);
  assert.deepEqual(Object.keys(p).sort(), [
    'diaLongao', 'diasDisponiveis', 'duracaoSessaoMin', 'nivelExperiencia', 'objetivosPrioridade',
  ]);
  assert.equal(p.diaLongao, 'sabado');
  assert.equal(p.nome, undefined, 'nome não entra no prompt por este caminho');
});

test('lerPerfilTreinoIa: intake incompleto → null (job loga e pula)', () => {
  for (const faltando of ['diaLongao', 'nivelExperiencia', 'duracaoSessaoMin', 'diasDisponiveis', 'objetivosPrioridade']) {
    limpar();
    const perfil = { ...PERFIL_COMPLETO };
    delete perfil[faltando];
    salvarPerfil(perfil);
    assert.equal(svc.lerPerfilTreinoIa(db), null, `sem ${faltando} precisa dar null`);
  }
});

test('lerPerfilTreinoIa: valor fora do enum é descartado → null', () => {
  limpar();
  salvarPerfil({ ...PERFIL_COMPLETO, nivelExperiencia: 'semideus' });
  assert.equal(svc.lerPerfilTreinoIa(db), null);
});

test('lerPerfilTreinoIa: payload corrompido ou perfil ausente → null, sem lançar', () => {
  limpar();
  assert.equal(svc.lerPerfilTreinoIa(db), null, 'sem linha');
  db.prepare('INSERT INTO user_profile (id, payload) VALUES (1, ?)').run('{isto não é json');
  assert.equal(svc.lerPerfilTreinoIa(db), null, 'JSON quebrado');
});
