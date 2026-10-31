const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { loadMigrations, splitStatements, pendingMigrations, migrate, MIGRATIONS_DIR } = require('../../src/db/migrate');
const { getTestPool, resetDatabase, closeTestPool, assertTestDatabase } = require('../helpers/db');

const tableNames = async (pool) => (await pool.query(
  'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'))[0].map((r) => r.name).sort();

describe('splitStatements', () => {
  it('drops comments and blank statements', () => {
    const sql = '-- header\nCREATE TABLE a (id INT); -- trailing\n\n  CREATE TABLE b (id INT);\n-- end\n';
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)']);
  });
});

describe('loadMigrations', () => {
  it('lists NNN_name.sql files in version order', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    expect(migrations.map((m) => [m.version, m.name])).toEqual([[1, 'initial'], [2, 'audit_log']]);
    migrations.forEach((m) => expect(m.sql).not.toMatch(/CREATE DATABASE|^\s*USE\s/im));
  });
});

describe('migrate (against the test database)', () => {
  let pool;
  beforeAll(() => { pool = getTestPool(); });
  afterAll(() => closeTestPool());

  it('has applied every migration (globalSetup) and is idempotent', async () => {
    expect(await pendingMigrations(pool)).toEqual([]);
    expect(await migrate(pool)).toEqual([]);
    const [rows] = await pool.query('SELECT version, name, appliedAt FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => [r.version, r.name])).toEqual([[1, 'initial'], [2, 'audit_log']]);
    expect(rows[0].appliedAt).toBeInstanceOf(Date);
  });

  it('creates the SPEC tables', async () => {
    expect(await tableNames(pool)).toEqual(
      ['audit_log', 'order_status_history', 'orders', 'schema_migrations', 'users', 'vehicles', 'warehouses']);
  });

  it('enforces foreign keys (history cascades, vehicle delete nulls orders.vehicleId)', async () => {
    await resetDatabase();
    const [v] = await pool.query("INSERT INTO vehicles (model, licensePlate, driverName) VALUES ('M', 'P-1', 'D')");
    const [o] = await pool.query(`INSERT INTO orders (type, clientName, pickupAddress, deliveryAddress, cargoDescription,
      cargoWeight, vehicleId, createdAt) VALUES ('outbound', 'C', 'A', 'B', 'X', 10.5, ?, UTC_TIMESTAMP())`, [v.insertId]);
    await pool.query("INSERT INTO order_status_history (orderId, toStatus, changedAt) VALUES (?, 'new', UTC_TIMESTAMP())", [o.insertId]);
    await pool.query('DELETE FROM vehicles WHERE id = ?', [v.insertId]);
    expect((await pool.query('SELECT vehicleId, cargoWeight FROM orders'))[0][0]).toEqual({ vehicleId: null, cargoWeight: 10.5 });
    await pool.query('DELETE FROM orders');
    expect((await pool.query('SELECT COUNT(*) AS n FROM order_status_history'))[0][0].n).toBe(0);
  });

  it('stores audit details as JSON', async () => {
    await resetDatabase();
    await pool.query(`INSERT INTO audit_log (userId, username, action, entity, entityId, details, createdAt)
      VALUES (1, 'admin', 'create', 'order', 7, ?, UTC_TIMESTAMP())`, [JSON.stringify({ a: 1 })]);
    expect((await pool.query('SELECT details FROM audit_log'))[0][0].details).toEqual({ a: 1 });
  });

  describe('with an extra migration', () => {
    let dir;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-migrations-'));
      for (const f of fs.readdirSync(MIGRATIONS_DIR)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    });
    afterAll(async () => {
      await pool.query('DROP TABLE IF EXISTS tmp_probe');
      await pool.query('DELETE FROM schema_migrations WHERE version >= 900');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('applies only pending files and records them', async () => {
      fs.writeFileSync(path.join(dir, '900_probe.sql'), 'CREATE TABLE tmp_probe (id INT);\nINSERT INTO tmp_probe VALUES (1);\n');
      expect((await pendingMigrations(pool, { dir })).map((m) => m.version)).toEqual([900]);
      expect((await migrate(pool, { dir })).map((m) => m.name)).toEqual(['probe']);
      expect((await pool.query('SELECT COUNT(*) AS n FROM tmp_probe'))[0][0].n).toBe(1);
      expect(await migrate(pool, { dir })).toEqual([]);
    });

    it('does not record a failing migration', async () => {
      fs.writeFileSync(path.join(dir, '901_broken.sql'), 'THIS IS NOT SQL;\n');
      await expect(migrate(pool, { dir })).rejects.toThrow(/901_broken/);
      expect((await pendingMigrations(pool, { dir })).map((m) => m.version)).toEqual([901]);
      fs.unlinkSync(path.join(dir, '901_broken.sql'));
    });
  });
});

describe('test database guard', () => {
  it('refuses database names that do not end in _test', () => {
    expect(() => assertTestDatabase('freightflow')).toThrow(/_test/);
    expect(() => assertTestDatabase('freight_transport')).toThrow(/_test/);
    expect(() => assertTestDatabase('freight_transport_test')).toThrow(/legacy/);
    expect(() => assertTestDatabase('freightflow_test')).not.toThrow();
  });
});
