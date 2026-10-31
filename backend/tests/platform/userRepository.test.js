// UserRepository and AuditRepository against the test database (DB_NAME_TEST).
const { getTestPool, resetDatabase, closeTestPool } = require('../helpers/db');
const UserRepository  = require('../../src/repositories/userRepository');
const AuditRepository = require('../../src/repositories/auditRepository');
const { utc } = require('./fixtures');

let pool;
beforeAll(() => { pool = getTestPool(); });
beforeEach(() => resetDatabase());
afterAll(() => closeTestPool());

describe('UserRepository (MySQL)', () => {
  let repo;
  beforeEach(() => { repo = new UserRepository(pool); });

  test('create, find by id/username (case-insensitive), list, delete', async () => {
    const id = await repo.create({ username: 'alice', passwordHash: 'scrypt$aa$bb', role: 'viewer' });
    expect(id).toEqual(expect.any(Number));
    const byId = await repo.findById(id);
    expect(byId).toMatchObject({ id, username: 'alice', passwordHash: 'scrypt$aa$bb', role: 'viewer' });
    expect(byId.createdAt).toBeInstanceOf(Date);
    expect((await repo.findByUsername('ALICE')).id).toBe(id);
    expect(await repo.findByUsername('nobody')).toBeNull();
    expect(await repo.findById(999)).toBeNull();

    await repo.create({ username: 'bob', passwordHash: 'x', role: 'admin' });
    expect((await repo.listAll()).map(u => u.username)).toEqual(['alice', 'bob']);

    expect(await repo.deleteById(id)).toBe(true);
    expect(await repo.deleteById(id)).toBe(false);
    expect(await repo.findById(id)).toBeNull();
  });

  test('duplicate username (any case) -> 409 DUPLICATE_USERNAME', async () => {
    await repo.create({ username: 'alice', passwordHash: 'x', role: 'viewer' });
    await expect(repo.create({ username: 'Alice', passwordHash: 'y', role: 'viewer' }))
      .rejects.toMatchObject({ code: 'DUPLICATE_USERNAME', status: 409 });
  });
});

describe('AuditRepository (MySQL)', () => {
  let repo;
  beforeEach(() => { repo = new AuditRepository(pool); });

  test('add stores JSON details; list filters, paginates and returns newest first', async () => {
    await repo.add({ userId: 1, username: 'admin', action: 'create', entity: 'order', entityId: 5,
      details: { orderNumber: 'ORD-000005', weight: 12.5 }, createdAt: utc(2026, 10, 1) });
    await repo.add({ userId: null, username: 'system', action: 'status_change', entity: 'order', entityId: 5,
      createdAt: utc(2026, 10, 2) });
    await repo.add({ userId: 1, username: 'admin', action: 'delete', entity: 'vehicle', entityId: 5,
      details: { licensePlate: 'AA1111AA' }, createdAt: utc(2026, 10, 3) });

    const all = await repo.list({});
    expect(all.total).toBe(3);
    expect(all.items.map(i => i.action)).toEqual(['delete', 'status_change', 'create']);
    expect(all.items[2]).toEqual({
      id: expect.any(Number), userId: 1, username: 'admin', action: 'create', entity: 'order', entityId: 5,
      details: { orderNumber: 'ORD-000005', weight: 12.5 }, createdAt: utc(2026, 10, 1),
    });
    expect(all.items[1].details).toBeNull();

    const orders = await repo.list({ entity: 'order' });
    expect(orders.total).toBe(2);
    const one = await repo.list({ entity: 'order', entityId: 5, offset: 1, limit: 1 });
    expect(one).toMatchObject({ total: 2, items: [expect.objectContaining({ action: 'create' })] });
    expect((await repo.list({ entity: 'vehicle', entityId: 6 })).total).toBe(0);
  });

  test('add can run on a transaction connection (rolled back with it)', async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await repo.add({ username: 'admin', action: 'create', entity: 'user', entityId: 1 }, conn);
      await conn.rollback();
    } finally {
      conn.release();
    }
    expect((await repo.list({})).total).toBe(0);
  });
});
