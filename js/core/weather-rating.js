/* ═══════════════════════════════════════════════════════════════════════
   CORE / WEATHER-RATING — monta o dia da previsão do Open-Meteo e avalia a
   condição para pedalar. Compartilhado pela faixa de clima do desktop
   (js/rides.js), pelo sino de notificações (Rides.dayRating) e pela aba
   Passeios mobile (js/mobile/rides-mobile.js).

   Extraído VERBATIM de js/rides.js na v2.9.0 (buildWeatherDay e
   ridesEsforco). Única diferença de valor: o '#f5923a' cravado no
   "Médio-Alto" virou o token `orange`, que é exatamente esse hex em
   css/style.css:51 — o desktop não muda de cor.

   Como em Metrics.tsbStatus, `rating` devolve o NOME do token e nunca um
   hex: --red e --amber divergem de propósito entre desktop e mobile.

   Ordem das regras importa: os três alertas críticos vêm ANTES da escala
   normal e a sobrescrevem — um dia fresco com rajadas de 60 km/h não pode
   sair como "Ideal".
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const WEEKDAY_PT  = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                       'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  /**
   * Um dia da resposta de /api/weather/forecast, normalizado.
   * @param {Object} daily — payload do proxy Open-Meteo
   * @param {number} i     — índice do dia
   */
  function buildDay(daily, i) {
    const dateStr = daily.time[i];
    const d       = new Date(dateStr + 'T12:00:00');
    return {
      dateStr,
      wd:      WEEKDAY_PT[d.getDay()],
      dm:      d.getDate(),
      mon:     MONTH_SHORT[d.getMonth()],
      tMax:    Math.round(daily.temperature_2m_max[i]),
      tMin:    Math.round(daily.temperature_2m_min[i]),
      tSens:   daily.apparent_temperature_max?.[i] != null ? Math.round(daily.apparent_temperature_max[i]) : null,
      tSensMin:daily.apparent_temperature_min?.[i] != null ? Math.round(daily.apparent_temperature_min[i]) : null,
      chuva:   daily.precipitation_probability_max?.[i] ?? 0,
      chuvaMm: daily.precipitation_sum?.[i] ?? 0,
      vento:   daily.wind_speed_10m_max?.[i] ?? 0,
      rajada:  daily.windgusts_10m_max?.[i] ?? null,
      uv:      daily.uv_index_max?.[i] ?? null,
      sunrise: daily.sunrise?.[i] || null,
      sunset:  daily.sunset?.[i] || null,
      wmo:     daily.weathercode[i],
      icon:    window.Utils.wmoIcon(daily.weathercode[i]),
      isToday: i === 0,
    };
  }

  /**
   * Condição estimada para pedalar.
   * @param  {Object} day — saída de buildDay
   * @return {Object} { label, token, alert, nivel }
   *                  `nivel` 0–4 (ideal → crítico) serve para ordenar ou
   *                  escolher ícone sem depender do texto do rótulo.
   */
  function rating(day) {
    const tMax    = day.tMax;
    const tSens   = day.tSens ?? day.tMax;
    const vento   = day.vento;
    const rajada  = day.rajada ?? day.vento;
    const chuva   = day.chuva;
    const chuvaMm = day.chuvaMm ?? 0;
    const uv      = day.uv ?? 0;

    // Alertas críticos (alta prioridade — sobrescrevem o esforço)
    if (rajada > 50)  return { label: '⚠ Vento perigoso', token: 'red', nivel: 4, alert: `Rajadas de ${Math.round(rajada)} km/h — pedalar não recomendado` };
    if (chuvaMm > 10) return { label: '🌧 Chuva forte',    token: 'red', nivel: 4, alert: `${chuvaMm.toFixed(1)} mm de chuva previstos — considere adiar` };
    if (tSens > 40)   return { label: '🌡 Calor extremo',  token: 'red', nivel: 4, alert: `Sensação térmica ${Math.round(tSens)}°C — risco de golpe de calor` };

    // Esforço regular
    if (tMax > 38 || chuva > 60 || vento > 40)   return { label: 'Alto',        token: 'red',    nivel: 3, alert: uv >= 9 ? `UV ${Math.round(uv)} — protetor solar obrigatório` : '' };
    if (tMax > 35 || (chuva > 30 && vento > 20)) return { label: 'Médio-Alto',  token: 'orange', nivel: 2, alert: uv >= 8 ? `UV ${Math.round(uv)} — proteção solar necessária` : '' };
    if (tMax > 30 || vento > 25 || chuva > 20)   return { label: 'Médio',       token: 'amber',  nivel: 2, alert: uv >= 8 ? `UV ${Math.round(uv)} — proteção solar necessária` : '' };
    if (tMax > 25 || vento > 15)                 return { label: 'Baixo-Médio', token: 'teal',   nivel: 1, alert: '' };
    return                                              { label: '✅ Ideal',    token: 'green',  nivel: 0, alert: '' };
  }

  window.WeatherRating = { buildDay, rating, WEEKDAY_PT, MONTH_SHORT };
})();
