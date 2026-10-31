// Database CLI (SPEC §11). Usage (from backend/): node scripts/db.js <command> [--test] [--force]
//   create   CREATE DATABASE IF NOT EXISTS (utf8mb4)
//   migrate  apply pending database/migrations/*.sql
//   seed     load demo data (refuses if data exists unless --force, which empties the tables first)
//   setup    create + migrate + seed if empty (safe to rerun)
//   reset    drop + setup (never with NODE_ENV=production)
// --test targets DB_NAME_TEST instead of DB_NAME.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { dbConfigFromEnv, testDbConfigFromEnv } = require('../src/config/database');
const { createPool }                           = require('../src/db/pool');
const { migrate }                              = require('../src/db/migrate');
const { createDatabase, dropDatabase, truncateAll } = require('../src/db/admin');
const { seedDemoSql, hasData }                 = require('../src/seed/sqlSeed');

const log = { info: (msg) => console.log(msg) };

async function withPool(config, work) {
  const pool = createPool({ ...config, connectionLimit: 2 });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}

async function runMigrations(config) {
  const applied = await withPool(config, (pool) => migrate(pool, { logger: log }));
  log.info(applied.length ? `Applied ${applied.length} migration(s).` : 'Schema is up to date.');
}

async function seed(config, { force = false, ifEmpty = false } = {}) {
  await withPool(config, async (pool) => {
    if (await hasData(pool)) {
      if (ifEmpty) return log.info('Database already has data; seeding skipped.');
      if (!force) throw new Error(`Database "${config.database}" already has data. Use --force to wipe and re-seed.`);
      await truncateAll(pool);
    }
    const counts = await seedDemoSql(pool);
    log.info(`Seeded "${config.database}": ${JSON.stringify(counts)}`);
    log.info('Demo logins (demo only): admin/admin123, dispatcher/dispatcher123, viewer/viewer123');
  });
}

async function setup(config) {
  await createDatabase(config);
  log.info(`Database "${config.database}" is ready.`);
  await runMigrations(config);
  await seed(config, { ifEmpty: true });
}

const COMMANDS = {
  create:  async (config) => { await createDatabase(config); log.info(`Database "${config.database}" is ready.`); },
  migrate: (config) => runMigrations(config),
  seed:    (config, flags) => seed(config, { force: flags.force }),
  setup,
  reset:   async (config, flags, env) => {
    if (env.NODE_ENV === 'production') throw new Error('db:reset is disabled when NODE_ENV=production.');
    await dropDatabase(config);
    log.info(`Dropped database "${config.database}".`);
    await setup(config);
  },
};

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command] = argv.filter((a) => !a.startsWith('--'));
  const flags     = { test: argv.includes('--test'), force: argv.includes('--force') };
  if (!COMMANDS[command]) throw new Error(`Unknown command "${command || ''}". Use one of: ${Object.keys(COMMANDS).join(', ')}`);
  const config = flags.test ? testDbConfigFromEnv(env) : dbConfigFromEnv(env);
  await COMMANDS[command](config, flags, env);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
