// Test database helpers (SPEC §11). Only ever touches DB_NAME_TEST, which must end in `_test`.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { testDbConfigFromEnv }            = require('../../src/config/database');
const { createPool }                     = require('../../src/db/pool');
const { truncateAll, assertManagedName } = require('../../src/db/admin');
const { seedDemoSql }                    = require('../../src/seed/sqlSeed');

function assertTestDatabase(name) {
  if (!/_test$/.test(name || '')) throw new Error(`Refusing to use database "${name}": test database names must end in _test`);
  if (/^freight_transport/i.test(name)) throw new Error(`Refusing to use legacy database "${name}"`);
  assertManagedName(name);
}

// Connection config of the test database (throws unless it is a *_test database).
function testDbConfig(env = process.env) {
  const config = testDbConfigFromEnv(env);
  assertTestDatabase(config.database);
  return config;
}

let pool = null;

// Shared pool for the current test file (created lazily).
function getTestPool() {
  if (!pool) pool = createPool(testDbConfig());
  return pool;
}

// TRUNCATE every table except schema_migrations.
function resetDatabase() {
  return truncateAll(getTestPool());
}

// Inserts the demo data set; resolves with row counts { users, warehouses, vehicles, orders, history }.
function seedDemo(targetPool = getTestPool(), { now = new Date() } = {}) {
  return seedDemoSql(targetPool, { now });
}

async function closeTestPool() {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}

module.exports = { getTestPool, resetDatabase, seedDemo, closeTestPool, testDbConfig, assertTestDatabase };
