/* ═══════════════════════════════════════════════════════════════════════
   PASSWORD — wrapper bcrypt
═══════════════════════════════════════════════════════════════════════ */
const bcrypt = require('bcrypt');

const COST = 12;

module.exports = {
  hash:   (plain)        => bcrypt.hash(plain, COST),
  verify: (plain, hash)  => bcrypt.compare(plain, hash),
};
