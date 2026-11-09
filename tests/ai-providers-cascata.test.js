'use strict';
// Cascata de provedores de IA (#159) — o laço de candidatos de gerarAnalise,
// o validador opcional e o orçamento de tokens do Groq.
//
// Por que este arquivo existe: tests/treino-ia-job.test.js substitui o módulo
// ai-providers INTEIRO pelo require.cache, então até aqui o laço de candidatos,
// a seleção de modelo e o corpo enviado a cada provedor nunca rodaram em teste
// nenhum. Foi o ponto cego que deixou a #159 passar — mesma forma do ponto cego
// da #137, onde todo teste criava SQLite novo e o bug de migração era invisível.
//
// Aqui o ai-providers é o REAL; o que é falseado é o global.fetch.
const test = require('node:test');
const assert = require('node:assert');

// env ANTES dos requires: config.js aborta o processo sem estes três, e as
// chaves precisam existir ou a cascata sai por 'sem_chave' sem tentar nada.
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASS_HASH = '$2b$12$ZSJrjrNAiKHPNUWEbcoteeCmdEQXDRVhfz7fbTPIxpQRWGzHilBT2';
process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY = 'chave-gemini-ficticia';
process.env.GROQ_API_KEY = 'chave-groq-ficticia';

const GEMINI_MODELS = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_MODELS   = 'https://api.groq.com/openai/v1/models';
const GROQ_CHAT     = 'https://api.groq.com/openai/v1/chat/completions';

const aiPath = require.resolve('../server/services/ai-providers.js');

// ai-providers mantém, em escopo de módulo, o cache de lista de modelos e o
// _ultimoSucesso. Recarregar o módulo é o que torna os casos independentes —
// sem isso o primeiro teste decidiria a ordem de candidatos dos seguintes.
function moduloLimpo() {
  delete require.cache[aiPath];
  return require(aiPath);
}

const fetchOriginal = global.fetch;
let chamadas = [];
let handler = () => { throw new Error('handler não configurado neste teste'); };

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  chamadas.push({ url: u, body });
  return handler(u, body);
};

test.after(() => { global.fetch = fetchOriginal; });

function resp(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

const listaGemini = (...nomes) => resp({
  models: nomes.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })),
});
const listaGroq = (...ids) => resp({ data: ids.map((id) => ({ id })) });
const respGemini = (texto) => resp({ candidates: [{ content: { parts: [{ text: texto }] } }] });
const respGroq = (texto, finish = 'stop') => resp({ choices: [{ message: { content: texto }, finish_reason: finish }] });

// Validador no mesmo espírito do parseRespostaIA: exige JSON com `dias`.
const validarPlano = (texto) => {
  const o = JSON.parse(texto);              // lança em texto não-JSON
  if (!Array.isArray(o.dias)) throw new Error('dias ausente');
  return o;
};

const PLANO_OK = JSON.stringify({ objetivo: 'ok', dias: [1, 2, 3, 4, 5, 6, 7] });
const LIXO = '{"objetivo":"cortado no meio","dias":[{"dia":"segunda"';

function modeloDaUrlGemini(u) {
  const m = u.match(/\/models\/([^:]+):generateContent/);
  return m ? m[1] : null;
}

test('validador rejeitando o 1º candidato: a cascata usa o SEGUINTE', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini('gemini-flash-latest', 'gemini-2.5-flash');
    const model = modeloDaUrlGemini(u);
    if (model === 'gemini-flash-latest') return respGemini(LIXO);
    if (model === 'gemini-2.5-flash') return respGemini(PLANO_OK);
    throw new Error('url inesperada: ' + u);
  };

  const r = await gerarAnalise('prompt', validarPlano);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.model, 'gemini-2.5-flash', 'devia ter descartado o 1º e seguido para o 2º');
  assert.equal(r.texto, PLANO_OK);
});

test('todos os candidatos inválidos: lança com .cascata detalhando cada um', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini('gemini-flash-latest', 'gemini-2.5-flash');
    if (u === GROQ_MODELS) return listaGroq('openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    if (u === GROQ_CHAT) return respGroq(LIXO);
    if (modeloDaUrlGemini(u)) return respGemini(LIXO);
    throw new Error('url inesperada: ' + u);
  };

  await assert.rejects(
    () => gerarAnalise('prompt', validarPlano),
    (err) => {
      const invalidos = err.cascata.filter((e) => e.motivo === 'resposta_invalida');
      assert.equal(invalidos.length, 4, 'as 4 tentativas (2 Gemini + 2 Groq) devem constar');
      // O bruto de CADA candidato precisa estar ali: é o que permite diagnosticar
      // pelo log sem reproduzir (foi assim que a #159 foi diagnosticada).
      assert.ok(invalidos.every((e) => e.bruto && e.bruto.includes('cortado no meio')));
      assert.ok(invalidos.every((e) => e.provider && e.model));
      return true;
    },
  );
});

test('Groq cortado no limite (finish_reason length) é falha do candidato, não resposta', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  let nChat = 0;
  handler = (u) => {
    // Gemini sem modelos elegíveis → a cascata cai direto no Groq.
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini();
    if (u === GROQ_MODELS) return listaGroq('openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    if (u === GROQ_CHAT) {
      nChat += 1;
      // 1º candidato: JSON COMPLETO, mas marcado como cortado. Se o
      // finish_reason fosse ignorado, este corpo passaria no validador e o
      // teste não distinguiria nada — é de propósito.
      return nChat === 1 ? respGroq(PLANO_OK, 'length') : respGroq(PLANO_OK, 'stop');
    }
    throw new Error('url inesperada: ' + u);
  };

  const r = await gerarAnalise('prompt', validarPlano);
  assert.equal(nChat, 2, 'o candidato cortado devia ter sido descartado e o próximo tentado');
  assert.equal(r.model, 'qwen/qwen3.8-27b');
});

test('corpo enviado ao Groq carrega max_completion_tokens e reasoning_effort', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini();
    if (u === GROQ_MODELS) return listaGroq('openai/gpt-oss-120b');
    if (u === GROQ_CHAT) return respGroq(PLANO_OK);
    throw new Error('url inesperada: ' + u);
  };

  await gerarAnalise('prompt', validarPlano);

  const chat = chamadas.find((c) => c.url === GROQ_CHAT);
  assert.ok(chat, 'devia ter havido uma chamada de chat ao Groq');
  assert.equal(chat.body.max_completion_tokens, 8192, 'sem orçamento de saída o JSON de 7 dias sai truncado (#159)');
  assert.equal(chat.body.reasoning_effort, 'low', 'reasoning divide o orçamento com o content (#159)');
  assert.equal(chat.body.model, 'openai/gpt-oss-120b');
});

test('sem validador o comportamento é o anterior: devolve o texto como veio', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini('gemini-flash-latest');
    if (modeloDaUrlGemini(u)) return respGemini(LIXO);
    throw new Error('url inesperada: ' + u);
  };

  // É o caminho da Análise de Performance e do relatório mensal, que toleram
  // resposta fora de JSON (caem para o texto cru). A malha da #159 não pode
  // tê-los contaminado.
  const r = await gerarAnalise('prompt');
  assert.equal(r.texto, LIXO);
  assert.equal(r.model, 'gemini-flash-latest');
  assert.equal(chamadas.filter((c) => modeloDaUrlGemini(c.url)).length, 1, 'não devia retentar sem validador');
});

test('_ultimoSucesso guarda o modelo que VALIDOU, não o que respondeu primeiro', async () => {
  chamadas = [];
  const ai = moduloLimpo();   // mesma instância nas duas rodadas, de propósito
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini('gemini-flash-latest', 'gemini-2.5-flash');
    const model = modeloDaUrlGemini(u);
    if (model === 'gemini-flash-latest') return respGemini(LIXO);
    if (model === 'gemini-2.5-flash') return respGemini(PLANO_OK);
    throw new Error('url inesperada: ' + u);
  };

  const r1 = await ai.gerarAnalise('prompt', validarPlano);
  assert.equal(r1.model, 'gemini-2.5-flash');

  // 2ª rodada: candidatosParaProvider põe _ultimoSucesso na frente. Se ele
  // tivesse sido gravado antes de validar, a fila começaria pelo modelo que
  // devolveu lixo e toda geração seguinte desperdiçaria uma tentativa nele.
  chamadas = [];
  const r2 = await ai.gerarAnalise('prompt', validarPlano);
  assert.equal(r2.model, 'gemini-2.5-flash');

  const primeiroChat = chamadas.map((c) => modeloDaUrlGemini(c.url)).filter(Boolean)[0];
  assert.equal(primeiroChat, 'gemini-2.5-flash', 'a fila devia começar pelo modelo que validou');
});

/* ── #163: fila completa de candidatos e orçamento de tempo ──────────────
   O teto de 2 candidatos por provedor era o defeito. Medido em produção em
   2026-11-09: no Gemini as cinco primeiras posições falhavam por cinco
   motivos diferentes (timeout, 400, 429 e dois 404 de modelo aposentado) e o
   primeiro modelo que respondia era o SEXTO. Com teto de 2, o provedor
   principal ficava 100% indisponível com um modelo bom esperando na fila — e
   a resiliência da cascata escondia isso, porque o fallback segurava tudo. */

test('#163: a cascata vai ALÉM do 2º candidato até achar um que responde', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  // Reproduz a forma do que foi medido: 5 mortos, o 6º vivo.
  // Todos com "flash" no nome para caírem no MESMO padrão de preferência: aí a
  // ordem da fila é a ordem da lista, e o teste mede o alcance da cascata em
  // vez de medir a ordenação dos padrões (que é outro assunto).
  const modelos = ['f1-flash', 'f2-flash', 'f3-flash', 'f4-flash', 'f5-flash', 'f6-flash'];
  const falhas = { 'f1-flash': 503, 'f2-flash': 400, 'f3-flash': 429, 'f4-flash': 404, 'f5-flash': 404 };
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini(...modelos);
    const model = modeloDaUrlGemini(u);
    if (falhas[model]) return resp({ error: { status: 'ERRO' } }, falhas[model]);
    if (model === 'f6-flash') return respGemini(PLANO_OK);
    throw new Error('url inesperada: ' + u);
  };

  const r = await gerarAnalise('prompt', validarPlano);
  assert.equal(r.model, 'f6-flash', 'com o teto antigo de 2 a cascata morreria no f2');
  const tentados = chamadas.map((c) => modeloDaUrlGemini(c.url)).filter(Boolean);
  assert.equal(tentados.length, 6, 'tentou os 6 em ordem: ' + tentados.join(','));
});

test('#163: tentativas falhas vêm JUNTO com o sucesso (provedor morto deixa rastro)', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini('quebrado-flash', 'bom-flash');
    const model = modeloDaUrlGemini(u);
    if (model === 'quebrado-flash') return resp({ error: { status: 'UNAVAILABLE' } }, 503);
    return respGemini(PLANO_OK);
  };

  const r = await gerarAnalise('prompt', validarPlano);
  assert.equal(r.model, 'bom-flash');
  // É este campo que faltava: antes, falha num caminho de SUCESSO era
  // descartada em silêncio e o Gemini pôde ficar dias a zero sem sintoma.
  assert.ok(Array.isArray(r.tentativasFalhas), 'o sucesso tem de carregar as falhas que atravessou');
  assert.equal(r.tentativasFalhas.length, 1);
  assert.equal(r.tentativasFalhas[0].model, 'quebrado-flash');
  assert.match(String(r.tentativasFalhas[0].detalhe), /503/);
});

test('#163: sucesso limpo não inventa tentativasFalhas', async () => {
  chamadas = [];
  const { gerarAnalise } = moduloLimpo();
  handler = (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini('bom-flash');
    return respGemini(PLANO_OK);
  };
  const r = await gerarAnalise('prompt', validarPlano);
  assert.equal(r.tentativasFalhas.length, 0, 'array vazio, não falha fantasma');
});

test('#163: o orçamento de tempo limita a fila — não é ilimitada', async () => {
  chamadas = [];
  process.env.AI_CASCATA_BUDGET_MS = '120';   // lido no load do módulo
  const { gerarAnalise } = moduloLimpo();
  delete process.env.AI_CASCATA_BUDGET_MS;

  const muitos = Array.from({ length: 40 }, (_, i) => 'm' + i + '-flash');
  handler = async (u) => {
    if (u.startsWith(GEMINI_MODELS + '?')) return listaGemini(...muitos);
    if (u === GROQ_MODELS) return listaGroq();
    await new Promise((r) => setTimeout(r, 40));     // cada tentativa custa 40ms
    return resp({ error: { status: 'ERRO' } }, 500);
  };

  await assert.rejects(() => gerarAnalise('prompt', validarPlano), (err) => {
    const tentados = chamadas.filter((c) => modeloDaUrlGemini(c.url)).length;
    assert.ok(tentados < 40, 'o orçamento tem de cortar a fila; tentou ' + tentados);
    assert.ok(err.cascata.some((e) => e.motivo === 'orcamento_esgotado'),
      'e o motivo tem de ficar explícito na cascata: ' + JSON.stringify(err.cascata.slice(-2)));
    return true;
  });
});
