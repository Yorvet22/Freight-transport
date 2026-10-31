const { createPool, POOL_OPTIONS } = require('../db/pool');

// MySQL connection settings from env (SPEC §8/§11). DB_NAME defaults to `freightflow`.
function dbConfigFromEnv(env = process.env) {
  return {
    host:     env.DB_HOST || 'localhost',
    port:     Number(env.DB_PORT) || 3306,
    user:     env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'freightflow',
  };
}

// Same server, test database (DB_NAME_TEST, default `freightflow_test`).
function testDbConfigFromEnv(env = process.env) {
  return { ...dbConfigFromEnv(env), database: env.DB_NAME_TEST || 'freightflow_test' };
}

// createPool/POOL_OPTIONS re-exported for backwards compatibility; prefer src/db/pool.
module.exports = { dbConfigFromEnv, testDbConfigFromEnv, createPool, POOL_OPTIONS };
