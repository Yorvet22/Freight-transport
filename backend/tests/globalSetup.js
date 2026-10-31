// Jest globalSetup: create the test database (DB_NAME_TEST) if needed and apply pending migrations, once per run.
const { testDbConfig }   = require('./helpers/db');
const { createDatabase } = require('../src/db/admin');
const { createPool }     = require('../src/db/pool');
const { migrate }        = require('../src/db/migrate');

module.exports = async function globalSetup() {
  const config = testDbConfig();
  try {
    await createDatabase(config);
  } catch (err) {
    throw new Error(`Cannot create test database "${config.database}" (is MySQL running? check backend/.env): ${err.message}`);
  }
  const pool = createPool({ ...config, connectionLimit: 1 });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
};
