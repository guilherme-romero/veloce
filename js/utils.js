/* ═══════════════════════════════════════════════════════════════════════
   UTILS — funções auxiliares compartilhadas entre todos os módulos
═══════════════════════════════════════════════════════════════════════ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function escAttr(s) { return esc(s); }

window.esc     = esc;
window.escAttr = escAttr;

/* ── Avatar: foto remota com fallback automatico para iniciais ────────────
   Uso: Avatar.html({ src, name, size }) -> string HTML
   - src    : URL da imagem (opcional)
   - name   : texto p/ extrair iniciais (ex.: "Guilherme Romero")
   - size   : 'sm' | 'md' | 'lg' (default 'md')
   Se a imagem falhar (CSP, 403, sem URL), exibe iniciais sobre fundo neutro.
═════════════════════════════════════════════════════════════════════════ */
function _avatarInitials(name) {
  const txt = String(name || '').trim();
  if (!txt) return '?';
  const parts = txt.split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase().replace(/[^A-Z0-9]/g, '') || txt[0].toUpperCase();
}

function avatarHTML({ src, name, size = 'md', alt = '' } = {}) {
  const initials = _avatarInitials(name);
  const cls = `avatar avatar-${size}`;
  const fallback = `<div class="${cls} avatar-fallback">${esc(initials)}</div>`;
  if (!src) return fallback;
  // CSP (issue #19): onerror="..." inline não é mais permitido. O fallback
  // vai num atributo data-* (esc() já escapa aspas, seguro em atributo) e o
  // handler real é ligado depois via wireAvatarFallbacks() — propriedade JS
  // (img.onerror = fn), não atributo HTML, então CSP script-src não bloqueia.
  return `<img class="${cls} avatar-img" src="${esc(src)}" alt="${esc(alt)}" referrerpolicy="no-referrer" data-avatar-fallback="${esc(fallback)}">`;
}

// Liga o fallback de erro nas <img class="avatar-img"> dentro de `root`
// (document inteiro se omitido). Todo chamador que insere Avatar.html() no
// DOM via innerHTML DEVE chamar isso depois — sem isso, uma imagem quebrada
// fica com o ícone de imagem rota do navegador em vez do círculo de iniciais.
function wireAvatarFallbacks(root) {
  (root || document).querySelectorAll('img.avatar-img:not([data-avatar-wired])').forEach(img => {
    img.dataset.avatarWired = '1';
    img.onerror = () => { img.outerHTML = img.dataset.avatarFallback; };
  });
}

window.Avatar = { html: avatarHTML, initials: _avatarInitials, wireFallbacks: wireAvatarFallbacks };

/* ── Toggle "sync automático" dos cards de Conexões (#135) ─────────────
   Compartilhado por js/strava.js e js/garmin.js, que são IIFEs separadas.
   Vive aqui, e não num arquivo próprio, para não ter de entrar também no
   array SHELL do service-worker.js (addAll é atômico: uma entrada 404
   derruba o pré-cache inteiro — ver CLAUDE.md).

   O toggle gateia SÓ o sync automático do scheduler. Sync manual, login do
   Garmin e "Sincronizar tudo" da Home seguem funcionando desligado.  */
function connAutoLigado(chave) {
  // Ausente = ligado. `DEFAULTS.user` já garante isso em getUser(), mas a
  // checagem explícita protege chamadas antes do loadAll() do boot.
  const v = (window.Storage ? Storage.getUser() : {})[chave];
  return v === undefined ? true : !!v;
}

function connAutoHtml(inputId, chave) {
  return '<label class="conn-auto">' +
    `<input type="checkbox" id="${escAttr(inputId)}" ${connAutoLigado(chave) ? 'checked' : ''}>` +
    '<span>Sincronizar automaticamente</span>' +
  '</label>';
}

// `aoMudar` normalmente re-renderiza o card, porque desligar troca o estado
// exibido (some o erro vermelho) e ligar traz o estado real de volta.
function connAutoWire(inputId, chave, aoMudar) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('change', () => {
    if (window.Storage) Storage.setUser({ ...Storage.getUser(), [chave]: el.checked });
    if (typeof aoMudar === 'function') aoMudar(el.checked);
  });
}

window.ConnAuto = { ligado: connAutoLigado, html: connAutoHtml, wire: connAutoWire };

/* ── Componentes de bike — rótulo e desgaste (fonte única) ─────────────
   Mora aqui, e não dentro dos clientes de relatório, porque os DOIS
   (PDF e resumo do Telegram) são funções serializadas por toString() e
   injetadas em páginas separadas — mas as duas páginas carregam este
   arquivo antes, via assets().core em server/routes/report.js.

   Essa separação é literalmente a causa da Issue #142: a correção do
   rótulo custom e do critério de "vencido" entrou no cliente do resumo
   (#134) e não alcançou o do PDF, porque cada um tinha a sua cópia da
   tabela de rótulos. Com uma definição só, a próxima correção não tem
   como alcançar um e esquecer o outro.

   js/bikes.js mantém a tabela canônica (com vidaUtil e temLimpeza por
   tipo), que é usada pela UI; consolidar as duas é dívida registrada
   na #142.
═════════════════════════════════════════════════════════════════════════ */
const BIKE_COMP_LABELS = {
  pneu_dianteiro: 'Pneu dianteiro', pneu_traseiro: 'Pneu traseiro', corrente: 'Corrente',
  pastilha_diant: 'Pastilha dianteira', pastilha_tras: 'Pastilha traseira',
  disco_diant: 'Disco dianteiro', disco_tras: 'Disco traseiro', cassete: 'Cassete',
  cabo_freio: 'Cabo/Óleo de freio', outro: 'Outro',
};

/**
 * Nome legível de um tipo de componente. Componentes criados como "Outro
 * (novo)" têm tipo = 'custom:<id>' e o nome só existe em
 * /api/component-types — sem resolver, sai a chave crua
 * ("custom:ctype_1785877…") no relatório. Mesma regra do typeLabel() do
 * app (js/bikes.js:49-54).
 *
 * @param {string} tipo            — 'corrente', 'custom:ctype_x', …
 * @param {Array}  [tiposCustom]   — [{ id, nome }] de /api/component-types
 */
function bikeCompLabel(tipo, tiposCustom) {
  if (Object.hasOwn(BIKE_COMP_LABELS, tipo)) return BIKE_COMP_LABELS[tipo];
  const id = (typeof tipo === 'string' && tipo.startsWith('custom:')) ? tipo.slice(7) : null;
  const t = id && Array.isArray(tiposCustom) ? tiposCustom.find(x => x && x.id === id) : null;
  // Tipo custom excluído depois de usado: 'Outro' é melhor que a chave crua.
  return (t && t.nome) ? t.nome : (id ? 'Outro' : tipo);
}

/**
 * Fração de vida útil consumida (1 = vencido), ou null quando não dá para
 * calcular. Quem desenha a barra deve usar Math.floor sobre isto: com
 * Math.round, uma razão de 0,996 vira 100% e a barra marca "VENC."
 * enquanto um banner que filtra por `razão >= 1` não conta o componente —
 * a divergência da #142.
 */
function bikeCompRazaoUso(c) {
  if (!c || !(c.vidaUtilKm > 0) || c.kmDesgastado == null) return null;
  // kmDesgastado = kmBike - kmAtInstall (server/routes/bikes.js:221), então
  // fica NEGATIVO quando o km de instalação cadastrado é maior que o km atual
  // da bike — dado incoerente, não um componente zerado. Devolver null dá o
  // mesmo tratamento de "sem vida útil cadastrada": barra vazia e "—", em vez
  // de uma porcentagem negativa no relatório (#146).
  if (c.kmDesgastado < 0) return null;
  return c.kmDesgastado / c.vidaUtilKm;
}

window.BikeComp = { LABELS: BIKE_COMP_LABELS, label: bikeCompLabel, razaoUso: bikeCompRazaoUso };

/* ── Zonas de FC — fonte única de verdade ──────────────────────────────
   Espelha as cores das classes CSS .z1–.z6 em Fisiologia.
   Usado em qualquer gráfico ou UI que precise colorir por zona.
   Limites: percentuais da FCM (Karvonen simplificado).
═════════════════════════════════════════════════════════════════════════ */
window.FC_ZONES = [
  { id: 'z1', label: 'Z1', min: 0,    max: 0.60, color: '#4e9ef5', colorDim: 'rgba(78,158,245,0.25)',  desc: 'Recuperação Ativa' },
  { id: 'z2', label: 'Z2', min: 0.60, max: 0.70, color: '#f5d523', colorDim: 'rgba(245,213,35,0.25)',  desc: 'Base Aeróbica' },
  { id: 'z3', label: 'Z3', min: 0.70, max: 0.80, color: '#22c55e', colorDim: 'rgba(34,197,94,0.25)',   desc: 'Ritmo / Tempo' },
  { id: 'z4', label: 'Z4', min: 0.80, max: 0.90, color: '#f0523a', colorDim: 'rgba(240,82,58,0.25)',   desc: 'Limiar Anaeróbico' },
  { id: 'z5', label: 'Z5', min: 0.90, max: 1.00, color: '#a855f7', colorDim: 'rgba(168,85,247,0.25)',  desc: 'VO2 Máx' },
  { id: 'z6', label: 'Z6', min: 1.00, max: Infinity, color: '#ec4899', colorDim: 'rgba(236,72,153,0.25)', desc: 'Neuromuscular' },
];

/* ── dataLocalISO — fonte única de "YYYY-MM-DD no fuso LOCAL" (#151) ────
   Esta lógica estava copiada inline 11 vezes (frontend desktop, mobile,
   js/core/* e backend), sempre com alguma variação de escrita e às vezes
   com o mesmo comentário duplicado byte a byte. É a mesma causa raiz da
   #134/#142: duas cópias da tabela de rótulos fizeram a correção chegar ao
   resumo do Telegram e não ao PDF.

   Por que não `toISOString().slice(0,10)`: ele formata em UTC. Num fuso
   negativo (-03:00), das 21h à meia-noite o dia UTC já virou, então a
   "data de hoje" sairia adiantada em um dia — exatamente o BUG-#88.

   Aceita Date, timestamp ou string de data; devolve null para entrada que
   não vira data válida, em vez de "NaN-NaN-NaN" vazando para uma chave.
═════════════════════════════════════════════════════════════════════════ */
function dataLocalISO(entrada) {
  const d = (entrada instanceof Date) ? entrada
          : (entrada == null) ? new Date()
          : new Date(entrada);
  if (isNaN(d.getTime())) return null;
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/* ── mesLocalISO — mesma ideia, granularidade de mês ("YYYY-MM") ────────
   Padrão menor, 3 cópias (js/activities.js, server/routes/report.js,
   server/scheduler.js). O risco de borda é bem menor que o do dia (o mês
   só viraria errado nas últimas 3h do último dia), mas é a mesma lógica e
   não há motivo para ter duas fontes de verdade para o mesmo conceito.
═════════════════════════════════════════════════════════════════════════ */
function mesLocalISO(entrada) {
  const iso = dataLocalISO(entrada);
  return iso && iso.slice(0, 7);
}

/* ── Streak de treino — fonte única (home.js × heatmap.js) ──────────────
   Recebe lista de datas ISO (YYYY-MM-DD) de dias com treino. Uma semana
   "vale" com ≥ 2 dias DISTINTOS ativos; retorna { current, record } em nº
   de semanas consecutivas (domingo = início da semana). A semana atual em
   andamento não quebra a sequência enquanto ainda não qualifica.
═════════════════════════════════════════════════════════════════════════ */
function calcTrainingStreak(activeISODates) {
  const MIN_DIAS = 2;
  const _wkStart = (iso) => {
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() - d.getDay()); // getDay(): 0=dom
    return dataLocalISO(d);
  };
  const _prevWk = (wk) => {
    const d = new Date(wk + 'T12:00:00'); d.setDate(d.getDate() - 7);
    return dataLocalISO(d);
  };

  const semanas = {}; // weekISO -> Set de datas ativas distintas
  (activeISODates || []).forEach(iso => {
    if (!iso) return;
    const wk = _wkStart(iso);
    if (wk) (semanas[wk] || (semanas[wk] = new Set())).add(iso);
  });
  const qualifica = (wk) => (semanas[wk] ? semanas[wk].size : 0) >= MIN_DIAS;

  // RECORDE — maior nº de semanas consecutivas qualificadas no histórico.
  const wks = Object.keys(semanas).filter(qualifica).sort();
  let record = 0, run = 0, prev = null;
  for (const wk of wks) {
    run = (prev && _prevWk(wk) === prev) ? run + 1 : 1;
    record = Math.max(record, run);
    prev = wk;
  }

  // ATUAL — conta para trás a partir da semana corrente (local). Se ainda
  // não qualifica, começa pela anterior (não quebra a sequência em curso).
  const now = new Date();
  const todayISO = dataLocalISO(now);   // #151 — fonte única (mesmo arquivo)
  let cursor = _wkStart(todayISO);
  if (!qualifica(cursor)) cursor = _prevWk(cursor);
  let current = 0;
  while (qualifica(cursor)) { current++; cursor = _prevWk(cursor); }

  return { current, record };
}
// Ícones Font Awesome por código WMO (Open-Meteo) — compartilhado por Passeios
// (rides.js) e Rotas (routes.js). Fallback: parcialmente nublado.
const WMO_ICONS = {
  0:'fa-sun', 1:'fa-sun', 2:'fa-cloud-sun', 3:'fa-cloud',
  45:'fa-smog', 48:'fa-smog',
  51:'fa-cloud-sun-rain', 53:'fa-cloud-sun-rain', 55:'fa-cloud-sun-rain',
  61:'fa-cloud-rain', 63:'fa-cloud-rain', 65:'fa-cloud-showers-heavy',
  71:'fa-snowflake', 73:'fa-snowflake', 75:'fa-snowflake',
  80:'fa-cloud-rain', 81:'fa-cloud-rain', 82:'fa-cloud-showers-heavy',
  95:'fa-cloud-bolt', 96:'fa-cloud-bolt', 99:'fa-cloud-bolt',
};
function wmoIcon(code) { return WMO_ICONS[code] || 'fa-cloud-sun'; }

// Estimativa de tempo de pedal (min): tempo no plano + penalidade de subida.
// Compartilhado por Ferramentas (ferramentas.js) e Passeios (rides.js).
// speed em km/h, elev em metros de ganho, wind em km/h (+ a favor), profile
// multiplica a eficiência na subida, stops = parada fixa (min).
function estimateRideTimeMin({ dist, speed, elev = 0, wind = 0, profile = 1.0, stops = 0 }) {
  const adjSpeed    = Math.max((speed || 0) + wind, 10);
  const elevEquivKm = (elev || 0) / 100;
  const climbPenMin = Math.round((elevEquivKm / adjSpeed * 60) / (profile || 1.0));
  const flatTimeMin = ((dist || 0) / adjSpeed) * 60;
  const movTimeMin  = flatTimeMin + climbPenMin;
  return { flatTimeMin, climbPenMin, movTimeMin, totalTimeMin: movTimeMin + stops };
}

/* ── fmtDataHoraLocal — timestamp do SQLite → data/hora LOCAL ───────────
   #158. `gerado_em` e companhia vêm do SQLite como "YYYY-MM-DD HH:MM:SS"
   em UTC, SEM `Z` e sem offset. O V8 parseia essa forma separada por espaço
   como hora LOCAL, não UTC:

     new Date("2026-11-09 06:00:03").toISOString()  →  2026-11-09T09:00:03Z

   ou seja, sem o `Z` explícito a hora sai 3h errada. Era o bug das telas de
   Análise de Performance (`js/performance-analysis.js` e a versão mobile),
   que mostravam o número UTC como se fosse local, sem rótulo nenhum que
   denunciasse. O Treino IA fazia o oposto — convertia certo e rotulava
   " UTC" —, correto mas exigindo conversão mental num app de um único
   usuário em São Paulo.

   Aqui: acrescenta o `Z` quando falta, e formata no fuso do dispositivo
   SEM rótulo (decisão de produto). Entrada já com `Z`/offset é respeitada.
   Entrada inválida volta como veio, igual às 4 cópias que isto substitui.
═════════════════════════════════════════════════════════════════════════ */
function fmtDataHoraLocal(ts) {
  try {
    if (typeof ts !== 'string' || !ts) return ts;
    const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
      + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ts; }
}

/* ── segundaDaSemanaISO — segunda-feira da semana de `ref` ──────────────
   #160. Fonte ÚNICA entre backend e frontend: o backend usa para ancorar as
   datas do plano gerado (`atribuirDatas`), e o frontend para decidir se um
   plano ainda cobre a semana corrente — se as duas contas divergissem, um
   plano válido apareceria como vencido (ou pior, o contrário) nas viradas
   de ano e de mês.

   O `setHours(12)` é o que torna o `toISOString()` seguro aqui: ancorada ao
   meio-dia local, a data UTC coincide com a local em qualquer fuso de ±12h.
   Não é o caso proibido pelo BUG-#88 (que é formatar "agora" em UTC).
═════════════════════════════════════════════════════════════════════════ */
function segundaDaSemanaISO(entrada) {
  const d = (entrada instanceof Date) ? new Date(entrada)
          : (entrada == null) ? new Date()
          : new Date(entrada);
  if (isNaN(d.getTime())) return null;
  const dow = d.getDay();                       // 0=domingo..6=sábado
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

window.Utils = Object.assign(window.Utils || {}, { calcTrainingStreak, wmoIcon, estimateRideTimeMin, dataLocalISO, mesLocalISO, fmtDataHoraLocal, segundaDaSemanaISO });
