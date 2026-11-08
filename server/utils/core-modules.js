/* ═══════════════════════════════════════════════════════════════════════
   CORE-MODULES — reuso dos módulos puros de js/core/ no Node (scheduler,
   services). Fonte única com o cliente, sem duplicar regra (#3 F2 usa
   WeatherRating.rating e RidesSchedule.ridesOn no digest de push; #136 usa
   Metrics.calcTSBMetrics e WeightStats.weightAnalysis nos insumos do job
   automático do Treino IA).

   Os módulos de js/core são IIFEs de browser que anexam a `window.X`. Mesma
   estratégia de shim de tests/core-load.js: definir `global.window` antes do
   require faz o `window` bare dentro do arquivo resolver para o shim.

   Desde a #151, js/utils.js é carregado DE VERDADE aqui, não mais stubado
   com um `wmoIcon` que devolvia null: ele não toca `document` no nível
   superior (é o que os testes de window.BikeComp já provavam) e agora
   publica `Utils.dataLocalISO`, a fonte única de "YYYY-MM-DD no fuso local"
   que server/utils/datas.js passou a delegar. De quebra, o `wmoIcon` que o
   buildDay usa virou o real em vez do stub.

   metrics.js e weight-stats.js não precisaram de stub nenhum: são funções
   puras, sem DOM nem Storage. A única dependência externa é
   `window.Profile && Profile.calcAge` (js/core/metrics.js:108), que faz
   curto-circuito num fallback próprio quando Profile não existe — é o caso
   aqui. Por isso as fórmulas de fisiologia NÃO são portadas como as de
   performance-analysis.js: aqui o require funciona de verdade.
═══════════════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');

if (!global.window) global.window = {};

const JS_DIR = path.resolve(__dirname, '..', '..', 'js');
require(path.join(JS_DIR, 'utils.js'));

const CORE_DIR = path.join(JS_DIR, 'core');
require(path.join(CORE_DIR, 'weather-rating.js'));
require(path.join(CORE_DIR, 'rides-schedule.js'));
require(path.join(CORE_DIR, 'metrics.js'));
require(path.join(CORE_DIR, 'weight-stats.js'));

module.exports = {
  Utils: global.window.Utils,
  WeatherRating: global.window.WeatherRating,
  RidesSchedule: global.window.RidesSchedule,
  Metrics: global.window.Metrics,
  WeightStats: global.window.WeightStats,
};
