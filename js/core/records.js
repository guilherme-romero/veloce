/* ═══════════════════════════════════════════════════════════════════════
   CORE / RECORDS — recordes pessoais normalizados, compartilhados pelo
   desktop (js/insights.js#renderPRs) e pela aba Insights mobile.

   Extraído VERBATIM de js/insights.js na v2.9.0. O que sai daqui é uma
   LISTA DE LINHAS já formatadas em texto — cada variante monta o próprio
   HTML (.pr-item no desktop, .m-pr no mobile).

   A parte não óbvia, e o motivo de isto não poder ser reescrito de memória
   no mobile: a Garmin reutiliza type_ids de corrida em atividades de
   ciclismo com semântica diferente. Confirmado cruzando os valores do DB
   com as colunas distancia_m / elevacao_m das atividades:
     type 8 (cycling)     → distancia_m  → exibir como km
     type 9 (road_biking) → elevacao_m   → exibir como metros
     type 12              → centiwatts (÷100 para W)
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const DAYS_30 = 30 * 86400000;

  // Rótulos por type_id de PR da Garmin, confirmados cruzando os valores do
  // DB com as atividades e com o próprio usuário. Só os type_ids em
  // ALLOWED_PR_TYPES (8,9,11) são exibidos como PRs nativos; os recordes
  // semanais e o VO2máx entram como linhas sintéticas. Os demais type_ids
  // não foram confirmados.
  const TYPE_LABELS = {
    1:  '1 km mais rápido',          // corrida (tempo)
    2:  '1 milha mais rápida',       // corrida (tempo)
    3:  'Recorde de corrida',        // não confirmado — não exibido
    4:  'Maior duração',
    5:  'Velocidade máxima',
    6:  '5 km mais rápido',
    7:  'Corrida mais longa',        // não confirmado — não exibido
    8:  'Maior distância',           // ciclismo → ver CYCLING_LABEL_OVERRIDE
    9:  'Maior elevação',            // ciclismo → ver CYCLING_LABEL_OVERRIDE
    10: 'Maior cadência média',
    11: '40 km mais rápido (pedal)', // tempo
    12: 'Mais passos num dia',
    13: 'Mais passos numa semana',
    14: 'Mais passos num mês',
    15: 'Recorde semanal',           // não identificado — não exibido
    16: 'Recorde de carga',          // não identificado — não exibido
  };

  const ACTIVITY_TYPE_LABELS = {
    cycling: 'Ciclismo', road_biking: 'Ciclismo estrada',
    mountain_biking: 'MTB', gravel_cycling: 'Gravel',
    running: 'Corrida', treadmill_running: 'Esteira',
    trail_running: 'Trail', walking: 'Caminhada',
    swimming: 'Natação', strength_training: 'Força',
  };

  const CYCLING_TYPES = new Set(['cycling', 'road_biking', 'mountain_biking', 'gravel_cycling']);

  // Labels alternativos para type_ids cujo significado muda em ciclismo
  const CYCLING_LABEL_OVERRIDE = {
    8: 'Maior distância (ciclismo)',
    9: 'Maior elevação num pedal',
  };

  // 8=dist. num pedal · 9=elev. num pedal · 11=40 km mais rápido.
  const ALLOWED_PR_TYPES = new Set([8, 9, 11]);

  function formatValue(typeId, value, actType) {
    if (value == null) return '—';
    const isCycling = CYCLING_TYPES.has(actType);

    // type 8 para ciclismo = distância máxima do pedal (metros → km)
    if (typeId === 8 && isCycling) return (value / 1000).toFixed(1).replace('.', ',') + ' km';
    // type 9 para ciclismo = maior ganho de elevação (metros)
    if (typeId === 9 && isCycling) return Math.round(value).toLocaleString('pt-BR') + ' m';

    // Tempos em segundos: 1km, 5km, 10km, meia, maratona, duração (só corrida)
    if ([1, 4, 6, 7, 8, 9].includes(typeId)) {
      const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), s = Math.floor(value % 60);
      return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}min ${String(s).padStart(2, '0')}s`;
    }
    // Distância máxima (metros → km)
    if (typeId === 2) return (value / 1000).toFixed(1).replace('.', ',') + ' km';
    // Elevação acumulada (metros)
    if (typeId === 3) return Math.round(value).toLocaleString('pt-BR') + ' m';
    // Velocidade m/s → km/h
    if (typeId === 5) return (value * 3.6).toFixed(1).replace('.', ',') + ' km/h';
    // Cadência
    if (typeId === 10) return Math.round(value) + ' rpm';
    // type 11 = 40 km mais rápido pedalando (segundos → h:mm:ss)
    if (typeId === 11) {
      const hh = Math.floor(value / 3600), mm = Math.floor((value % 3600) / 60), ss = Math.floor(value % 60);
      return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    // Passos (dia/semana/mês)
    if ([12, 13, 14].includes(typeId)) return Math.round(value).toLocaleString('pt-BR') + ' passos';
    // type_ids 15/16 não identificados — número cru
    if (typeId === 15 || typeId === 16) return Math.round(value).toLocaleString('pt-BR');
    return value.toFixed(1).replace('.', ',');
  }

  function parseIsoDate(raw) {
    if (!raw) return null;
    // Suporta "YYYY-MM-DD HH:MM:SS" e "YYYY-MM-DDTHH:MM:SS"
    const iso = String(raw).split(/[T ]/)[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDataBr(raw) {
    const d = parseIsoDate(raw);
    return d && isFinite(d)
      ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
  }

  /**
   * @param  {Array}  prs        — /api/garmin/personal-records
   * @param  {Object} vo2max     — /api/garmin/vo2max
   * @param  {Object} weeklyRec  — /api/activities/weekly-records
   * @return {Object} { ok, linhas: [{label, valor, meta, sport, isNew, sintetica}], total, temNovo }
   *                  `sintetica` distingue as linhas derivadas (semanais,
   *                  VO2máx) dos PRs nativos da Garmin — só as nativas podem
   *                  ganhar selo de esporte ou "Novo!".
   *                  `total` = PRs nativos + sintéticos (o contador do card).
   *                  Textos já formatados; quem renderiza ainda deve escapar.
   */
  function personalRecords(prs, vo2max, weeklyRec) {
    const items = Array.isArray(prs) ? prs : [];

    const temSint = (weeklyRec && (weeklyRec.elevacao || weeklyRec.distancia))
                 || (vo2max && vo2max.max);
    if (!items.length && !temSint) return { ok: false, linhas: [], total: 0, temNovo: false };

    const visible = items.filter(p =>
      ALLOWED_PR_TYPES.has(p.type_id) &&
      TYPE_LABELS[p.type_id] != null &&
      // type 8/9 só fazem sentido para ciclismo neste app; um PR 8/9 de corrida
      // cairia no formato de tempo (linha do array [1,4,6,7,8,9]) sob rótulo de
      // distância.
      ((p.type_id !== 8 && p.type_id !== 9) || CYCLING_TYPES.has(p.activity_type)));

    const now = Date.now();

    // Linhas sintéticas (não são PRs nativos da Garmin): recordes semanais de
    // ciclismo (calculados no backend) e o VO2max (máximo histórico; o Garmin
    // deste usuário só registra VO2max de corrida).
    const sinteticas = [];
    const wElev = weeklyRec && weeklyRec.elevacao;
    if (wElev && wElev.value != null) {
      sinteticas.push({
        label: 'Maior elevação semanal',
        valor: Math.round(wElev.value).toLocaleString('pt-BR') + ' m',
        meta: 'Semana de ' + fmtDataBr(wElev.weekStart),
        sport: '', isNew: false, sintetica: true,
      });
    }
    const wDist = weeklyRec && weeklyRec.distancia;
    if (wDist && wDist.value != null) {
      sinteticas.push({
        label: 'Maior distância semanal',
        valor: (wDist.value / 1000).toFixed(1).replace('.', ',') + ' km',
        meta: 'Semana de ' + fmtDataBr(wDist.weekStart),
        sport: '', isNew: false, sintetica: true,
      });
    }
    if (vo2max && vo2max.max && vo2max.max.value != null) {
      sinteticas.push({
        label: 'Melhor VO2máx estimado',
        valor: Math.round(vo2max.max.value) + ' mL/kg/min',
        meta: fmtDataBr(vo2max.max.date),
        sport: '', isNew: false, sintetica: true,
      });
    }

    const nativas = visible.map(p => {
      const isCyc = CYCLING_TYPES.has(p.activity_type);
      const d = parseIsoDate(p.pr_date || p.activity_date);
      const dataStr = d && isFinite(d)
        ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';
      return {
        label: (isCyc && CYCLING_LABEL_OVERRIDE[p.type_id]) || TYPE_LABELS[p.type_id],
        valor: formatValue(p.type_id, p.valor, p.activity_type),
        meta: [p.activity_name, dataStr].filter(Boolean).join(' · '),
        sport: p.activity_type ? (ACTIVITY_TYPE_LABELS[p.activity_type] || p.activity_type) : '',
        isNew: !!(d && isFinite(d) && (now - d.getTime()) < DAYS_30),
        sintetica: false,
      };
    });

    return {
      ok: true,
      linhas: sinteticas.concat(nativas),
      total: visible.length + sinteticas.length,
      temNovo: nativas.some(l => l.isNew),
    };
  }

  window.Records = { personalRecords, TYPE_LABELS, ACTIVITY_TYPE_LABELS, formatValue };
})();
