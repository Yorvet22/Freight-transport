const { optionsFromEnv, checkDatabase, createShutdown } = require('../../server');

describe('optionsFromEnv()', () => {
  it('defaults: port 3000, auth on, no CORS, dev database', () => {
    expect(optionsFromEnv({})).toEqual({ port: 3000, authDisabled: false, sessionSecret: undefined, corsOrigin: undefined,
      db: { host: 'localhost', port: 3306, user: 'root', password: '', database: 'freightflow' } });
  });

  it('reads PORT, AUTH_DISABLED, SESSION_SECRET, CORS_ORIGIN and DB_*', () => {
    expect(optionsFromEnv({ PORT: '3555', AUTH_DISABLED: 'true', SESSION_SECRET: 's', CORS_ORIGIN: 'http://localhost:5173',
      DB_PORT: '3307', DB_NAME: 'other' })).toMatchObject({ port: 3555, authDisabled: true, sessionSecret: 's',
      corsOrigin: 'http://localhost:5173', db: { port: 3307, database: 'other' } });
  });

  it('ignores the removed DB_ENGINE / SEED_DEMO variables', () => {
    const options = optionsFromEnv({ DB_ENGINE: 'memory', SEED_DEMO: 'true' });
    expect(options).not.toHaveProperty('engine');
    expect(options).not.toHaveProperty('seedDemo');
  });

  it('requires SESSION_SECRET and forbids AUTH_DISABLED in production', () => {
    expect(() => optionsFromEnv({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
    expect(() => optionsFromEnv({ NODE_ENV: 'production', SESSION_SECRET: 's', AUTH_DISABLED: 'true' })).toThrow(/AUTH_DISABLED/);
    expect(optionsFromEnv({ NODE_ENV: 'production', SESSION_SECRET: 's' }).sessionSecret).toBe('s');
  });
});

describe('checkDatabase()', () => {
  const DB = { host: 'localhost', port: 3306, database: 'freightflow' };
  const okPool = () => ({ query: jest.fn().mockResolvedValue([[{ ok: 1 }]]) });

  it('resolves when MySQL answers and no migrations are pending', async () => {
    const pool = okPool();
    await expect(checkDatabase(pool, DB, { pendingMigrations: async () => [] })).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('fails with a clear message when MySQL is unreachable', async () => {
    const pool = { query: jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })) };
    await expect(checkDatabase(pool, DB, { pendingMigrations: async () => [] }))
      .rejects.toThrow(/Cannot connect to MySQL database "freightflow" at localhost:3306.*npm run db:setup/s);
  });

  it('fails with a clear message when migrations are pending', async () => {
    const pending = async () => [{ version: 2, file: '002_audit_log.sql' }];
    await expect(checkDatabase(okPool(), DB, { pendingMigrations: pending }))
      .rejects.toThrow(/1 pending migration.*002_audit_log\.sql.*npm run db:setup/s);
  });
});

describe('createShutdown()', () => {
  it('closes the HTTP server, then the pool, exactly once', async () => {
    const order  = [];
    const server = { close: jest.fn((cb) => { order.push('server'); cb(); }) };
    const pool   = { end: jest.fn(async () => { order.push('pool'); }) };
    const logger = { log: jest.fn(), error: jest.fn() };
    const shutdown = createShutdown({ server, pool, logger });
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(order).toEqual(['server', 'pool']);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('still ends the pool when closing the server fails', async () => {
    const server = { close: jest.fn((cb) => cb(new Error('not running'))) };
    const pool   = { end: jest.fn().mockResolvedValue() };
    const logger = { log: jest.fn(), error: jest.fn() };
    await createShutdown({ server, pool, logger })('SIGINT');
    expect(pool.end).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
