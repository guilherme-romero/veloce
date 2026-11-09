/* ═══════════════════════════════════════════════════════════════════════
   AI PROVIDERS — Rotação de modelo de IA para a Análise de Performance
   (ADR-0004). Gemini é sempre o provedor principal; Groq só é tentado
   depois de esgotar as tentativas com o Gemini (Provedor de fallback,
   GLOSSARY.md).

   Nomes de modelo NUNCA são hardcoded: nomes saem de circulação em poucos
   meses (gemini-2.0-flash, usado na entrega original desta feature, foi
   descontinuado pelo Google 4 meses depois). Em vez disso, cada chamada
   descobre os modelos disponíveis em runtime via o endpoint de listagem
   de cada provedor, e escolhe o melhor por um padrão de nome preferido
   (nunca por parsing de número de versão — "3.8" vs "3.10" não ordena
   como string).
═══════════════════════════════════════════════════════════════════════ */
const config = require('../config');

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_MODELS_URL   = 'https://api.groq.com/openai/v1/models';
const GROQ_CHAT_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const CALL_TIMEOUT_MS   = 20_000;
// #163 — orçamento de tempo da cascata INTEIRA, que substituiu o teto fixo de
// 2 candidatos por provedor. O teto era o defeito: falha rápida (404 de modelo
// aposentado, 400, 429) custa ~0,3s e consumia a mesma cota de um timeout de
// 20s, então duas posições ruins no início da fila zeravam o provedor. Com
// orçamento, a cascata atravessa os mortos baratos e ainda alcança um modelo
// bom. 75s é folgado para o job das 6h e aceitável no clique manual, que já
// mostra estado de carregando.
// Ajustável por env: serve ao teste unitário (que não pode esperar 75s) e dá
// uma alavanca de operação sem deploy, caso um provedor fique lento.
const CASCATA_BUDGET_MS = Number(process.env.AI_CASCATA_BUDGET_MS) || 75_000;
const MODEL_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Orçamento de tokens de SAÍDA, um dono só para os dois provedores. Generoso
// porque o Treino IA pede um JSON de 7 dias — bem maior que a resposta curta
// da Análise de Performance. Nasceu embutido no Gemini e foi extraído na #159,
// quando o Groq (que não mandava orçamento algum) truncou o JSON do Treino IA
// em 3 de 4 tentativas observadas.
const MAX_TOKENS_SAIDA  = 8192;

// A listagem de modelos de cada provedor inclui variantes que NÃO são chat
// de texto (TTS, imagem, transcrição, classificadores de segurança/guard) —
// descoberto empiricamente em produção: o filtro antigo (só "não é preview/
// deprecated") escolheu "whisper-large-v3" (transcrição) e "canopylabs/
// orpheus-v1-english" (text-to-speech) como candidatos Groq. Excluir sempre,
// pros dois provedores, antes de aplicar qualquer padrão de preferência.
const EXCLUDE_NAO_TEXTO = /tts|image|vision|whisper|transcribe|audio|embed|moderation|guard|safety|safeguard|clip|lyria|robotics|computer-use|antigravity|deep-research|orpheus/i;

// Ordem = prioridade; primeiro padrão que bater em algum modelo (já filtrado
// por EXCLUDE_NAO_TEXTO) vence. Mesmo array serve pros dois provedores —
// cada padrão só "pega" nos nomes do provedor a que se aplica, os outros
// simplesmente não encontram match e caem pro próximo.
const PADROES_PREFERIDOS = [
  // Gemini mantém aliases "-latest" que a própria Google aponta pro modelo
  // recomendado do momento — escolher isso elimina o problema de
  // obsolescência de vez (nunca mais precisa saber o número da versão).
  (m) => /^gemini-(flash|pro)(-lite)?-latest$/i.test(m),
  // Groq: maior modelo open-weight da família gpt-oss, bom default de uso geral.
  (m) => /gpt-oss-120b/i.test(m),
  (m) => /flash/i.test(m) && !/preview|exp|deprecated/i.test(m),
  (m) => !/preview|exp|deprecated/i.test(m),
];

// Cache em memória, slot único por provedor — reinicia a cada deploy
// (mesmo trade-off já aceito pelo cache de calibração em garmin.js).
let _modelListCache = { gemini: null, groq: null }; // { modelos: string[], ts } | null
let _ultimoSucesso = null; // { provider: 'gemini'|'groq', model: string } | null

async function listarModelosGemini(apiKey) {
  const resp = await fetch(`${GEMINI_MODELS_URL}?key=${apiKey}`, {
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const err = new Error(`Gemini ListModels respondeu ${resp.status}`);
    err.upstreamStatus = resp.status;
    throw err;
  }
  const json = await resp.json();
  return (json.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .filter((m) => !EXCLUDE_NAO_TEXTO.test(m));
}

async function listarModelosGroq(apiKey) {
  const resp = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const err = new Error(`Groq ListModels respondeu ${resp.status}`);
    err.upstreamStatus = resp.status;
    throw err;
  }
  const json = await resp.json();
  return (json.data || [])
    .map((m) => m.id)
    .filter(Boolean)
    .filter((m) => !EXCLUDE_NAO_TEXTO.test(m));
}

async function obterModelosComCache(provider, fetcher, apiKey) {
  const cache = _modelListCache[provider];
  if (cache && (Date.now() - cache.ts) < MODEL_LIST_TTL_MS) return cache.modelos;
  const modelos = await fetcher(apiKey);
  _modelListCache[provider] = { modelos, ts: Date.now() };
  return modelos;
}

/**
 * Fila ORDENADA de candidatos de um provedor: [modelo-que-funcionou-da-última-
 * vez (se mesmo provider), depois todos os elegíveis em ordem de
 * PADROES_PREFERIDOS], com dedupe.
 *
 * #163 — esta função devolvia no máximo DOIS candidatos, e o teto era o
 * defeito. Medido em produção em 2026-11-09: no Gemini, as cinco primeiras
 * posições falhavam por cinco motivos diferentes — timeout, 400
 * INVALID_ARGUMENT, 429 RESOURCE_EXHAUSTED e dois 404 "no longer available" —
 * e o primeiro modelo que respondia era o SEXTO (`gemini-3.1-flash-lite`). Com
 * teto de 2, o provedor principal ficava 100% indisponível enquanto um modelo
 * bom esperava na fila, e a resiliência da cascata escondia isso.
 *
 * Quem limita o custo agora é o orçamento de TEMPO em gerarAnalise, não uma
 * contagem fixa: um 404 custa ~0,3s e não deveria consumir a mesma cota que um
 * timeout de 20s. Ordenar por número de versão continua proibido (ADR-0004:
 * "3.8" vs "3.10" não ordena como string).
 */
function candidatosParaProvider(provider, modelosAoVivo) {
  const candidatos = [];
  if (_ultimoSucesso && _ultimoSucesso.provider === provider && modelosAoVivo.includes(_ultimoSucesso.model)) {
    candidatos.push(_ultimoSucesso.model);
  }
  for (const padrao of PADROES_PREFERIDOS) {
    for (const m of modelosAoVivo) {
      if (padrao(m) && !candidatos.includes(m)) candidatos.push(m);
    }
  }
  // O último padrão aceita qualquer nome sem "preview/exp/deprecated", então
  // sobra pouco; o resto entra no fim para não deixar modelo elegível de fora.
  for (const m of modelosAoVivo) if (!candidatos.includes(m)) candidatos.push(m);
  return candidatos;
}

async function chamarGemini(apiKey, model, prompt, orcamentoMs = CALL_TIMEOUT_MS) {
  const url = `${GEMINI_MODELS_URL}/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // thinkingBudget:0 — modelos da família 2.5 "pensam" antes de responder,
    // consumindo uma fatia do orçamento de tokens de saída com texto interno
    // invisível; descoberto em produção truncando a resposta JSON do Treino
    // IA logo no primeiro campo. Modelos sem suporte a thinking ignoram o
    // parâmetro (compatibilidade futura da API, não gera erro 400).
    // O orçamento de saída vive em MAX_TOKENS_SAIDA (ver lá o porquê do valor).
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS_SAIDA, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(CALL_TIMEOUT_MS, orcamentoMs))),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    const err = new Error(`Gemini respondeu ${resp.status}`);
    err.upstreamStatus = resp.status;
    err.upstreamBody = corpo.slice(0, 500);
    throw err;
  }
  const json = await resp.json();
  const texto = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) {
    const finishReason = json?.candidates?.[0]?.finishReason;
    throw new Error('Gemini não devolveu texto' + (finishReason ? ` (finishReason: ${finishReason})` : ''));
  }
  return texto.trim();
}

async function chamarGroq(apiKey, model, prompt, orcamentoMs = CALL_TIMEOUT_MS) {
  const resp = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    // #159 — o par do que o Gemini já tinha, e que faltava aqui:
    //
    // max_completion_tokens: sem ele a resposta ficava no default do provedor,
    // e o JSON de 7 dias do Treino IA saía cortado no meio.
    //
    // reasoning_effort: análogo do thinkingBudget:0 do Gemini. Os modelos
    // gpt-oss/qwen3 do Groq "pensam" antes de responder, e o reasoning divide
    // o MESMO orçamento de saída com o content — medido em produção: 1201
    // tokens de reasoning numa chamada. Quando o reasoning cresce, é o JSON
    // que é cortado. Um modelo futuro que não aceite o parâmetro responde 400,
    // a cascata trata como falha deste candidato e segue para o próximo, com o
    // motivo preservado em err.upstreamBody abaixo.
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: MAX_TOKENS_SAIDA,
      reasoning_effort: 'low',
    }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(CALL_TIMEOUT_MS, orcamentoMs))),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    const err = new Error(`Groq respondeu ${resp.status}`);
    err.upstreamStatus = resp.status;
    err.upstreamBody = corpo.slice(0, 500);
    throw err;
  }
  const json = await resp.json();
  const escolha = json?.choices?.[0];
  // finish_reason 'length' = resposta cortada no limite de tokens. Devolver
  // esse corpo entregaria JSON truncado a quem chamou, e no Treino IA isso
  // morria no parseRespostaIA SEM retentativa (#159). Lançar transforma o
  // truncamento em falha deste candidato, e a cascata tenta o próximo. Mesma
  // postura do Gemini, que já expõe finishReason no erro de resposta vazia.
  if (escolha?.finish_reason === 'length') {
    throw new Error(`Groq cortou a resposta no limite de tokens (finish_reason: length, max_completion_tokens: ${MAX_TOKENS_SAIDA})`);
  }
  const texto = escolha?.message?.content;
  if (!texto) {
    throw new Error('Groq não devolveu texto' + (escolha?.finish_reason ? ` (finish_reason: ${escolha.finish_reason})` : ''));
  }
  return texto.trim();
}

/**
 * Cascata de até 4 tentativas: até 2 modelos Gemini, depois até 2 modelos
 * Groq. Qualquer erro do modelo atual (4xx/5xx/timeout) é tratado como
 * sinal pra tentar o próximo candidato — não há confirmação de documentação
 * sobre um código de erro específico pra "modelo descontinuado" em nenhum
 * dos dois provedores (ADR-0004).
 * `validar` é OPCIONAL e, quando dado, roda sobre o texto de cada candidato:
 * se lançar, aquele candidato conta como falha e a cascata segue para o
 * próximo — em vez de devolver um corpo que quem chamou vai rejeitar sozinho,
 * sem retentativa (era o bug da #159: um HTTP 200 cujo JSON não parseava
 * queimava a cascata inteira e a geração de segunda-feira não acontecia).
 * Vem por injeção, e não por import, porque o validador do Treino IA é o
 * parseRespostaIA de weekly-training-plan.js — que já requer este módulo.
 * Sem `validar`, o comportamento é idêntico ao anterior: é o caminho da
 * Análise de Performance e do relatório mensal, que toleram resposta fora de
 * JSON (caem para o texto cru) e por isso não querem esta malha.
 *
 * @param {string} prompt
 * @param {(texto: string) => unknown} [validar] lança para rejeitar o candidato
 * @return {{ texto: string, provider: 'gemini'|'groq', model: string }}
 * @throws {Error} com .cascata = [{ provider, model?, motivo, ... }] quando
 *   todos os provedores falharem (inclusive por falta de chave ou por nenhuma
 *   resposta ter passado em `validar`).
 */
async function gerarAnalise(prompt, validar) {
  const providers = [
    { nome: 'gemini', apiKey: config.GEMINI_API_KEY, listar: listarModelosGemini, chamar: chamarGemini },
    { nome: 'groq', apiKey: config.GROQ_API_KEY, listar: listarModelosGroq, chamar: chamarGroq },
  ];
  const erros = [];
  // #163 — prazo da cascata inteira. É o que permite a fila de candidatos ser
  // completa em vez de cortada em 2: falha barata não gasta o que um timeout
  // gastaria, e o pior caso continua limitado.
  const prazo = Date.now() + CASCATA_BUDGET_MS;
  const restante = () => prazo - Date.now();
  for (const p of providers) {
    if (!p.apiKey) {
      erros.push({ provider: p.nome, motivo: 'sem_chave' });
      continue;
    }
    let modelos;
    try {
      modelos = await obterModelosComCache(p.nome, p.listar, p.apiKey);
    } catch (err) {
      erros.push({ provider: p.nome, motivo: 'listagem_falhou', detalhe: err.message });
      continue;
    }
    if (!modelos.length) {
      erros.push({ provider: p.nome, motivo: 'lista_vazia' });
      continue;
    }
    for (const model of candidatosParaProvider(p.nome, modelos)) {
      if (restante() <= 0) {
        erros.push({ provider: p.nome, motivo: 'orcamento_esgotado' });
        break;   // passa ao próximo PROVEDOR: a chave dele pode estar sadia
      }
      try {
        const texto = await p.chamar(p.apiKey, model, prompt, restante());
        if (validar) {
          try {
            validar(texto);
          } catch (errVal) {
            // Falha de FORMATO, não de transporte: o modelo respondeu, mas o
            // corpo não serve. Conta como falha deste candidato e segue.
            erros.push({
              provider: p.nome, model, motivo: 'resposta_invalida',
              detalhe: errVal.message, bruto: String(texto).slice(0, 500),
            });
            continue;
          }
        }
        // Só depois de validar. Gravar antes fixaria como "último sucesso" um
        // modelo que devolveu lixo, e candidatosParaProvider começaria a
        // próxima geração justamente por ele.
        _ultimoSucesso = { provider: p.nome, model };
        // #163 — as tentativas falhas vão JUNTO com o sucesso. Antes elas só
        // apareciam em err.cascata quando TODOS falhavam, e num caminho de
        // sucesso eram descartadas em silêncio: foi por isso que o Gemini
        // ficou 100% indisponível por dias sem ninguém notar. Quem chama loga.
        return { texto, provider: p.nome, model, tentativasFalhas: erros };
      } catch (err) {
        erros.push({ provider: p.nome, model, motivo: 'chamada_falhou', status: err.upstreamStatus, detalhe: err.message });
      }
    }
  }
  const err = new Error('Todos os provedores de IA falharam');
  err.cascata = erros;
  throw err;
}

module.exports = { gerarAnalise };
