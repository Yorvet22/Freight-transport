// Dashboard KPIs computed in SQL (DashboardRepository) + DashboardService composition, against the test DB.
const { getTestPool, resetDatabase, closeTestPool } = require('../helpers/db');
const DashboardRepository = require('../../src/repositories/dashboardRepository');
const OrderRepository     = require('../../src/repositories/orderRepository');
const DashboardService    = require('../../src/services/dashboardService');
const { utc, insertWarehouse, insertVehicle, insertOrder, insertHistory } = require('./fixtures');

// Fixed "now": 2026-10-31 12:00 UTC. All day bucketing uses UTC calendar days.
const NOW = utc(2026, 10, 31, 12);

let pool;
beforeAll(() => { pool = getTestPool(); });
beforeEach(() => resetDatabase());
afterAll(() => closeTestPool());

const service = (now = NOW) => new DashboardService(
  { dashboardRepo: new DashboardRepository(pool), orderRepo: new OrderRepository(pool) }, { now: () => now },
);

describe('DashboardService.getKpis (MySQL)', () => {
  test('empty data -> zero counts and null rates, 14 zero-filled days', async () => {
    const kpis = await service().getKpis();
    expect(kpis.orders).toEqual({ total: 0, new: 0, in_transit: 0, delivered: 0, cancelled: 0 });
    expect(kpis.vehicles).toEqual({ total: 0, available: 0, on_trip: 0, maintenance: 0 });
    expect(kpis.onTimeRate).toBeNull();
    expect(kpis.fleetUtilization).toBeNull();
    expect(kpis.avgTransitHours).toBeNull();
    expect(kpis.ordersPerDay).toHaveLength(14);
    expect(kpis.ordersPerDay[0]).toEqual({ date: '2026-10-18', count: 0 });
    expect(kpis.ordersPerDay[13]).toEqual({ date: '2026-10-31', count: 0 });
    expect(kpis.warehouses).toEqual([]);
    expect(kpis.recentOrders).toEqual([]);
  });

  test('computes counts, rates, transit time, per-day, warehouses and recent orders', async () => {
    const w2 = await insertWarehouse(pool, { code: 'WH-02', name: 'Lviv' });
    const w1 = await insertWarehouse(pool, { code: 'WH-01', name: 'Kyiv Hub' });
    const v1 = await insertVehicle(pool, { licensePlate: 'AA0001AA' });
    const v2 = await insertVehicle(pool, { licensePlate: 'AA0002AA' });
    const v3 = await insertVehicle(pool, { licensePlate: 'AA0003AA', status: 'on_trip' });
    await insertVehicle(pool, { licensePlate: 'AA0004AA', status: 'maintenance' });

    // delivered on time
    const o1 = await insertOrder(pool, { status: 'delivered', type: 'transfer', vehicleId: v1, originWarehouseId: w1,
      destinationWarehouseId: w2, plannedDeliveryDate: '2026-10-29', deliveredAt: utc(2026, 10, 29, 18), createdAt: utc(2026, 10, 27) });
    // delivered late
    const o2 = await insertOrder(pool, { status: 'delivered', vehicleId: v2, originWarehouseId: w1,
      plannedDeliveryDate: '2026-10-28', deliveredAt: utc(2026, 10, 30, 8), createdAt: utc(2026, 10, 28) });
    // delivered without planned date -> excluded from on-time denominator; no in_transit history -> not in average
    await insertOrder(pool, { status: 'delivered', type: 'inbound', destinationWarehouseId: w1,
      deliveredAt: utc(2026, 10, 31, 9), createdAt: utc(2026, 10, 31, 8) });
    const o4 = await insertOrder(pool, { status: 'in_transit', vehicleId: v3, createdAt: utc(2026, 10, 31, 9) });
    await insertOrder(pool, { status: 'cancelled', createdAt: utc(2026, 9, 1) }); // outside the 14-day window
    const o6 = await insertOrder(pool, { status: 'new', createdAt: utc(2026, 10, 31, 11), podSignature: 'data:image/png;base64,xx' });

    await insertHistory(pool, { orderId: o1, fromStatus: 'new', toStatus: 'in_transit', changedAt: utc(2026, 10, 29, 8) });  // 10h
    await insertHistory(pool, { orderId: o2, fromStatus: 'new', toStatus: 'in_transit', changedAt: utc(2026, 10, 27, 8) });  // superseded
    await insertHistory(pool, { orderId: o2, fromStatus: 'new', toStatus: 'in_transit', changedAt: utc(2026, 10, 29, 8) });  // 24h (latest)
    await insertHistory(pool, { orderId: o2, fromStatus: 'in_transit', toStatus: 'delivered', changedAt: utc(2026, 10, 30, 8) });
    await insertHistory(pool, { orderId: o4, fromStatus: 'new', toStatus: 'in_transit', changedAt: utc(2026, 10, 31, 9) });

    const kpis = await service().getKpis();

    expect(kpis.orders).toEqual({ total: 6, new: 1, in_transit: 1, delivered: 3, cancelled: 1 });
    expect(kpis.vehicles).toEqual({ total: 4, available: 2, on_trip: 1, maintenance: 1 });
    expect(kpis.onTimeRate).toBe(0.5);
    expect(kpis.fleetUtilization).toBe(0.3333);
    expect(kpis.avgTransitHours).toBe(17);

    const perDay = Object.fromEntries(kpis.ordersPerDay.map(d => [d.date, d.count]));
    expect(perDay['2026-10-27']).toBe(1);
    expect(perDay['2026-10-28']).toBe(1);
    expect(perDay['2026-10-31']).toBe(3);
    expect(kpis.ordersPerDay.reduce((s, d) => s + d.count, 0)).toBe(5);

    expect(kpis.warehouses).toEqual([
      { id: w1, code: 'WH-01', name: 'Kyiv Hub', inbound: 1, outbound: 2 },
      { id: w2, code: 'WH-02', name: 'Lviv', inbound: 1, outbound: 0 },
    ]);

    expect(kpis.recentOrders).toHaveLength(5);
    expect(kpis.recentOrders[0]).toMatchObject({ id: o6, orderNumber: expect.stringMatching(/^ORD-\d{6}$/) });
    expect(kpis.recentOrders[0]).not.toHaveProperty('podSignature');
    expect(kpis.recentOrders[1]).toMatchObject({ id: o4, truckPlate: 'AA0003AA', driverName: 'John Smith' });
  });

  test('ordersPerDay and on-time use UTC calendar days', async () => {
    await insertOrder(pool, { createdAt: new Date('2026-10-31T23:30:00Z') }); // late UTC evening -> still 10-31
    await insertOrder(pool, { createdAt: new Date('2026-10-18T00:30:00Z') }); // first day of the window
    await insertOrder(pool, { createdAt: new Date('2026-10-17T23:59:00Z') }); // day before the window
    await insertOrder(pool, { status: 'delivered', plannedDeliveryDate: '2026-10-30',
      deliveredAt: new Date('2026-10-30T23:45:00Z'), createdAt: new Date('2026-10-01T10:00:00Z') });
    const kpis = await service(new Date('2026-10-31T00:10:00Z')).getKpis();
    expect(kpis.ordersPerDay[0]).toEqual({ date: '2026-10-18', count: 1 });
    expect(kpis.ordersPerDay[13]).toEqual({ date: '2026-10-31', count: 1 });
    expect(kpis.onTimeRate).toBe(1);
  });

  test('fleetUtilization null when all vehicles are in maintenance', async () => {
    await insertVehicle(pool, { status: 'maintenance' });
    expect((await service().getKpis()).fleetUtilization).toBeNull();
  });
});
