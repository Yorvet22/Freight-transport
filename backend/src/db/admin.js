// Database administration (CREATE / DROP DATABASE, truncate) with safety guards.
const mysql = require('mysql2/promise');

// Never created or dropped by this project (legacy v1 databases and MySQL system schemas).
const PROTECTED = /^(freight_transport(_test)?|mysql|sys|information_schema|performance_schema)$/i;

function assertManagedName(name) {
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Invalid database name "${name}"`);
  if (PROTECTED.test(name)) throw new Error(`Refusing to touch protected/legacy database "${name}"`);
}

async function withServerConnection(config, work) {
  const { host, port, user, password, database } = config;
  const conn = await mysql.createConnection({ host, port, user, password });
  try {
    return await work(conn, database);
  } finally {
    await conn.end();
  }
}

// CREATE DATABASE IF NOT EXISTS <config.database> (utf8mb4).
function createDatabase(config) {
  assertManagedName(config.database);
  return withServerConnection(config, (conn, name) => conn.query(
    `CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));
}

// DROP DATABASE IF EXISTS <config.database>.
function dropDatabase(config) {
  assertManagedName(config.database);
  return withServerConnection(config, (conn, name) => conn.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(name)}`));
}

// Empties every table of the pool's database except schema_migrations (AUTO_INCREMENT restarts at 1).
async function truncateAll(pool) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> 'schema_migrations'`);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const { name } of rows) await conn.query(`TRUNCATE TABLE ${mysql.escapeId(name)}`);
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  } finally {
    conn.release();
  }
}

module.exports = { createDatabase, dropDatabase, truncateAll, assertManagedName };
