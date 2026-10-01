/* ═══════════════════════════════════════════════════════════════════════
   PRÓXIMO TREINO — seção da IDEIA-1+2 (backlog). Mostra a Sugestão de
   Treino do momento, calculada por TrainingSuggestion (js/core/), a partir
   dos mesmos dados que a seção Insights já busca.

   Sem cache: recalcula a cada onEnter (decisão do design — regra é barata,
   não vale o risco de mostrar sugestão desatualizada logo após um sync).

   Fase 2 (IDEIA-1+2): busca também os limiares calibrados (GET
   /garmin/calibration, cache de 7 dias NO BACKEND) e repassa pro
   TrainingSuggestion/SuggestionHistory — se a chamada falhar, os dois caem
   nos limiares fixos originais (parâmetro opcional, sem quebrar nada).
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const $ = (id) => document.getElementById(id);

  // Mapa determinístico (categoria, token) → estado visual do card Veredito
  // (handoff_desempenho/README.md) — a cor/ícone é por ESTADO, não reaproveita
  // o token vermelho/âmbar/verde antigo (ex.: os dois estados "zona-alvo"
  // usam o mesmo fundo lima, diferenciados só pelo ícone).
  const ESTADOS_VEREDITO = {
    'recuperacao':       { label: 'Recuperação',               bg: 'var(--magenta)', icon: 'fa-bed' },
    'volume':            { label: 'Treino leve / manutenção',  bg: 'var(--amber)',   icon: 'fa-feather' },
    'zona-alvo:amber':   { label: 'Treino forte / intervalado', bg: 'var(--lime)',   icon: 'fa-bolt' },
    'zona-alvo:green':   { label: 'Treino normal',             bg: 'var(--lime)',    icon: 'fa-bicycle' },
  };

  function estadoVeredito(sug) {
    const chave = sug.categoria === 'zona-alvo' ? `zona-alvo:${sug.token}` : sug.categoria;
    return ESTADOS_VEREDITO[chave] || ESTADOS_VEREDITO['zona-alvo:green'];
  }

  // As 4 mensagens de TrainingSuggestion seguem o padrão "Motivo — Ação" —
  // divide sem inventar texto novo: título = ação (vira o H em caixa alta),
  // subtítulo = motivo. Sem "—" na mensagem (não deveria acontecer hoje),
  // tudo vira título.
  function splitMotivoAcao(msg) {
    const idx = msg.indexOf(' — ');
    if (idx === -1) return { subtitulo: '', titulo: msg };
    return { subtitulo: msg.slice(0, idx), titulo: msg.slice(idx + 3) };
  }

  const EMPTY_MSG_DEFAULT = 'Sincronize com o Garmin e treine por pelo menos 7 dias para ver a sugestão aqui.';

  async function load() {
    const empty   = $('proximo-treino-empty');
    const content = $('proximo-treino-content');
    if (!empty || !content) return;

    empty.textContent = EMPTY_MSG_DEFAULT;

    try {
      // fcMax precisa vir antes do Promise.all — a calibração (Fase 2) é
      // buscada por fcMax na query string, já que o backend não replica o
      // cálculo de idade/FCM do perfil (Storage já está carregado no boot).
      const user  = window.Storage ? Storage.getUser() : {};
      const fcMax = window.Metrics.calcFCMax(user);

      const [unified, health, zoneDist, calibracao] = await Promise.all([
        window.Api.get('/activities/unified?days=180').catch(() => ({ items: [] })),
        // 104 dias: os 60 originais + margem pro Cruzamento sugestão×execução
        // (janela de 90 dias, e fatigueIndex olha até 14 dias antes de cada dia
        // analisado). Não muda o card de Sugestão do dia, que só lê os
        // primeiros 7-14 itens do array.
        window.Api.get('/garmin/health?days=104').catch(() => []),
        window.Api.get('/garmin/zone-distribution?days=30').catch(() => null),
        // Limiares calibrados (Fase 2) — sem fcMax não há o que calibrar;
        // se falhar, os módulos caem nos limiares fixos (parâmetro opcional).
        fcMax ? window.Api.get('/garmin/calibration?fcMax=' + fcMax).catch(() => null) : Promise.resolve(null),
      ]);

      const activities = (unified && unified.items) || [];
      // Mesmo pré-processamento de insights.js: mais recente primeiro.
      const healthArr = Array.isArray(health) ? [...health].sort((a, b) => b.data.localeCompare(a.data)) : [];

      const limiares = calibracao ? {
        zonaAltaMinPct: calibracao.zonaAltaMinPct,
        tsbSobrecarga:  calibracao.tsbSobrecarga,
      } : undefined;

      const sug = window.TrainingSuggestion.suggest({
        activities, health: healthArr, zoneDist, fcMax, limiares,
      });

      if (!sug.ok) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;

      const estado = estadoVeredito(sug);
      const { titulo, subtitulo } = splitMotivoAcao(sug.msg);

      const verdict = $('desemp-verdict');
      if (verdict) verdict.style.background = estado.bg;
      const icon = $('desemp-verdict-icon');
      if (icon) icon.className = 'fa-solid ' + estado.icon;
      const categoriaEl = $('desemp-verdict-categoria');
      if (categoriaEl) categoriaEl.textContent = estado.label;
      const tituloEl = $('desemp-verdict-title');
      if (tituloEl) tituloEl.textContent = titulo.replace(/\.$/, '').toUpperCase();
      const subEl = $('desemp-verdict-sub');
      if (subEl) subEl.textContent = subtitulo;

      const limiarTss = calibracao ? calibracao.tssRecuperacaoIgnorada : undefined;
      const hist = window.SuggestionHistory.analyze({ activities, health: healthArr, fcMax, days: 90, limiarTss });
      const ring   = $('desemp-adherence-ring');
      const texto  = $('desemp-adherence-text');
      const vazio  = $('desemp-adherence-empty');
      if (hist.ok) {
        if (ring) {
          ring.hidden = false;
          ring.style.background = `conic-gradient(var(--lime) 0 ${hist.percentual}%, var(--border) ${hist.percentual}% 100%)`;
        }
        const pct = $('desemp-adherence-pct');
        if (pct) pct.textContent = hist.percentual + '%';
        if (texto) {
          texto.hidden = false;
          texto.replaceChildren();
          texto.append('Você seguiu a recuperação em ');
          const strong = document.createElement('strong');
          strong.style.color = 'var(--text)';
          strong.textContent = `${hist.seguiu} de ${hist.total}`;
          texto.append(strong, ` ocasiões nos últimos ${hist.janelaDias} dias.`);
        }
        if (vazio) vazio.hidden = true;
      } else {
        if (ring) ring.hidden = true;
        if (texto) texto.hidden = true;
        if (vazio) vazio.hidden = false;
      }
    } catch (err) {
      console.error('[proximo-treino]', err);
      empty.textContent = 'Falha ao calcular a sugestão de treino.';
      empty.hidden = false;
      content.hidden = true;
    }
  }

  window.ProximoTreino = { load };
})();
