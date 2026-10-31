require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createApp }         = require('./src/app');
const { dbConfigFromEnv }   = require('./src/config/database');
const { createPool }        = require('./src/db/pool');
const { pendingMigrations } = require('./src/db/migrate');

const SETUP_HINT = 'Run "npm run db:setup" in backend/ (check DB_* settings in backend/.env).';

// Maps environment variables to server/createApp options (SPEC §8, §11).
function optionsFromEnv(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const options = {
    port:          Number(env.PORT) || 3000,
    authDisabled:  env.AUTH_DISABLED === 'true',
    sessionSecret: env.SESSION_SECRET || undefined,
    corsOrigin:    env.CORS_ORIGIN || undefined,
    trustProxy:    env.TRUST_PROXY || undefined,
    db:            dbConfigFromEnv(env),
  };
  if (production && !options.sessionSecret) throw new Error('SESSION_SECRET is required when NODE_ENV=production.');
  if (production && options.authDisabled) throw new Error('AUTH_DISABLED=true is not allowed when NODE_ENV=production.');
  return options;
}

// Fails fast when MySQL is unreachable or the schema is not up to date.
async function checkDatabase(pool, db, { pendingMigrations: pending = pendingMigrations } = {}) {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    throw new Error(`Cannot connect to MySQL database "${db.database}" at ${db.host}:${db.port} (${err.code || err.message}).\n`
      + `Is MySQL running? ${SETUP_HINT}`);
  }
  const migrations = await pending(pool);
  if (migrations.length) {
    throw new Error(`Database "${db.database}" has ${migrations.length} pending migration(s): `
      + `${migrations.map((m) => m.file).join(', ')}.\n${SETUP_HINT}`);
  }
}

// Returns an idempotent shutdown(signal): close the HTTP server, then the MySQL pool.
function createShutdown({ server, pool, logger = console }) {
  let closing = null;
  return function shutdown(signal) {
    if (!closing) {
      logger.log(`${signal} received: shutting down...`);
      closing = new Promise((resolve) => {
        server.close((err) => {
          if (err) logger.error('Error while closing the HTTP server:', err);
          resolve();
        });
      })
        .then(() => pool.end())
        .catch((err) => logger.error('Error while closing the database pool:', err));
    }
    return closing;
  };
}

async function start(env = process.env, logger = console) {
  const options = optionsFromEnv(env);
  const pool    = createPool(options.db);
  try {
    await checkDatabase(pool, options.db);
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
  if (options.authDisabled) logger.warn('WARNING: AUTH_DISABLED=true — every request acts as an admin. Never use in production.');

  const app = createApp({ pool, authDisabled: options.authDisabled, sessionSecret: options.sessionSecret,
    corsOrigin: options.corsOrigin, trustProxy: options.trustProxy, logger });
  const server = app.listen(options.port, () => {
    logger.log(`Server running on http://localhost:${options.port} (database: ${options.db.database})`);
  });
  const shutdown = createShutdown({ server, pool, logger });
  app.locals.close = () => shutdown('close');
  ['SIGINT', 'SIGTERM'].forEach((signal) => process.once(signal, () => shutdown(signal).then(() => process.exit(0))));
  return { app, server, pool, shutdown };
}

if (require.main === module) {
  start().catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { optionsFromEnv, checkDatabase, createShutdown, start };
