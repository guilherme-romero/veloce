'use strict';
// Toggle de ativação por conexão (#135) — persistência no perfil + o gate que
// o scheduler consulta.
//
// O que justifica este arquivo: a semântica do campo é INVERTIDA em relação ao
// outro toggle do perfil. `relatorioMensalTelegram` é opt-in e usa `!!valor`,
// então ausente = desligado. Aqui ausente = LIGADO, porque o valor só existe
// depois que o usuário salva o Perfil, e tratar isso como desligado faria uma
// feature nova silenciar um sync que já funcionava. É o erro mais provável
// numa refatoração futura, e nenhum teste de rota pegaria sozinho.
const test = require('node:test');
const assert = require('node:assert');
const { buildTestApp, cleanup } = require('./app-harness.js');

let h, cookie, syncAutoLigado;
test.before(() => {
  h = buildTestApp();
  cookie = h.authCookie();
  // require DEPOIS do buildTestApp: server/config é singleton cacheado no 1º
  // require e aborta se o .env não estiver no ambiente — é o harness que o
  // injeta (ver tests/app-harness.js).
  ({ syncAutoLigado } = require('../server/scheduler.js'));
});
test.after(() => cleanup(h));

const salvarPerfil = (body) => h.app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: body });
const lerPerfil = async () => (await h.app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } })).json();

test('PUT /api/profile: aceita os dois toggles como booleano e persiste', async () => {
  const res = await salvarPerfil({ nome: 'Tester', stravaSyncAuto: false, garminSyncAuto: true });
  assert.equal(res.statusCode, 200);
  const perfil = await lerPerfil();
  assert.equal(perfil.stravaSyncAuto, false, 'false precisa sobreviver — não pode ser tratado como "vazio"');
  assert.equal(perfil.garminSyncAuto, true);
});

test('PUT /api/profile: valor não-booleano é descartado, não persiste lixo', async () => {
  // O PUT SUBSTITUI o payload (não mescla) — o frontend sempre envia o perfil
  // inteiro, e é por isso que ConnAuto.wire manda `{...getUser(), chave}`.
  // Aqui o que importa é que 'sim'/1 não cheguem ao banco: o scheduler lê
  // esses campos como booleano, e uma string num deles seria sempre truthy.
  const res = await salvarPerfil({ nome: 'Tester', stravaSyncAuto: 'sim', garminSyncAuto: 1 });
  assert.equal(res.statusCode, 200);
  const perfil = await lerPerfil();
  assert.equal(perfil.nome, 'Tester', 'o campo válido foi salvo');
  assert.equal(perfil.stravaSyncAuto, undefined, "'sim' não entrou no perfil");
  assert.equal(perfil.garminSyncAuto, undefined, '1 não entrou no perfil');
});

test('syncAutoLigado: chave AUSENTE significa LIGADO', async () => {
  // O caso que importa: perfil salvo sem nunca ter tocado no toggle. Se isto
  // devolvesse false, a #135 teria desligado o sync de todo mundo na subida.
  await salvarPerfil({ nome: 'Sem toggles' });
  const db = h.app.db;
  db.prepare('UPDATE user_profile SET payload = ? WHERE id=1').run(JSON.stringify({ nome: 'Sem toggles' }));
  assert.equal(syncAutoLigado(db, 'stravaSyncAuto'), true);
  assert.equal(syncAutoLigado(db, 'garminSyncAuto'), true);
});

test('syncAutoLigado: respeita o valor salvo, um provedor sem afetar o outro', () => {
  const db = h.app.db;
  db.prepare('UPDATE user_profile SET payload = ? WHERE id=1')
    .run(JSON.stringify({ stravaSyncAuto: false, garminSyncAuto: true }));
  assert.equal(syncAutoLigado(db, 'stravaSyncAuto'), false);
  assert.equal(syncAutoLigado(db, 'garminSyncAuto'), true, 'desligar o Strava não desliga o Garmin');

  db.prepare('UPDATE user_profile SET payload = ? WHERE id=1')
    .run(JSON.stringify({ stravaSyncAuto: true, garminSyncAuto: false }));
  assert.equal(syncAutoLigado(db, 'stravaSyncAuto'), true, 'e vice-versa');
  assert.equal(syncAutoLigado(db, 'garminSyncAuto'), false);
});

test('syncAutoLigado: payload corrompido ou linha ausente → LIGADO (falha segura)', () => {
  const db = h.app.db;
  // O modo de falha certo é continuar sincronizando: um JSON quebrado não pode
  // desligar uma integração sem o usuário ter pedido.
  db.prepare('UPDATE user_profile SET payload = ? WHERE id=1').run('{isto não é json');
  assert.equal(syncAutoLigado(db, 'stravaSyncAuto'), true, 'parse quebrado não desliga');

  db.prepare('DELETE FROM user_profile WHERE id=1').run();
  assert.equal(syncAutoLigado(db, 'garminSyncAuto'), true, 'perfil inexistente não desliga');
});
