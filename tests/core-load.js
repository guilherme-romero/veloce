/* Helper para os testes unitários de js/core/ (Issue #72 item 2).
 *
 * Os módulos de js/core são IIFEs de browser que anexam a `window.X` (não são
 * CommonJS, não exportam via module.exports). A estratégia acordada é um shim:
 * definir `global.window` antes do require faz o `window` bare dentro do arquivo
 * resolver para o shim, então a IIFE popula `global.window.X` ao ser carregada.
 *
 * Não termina em `.test.js`, então `node --test tests/*.test.js` não o executa
 * como suíte — é só carregado pelos arquivos de teste. Cada arquivo de teste roda
 * em processo próprio (isolamento do node:test), então o `global.window` é limpo
 * entre arquivos; não há contaminação cruzada.
 */
'use strict';
const path = require('path');

/**
 * Carrega um ou mais módulos de js/core/ no shim e devolve o `window` populado.
 * @param  {...string} files — nomes dos arquivos (ex. 'metrics.js'). Carregados
 *                             na ordem dada, para respeitar dependências entre
 *                             módulos quando houver.
 * @return {object} o objeto global.window com os namespaces anexados.
 */
function loadCore(...files) {
  if (!global.window) global.window = {};
  for (const file of files) {
    const abs = path.join(__dirname, '..', 'js', 'core', file);
    delete require.cache[require.resolve(abs)];
    require(abs);
  }
  return global.window;
}

module.exports = { loadCore };
