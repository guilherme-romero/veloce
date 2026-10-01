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
const MODEL_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

// Até 2 candidatos: [modelo-que-funcionou-da-última-vez (se mesmo
// provider), melhor-modelo-pelo-padrão, segundo-melhor-pelo-padrão] —
// dedupe. O 2o candidato também respeita PADROES_PREFERIDOS (percorre os
// padrões em ordem antes de aceitar qualquer modelo cru da lista), pra não
// escolher algo "preview"/"deprecated" só por ser o próximo item bruto.
function candidatosParaProvider(provider, modelosAoVivo) {
  const candidatos = [];
  if (_ultimoSucesso && _ultimoSucesso.provider === provider && modelosAoVivo.includes(_ultimoSucesso.model)) {
    candidatos.push(_ultimoSucesso.model);
  }
  for (const padrao of PADROES_PREFERIDOS) {
    const achado = modelosAoVivo.find((m) => padrao(m) && !candidatos.includes(m));
    if (achado) candidatos.push(achado);
    if (candidatos.length >= 2) break;
  }
  if (candidatos.length < 2) {
    const alternativa = modelosAoVivo.find((m) => !candidatos.includes(m));
    if (alternativa) candidatos.push(alternativa);
  }
  return candidatos.slice(0, 2);
}

async function chamarGemini(apiKey, model, prompt) {
  const url = `${GEMINI_MODELS_URL}/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
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
  if (!texto) throw new Error('Gemini não devolveu texto');
  return texto.trim();
}

async function chamarGroq(apiKey, model, prompt) {
  const resp = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    const err = new Error(`Groq respondeu ${resp.status}`);
    err.upstreamStatus = resp.status;
    err.upstreamBody = corpo.slice(0, 500);
    throw err;
  }
  const json = await resp.json();
  const texto = json?.choices?.[0]?.message?.content;
  if (!texto) throw new Error('Groq não devolveu texto');
  return texto.trim();
}

/**
 * Cascata de até 4 tentativas: até 2 modelos Gemini, depois até 2 modelos
 * Groq. Qualquer erro do modelo atual (4xx/5xx/timeout) é tratado como
 * sinal pra tentar o próximo candidato — não há confirmação de documentação
 * sobre um código de erro específico pra "modelo descontinuado" em nenhum
 * dos dois provedores (ADR-0004).
 * @return {{ texto: string, provider: 'gemini'|'groq', model: string }}
 * @throws {Error} com .cascata = [{ provider, model?, motivo, ... }] quando
 *   todos os provedores falharem (inclusive por falta de chave).
 */
async function gerarAnalise(prompt) {
  const providers = [
    { nome: 'gemini', apiKey: config.GEMINI_API_KEY, listar: listarModelosGemini, chamar: chamarGemini },
    { nome: 'groq', apiKey: config.GROQ_API_KEY, listar: listarModelosGroq, chamar: chamarGroq },
  ];
  const erros = [];
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
      try {
        const texto = await p.chamar(p.apiKey, model, prompt);
        _ultimoSucesso = { provider: p.nome, model };
        return { texto, provider: p.nome, model };
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
