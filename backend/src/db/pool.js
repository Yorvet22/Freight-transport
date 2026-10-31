const mysql = require('mysql2/promise');

// DATETIME columns are stored and read as UTC; DATE columns come back as 'YYYY-MM-DD' strings;
// DECIMAL columns come back as numbers. Placeholders are positional (`?`) only.
const POOL_OPTIONS = {
  connectionLimit:    10,
  waitForConnections: true,
  charset:            'utf8mb4',
  timezone:           'Z',
  dateStrings:        ['DATE'],
  decimalNumbers:     true,
  namedPlaceholders:  false,
};

// config: { host, port, user, password, database, ...any mysql2 pool option override }
function createPool(config) {
  if (!config || !config.database) throw new Error('createPool: config.database is required');
  return mysql.createPool({ ...POOL_OPTIONS, ...config });
}

module.exports = { createPool, POOL_OPTIONS };
