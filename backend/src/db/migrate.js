// Versioned schema migrations (SPEC §11): database/migrations/NNN_name.sql, applied in order,
// recorded in schema_migrations. Note: MySQL DDL commits implicitly, so a transaction only
// fully protects data statements; a failed file is never recorded and is retried next run.
const fs   = require('fs');
const path = require('path');
const { withTransaction } = require('./transaction');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
const FILE_PATTERN   = /^(\d{3})_([a-z0-9_]+)\.sql$/;

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version   INT          NOT NULL,
  name      VARCHAR(200) NOT NULL,
  appliedAt DATETIME     NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// Splits a migration file into statements (statements end with `;` at end of line; `--` comments removed).
function splitStatements(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// → [{ version, name, file, sql }] sorted by version.
function loadMigrations(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .map((file) => ({ file, match: FILE_PATTERN.exec(file) }))
    .filter(({ match }) => match)
    .map(({ file, match }) => ({
      version: Number(match[1]),
      name:    match[2],
      file,
      sql:     fs.readFileSync(path.join(dir, file), 'utf8'),
    }))
    .sort((a, b) => a.version - b.version);
}

async function appliedVersions(pool) {
  await pool.query(CREATE_TABLE);
  const [rows] = await pool.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

async function pendingMigrations(pool, { dir = MIGRATIONS_DIR } = {}) {
  const applied = await appliedVersions(pool);
  return loadMigrations(dir).filter((m) => !applied.has(m.version));
}

// Applies pending migrations in order; resolves with the applied ones ([] when up to date).
async function migrate(pool, { dir = MIGRATIONS_DIR, logger = null } = {}) {
  const applied = [];
  for (const migration of await pendingMigrations(pool, { dir })) {
    try {
      await withTransaction(pool, async (conn) => {
        for (const statement of splitStatements(migration.sql)) await conn.query(statement);
        await conn.query('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, UTC_TIMESTAMP())',
          [migration.version, migration.name]);
      });
    } catch (err) {
      err.message = `Migration ${migration.file} failed: ${err.message}`;
      throw err;
    }
    if (logger) logger.info(`Applied migration ${migration.file}`);
    applied.push({ version: migration.version, name: migration.name });
  }
  return applied;
}

module.exports = { migrate, pendingMigrations, loadMigrations, splitStatements, MIGRATIONS_DIR };
