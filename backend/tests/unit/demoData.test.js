const { buildDemoData, DEMO_USERS } = require('../../src/seed/demoData');
const { canTransition }  = require('../../src/domain/enums');
const { verifyPassword } = require('../../src/auth/password');
const { getTestPool, resetDatabase, seedDemo, closeTestPool } = require('../helpers/db');

const NOW = new Date('2026-10-31T09:15:00Z');

describe('demo data', () => {
  const data = buildDemoData(NOW);

  it('has 4 warehouses, 10 vehicles and 60 orders covering every type and status', () => {
    expect(data.warehouses.map((w) => w.city)).toEqual(['Kyiv', 'Lviv', 'Odesa', 'Dnipro']);
    expect(data.vehicles).toHaveLength(10);
    expect(data.orders).toHaveLength(60);
    expect(new Set(data.orders.map((o) => o.type))).toEqual(new Set(['inbound', 'outbound', 'transfer']));
    expect(new Set(data.orders.map((o) => o.status))).toEqual(new Set(['new', 'in_transit', 'delivered', 'cancelled']));
    expect(DEMO_USERS.map((u) => u.role)).toEqual(['admin', 'dispatcher', 'viewer']);
  });

  it('keeps vehicle states consistent with in-transit orders', () => {
    const onTrip   = data.vehicles.map((v, i) => (v.status === 'on_trip' ? i : -1)).filter((i) => i >= 0).sort();
    const inTransit = data.orders.filter((o) => o.status === 'in_transit').map((o) => o.vehicleIndex).sort();
    expect(inTransit).toEqual(onTrip);
    data.orders.filter((o) => o.status === 'new' && o.vehicleIndex != null)
      .forEach((o) => expect(data.vehicles[o.vehicleIndex].status).toBe('available'));
  });

  it('satisfies BR1 and has valid, chronological histories in the past', () => {
    for (const o of data.orders) {
      if (o.type !== 'outbound') expect(o.destinationIndex).not.toBeNull();
      if (o.type !== 'inbound') expect(o.originIndex).not.toBeNull();
      if (o.type === 'transfer') expect(o.originIndex).not.toBe(o.destinationIndex);
      expect(o.createdAt <= NOW).toBe(true);
      expect(o.history[0]).toMatchObject({ fromStatus: null, toStatus: 'new' });
      for (let k = 1; k < o.history.length; k += 1) {
        expect(canTransition(o.history[k].fromStatus, o.history[k].toStatus)).toBe(true);
        expect(o.history[k].changedAt >= o.history[k - 1].changedAt).toBe(true);
        expect(o.history[k].changedAt <= NOW).toBe(true);
      }
      expect(o.history[o.history.length - 1].toStatus).toBe(o.status);
      if (o.status === 'delivered') expect(o.deliveredAt && o.podRecipientName).toBeTruthy();
      expect(o.pickupWindowEnd > o.pickupWindowStart).toBe(true);
    }
  });

  it('spreads orders over the last 30 days', () => {
    const oldest = Math.min(...data.orders.map((o) => o.createdAt.getTime()));
    expect((NOW - oldest) / 86400000).toBeLessThanOrEqual(30);
    expect((NOW - oldest) / 86400000).toBeGreaterThan(28);
  });
});

describe('seedDemo (SQL, test database)', () => {
  let pool;
  let counts;
  beforeAll(async () => {
    pool = getTestPool();
    await resetDatabase();
    counts = await seedDemo(pool, { now: NOW });
  });
  afterAll(() => closeTestPool());

  const one = async (sql, params) => (await pool.query(sql, params))[0][0];

  it('inserts every entity and reports counts', async () => {
    const history = data().orders.reduce((n, o) => n + o.history.length, 0);
    expect(counts).toEqual({ users: 3, warehouses: 4, vehicles: 10, orders: 60, history });
    expect((await one('SELECT COUNT(*) AS n FROM orders')).n).toBe(60);
    expect((await one('SELECT COUNT(*) AS n FROM order_status_history')).n).toBe(history);
  });

  it('derives orderNumber from the id', async () => {
    const rows = (await pool.query('SELECT id, orderNumber FROM orders'))[0];
    rows.forEach((r) => expect(r.orderNumber).toBe(`ORD-${String(r.id).padStart(6, '0')}`));
  });

  it('hashes demo user passwords', async () => {
    const admin = await one("SELECT passwordHash, role FROM users WHERE username = 'admin'");
    expect(admin.role).toBe('admin');
    expect(admin.passwordHash).toMatch(/^scrypt\$/);
    expect(verifyPassword('admin123', admin.passwordHash)).toBe(true);
  });

  it('keeps vehicles of in-transit orders on trip and stores UTC times', async () => {
    const [rows] = await pool.query(`SELECT v.status FROM orders o JOIN vehicles v ON v.id = o.vehicleId
      WHERE o.status = 'in_transit'`);
    expect(rows.map((r) => r.status)).toEqual(['on_trip', 'on_trip', 'on_trip']);
    const first = await one('SELECT createdAt, plannedDeliveryDate FROM orders ORDER BY id LIMIT 1');
    expect(first.createdAt.toISOString()).toBe(data().orders[0].createdAt.toISOString());
    expect(first.plannedDeliveryDate).toBe(data().orders[0].plannedDeliveryDate);
  });

  function data() { return buildDemoData(NOW); }
});
