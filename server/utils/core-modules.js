/* ═══════════════════════════════════════════════════════════════════════
   CORE-MODULES — reuso dos módulos puros de js/core/ no Node (scheduler,
   services). Fonte única com o cliente, sem duplicar regra (#3 F2 usa
   WeatherRating.rating e RidesSchedule.ridesOn no digest de push).

   Os módulos de js/core são IIFEs de browser que anexam a `window.X`. Mesma
   estratégia de shim de tests/core-load.js: definir `global.window` antes do
   require faz o `window` bare dentro do arquivo resolver para o shim. O
   `Utils.wmoIcon` é stubado (devolve null) — buildDay só o usa para o ícone,
   que o digest de push não aproveita.
═══════════════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');

if (!global.window) global.window = {};
if (!global.window.Utils) global.window.Utils = { wmoIcon: () => null };

const CORE_DIR = path.resolve(__dirname, '..', '..', 'js', 'core');
require(path.join(CORE_DIR, 'weather-rating.js'));
require(path.join(CORE_DIR, 'rides-schedule.js'));

module.exports = {
  WeatherRating: global.window.WeatherRating,
  RidesSchedule: global.window.RidesSchedule,
};
