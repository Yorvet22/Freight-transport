const { withTransaction } = require('../../src/db/transaction');
const { createPool }      = require('../../src/db/pool');
const { getTestPool, resetDatabase, closeTestPool, testDbConfig } = require('../helpers/db');

const insertVehicle = (conn, plate) => conn.query(
  "INSERT INTO vehicles (model, licensePlate, driverName) VALUES ('Volvo FH 500', ?, 'John Smith')", [plate]);
const countVehicles = async (pool) => (await pool.query('SELECT COUNT(*) AS n FROM vehicles'))[0][0].n;

describe('withTransaction', () => {
  let pool;
  beforeAll(() => { pool = getTestPool(); });
  beforeEach(() => resetDatabase());
  afterAll(() => closeTestPool());

  it('commits and returns the callback result', async () => {
    const result = await withTransaction(pool, async (conn) => {
      await insertVehicle(conn, 'AA 0001 AA');
      return 'done';
    });
    expect(result).toBe('done');
    expect(await countVehicles(pool)).toBe(1);
  });

  it('rolls back and rethrows when the callback fails', async () => {
    const boom = new Error('boom');
    await expect(withTransaction(pool, async (conn) => {
      await insertVehicle(conn, 'AA 0002 AA');
      throw boom;
    })).rejects.toBe(boom);
    expect(await countVehicles(pool)).toBe(0);
  });

  it('releases the connection in both cases', async () => {
    const single = createPool({ ...testDbConfig(), connectionLimit: 1 });
    try {
      await expect(withTransaction(single, async () => { throw new Error('x'); })).rejects.toThrow('x');
      await withTransaction(single, (conn) => insertVehicle(conn, 'AA 0003 AA'));
      await withTransaction(single, (conn) => insertVehicle(conn, 'AA 0004 AA'));
      expect(await countVehicles(single)).toBe(2);
    } finally {
      await single.end();
    }
  });
});
