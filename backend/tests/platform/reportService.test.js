// Report summary computed in SQL (ReportRepository) + ReportService composition, against the test DB.
const { getTestPool, resetDatabase, closeTestPool } = require('../helpers/db');
const ReportRepository = require('../../src/repositories/reportRepository');
const OrderRepository  = require('../../src/repositories/orderRepository');
const ReportService    = require('../../src/services/reportService');
const { utc, insertWarehouse, insertVehicle, insertOrder } = require('./fixtures');

let pool;
let svc;
let ids;

beforeAll(async () => {
  pool = getTestPool();
  await resetDatabase();
  const w1 = await insertWarehouse(pool, { code: 'WH-01', name: 'Kyiv Hub' });
  const w2 = await insertWarehouse(pool, { code: 'WH-02', name: 'Lviv Depot' });
  const v2 = await insertVehicle(pool, { licensePlate: 'BB2222BB', driverName: 'Jane Doe' });
  const v1 = await insertVehicle(pool, { licensePlate: 'AA1111AA', driverName: 'John Smith' });
  const o1 = await insertOrder(pool, { status: 'delivered', vehicleId: v1, type: 'transfer', originWarehouseId: w1,
    destinationWarehouseId: w2, cargoWeight: 1000.5, createdAt: utc(2026, 10, 1) });
  const o2 = await insertOrder(pool, { status: 'in_transit', vehicleId: v1, originWarehouseId: w1, cargoWeight: 200,
    createdAt: utc(2026, 10, 5) });
  const o3 = await insertOrder(pool, { status: 'cancelled', vehicleId: v2, type: 'inbound', destinationWarehouseId: w1,
    cargoWeight: 50, createdAt: utc(2026, 10, 15) });
  const o4 = await insertOrder(pool, { status: 'new', type: 'inbound', destinationWarehouseId: w2, cargoWeight: 25.25,
    createdAt: utc(2026, 10, 20), podSignature: 'data:image/png;base64,xx' });
  ids = { w1, w2, v1, v2, o1, o2, o3, o4 };
  svc = new ReportService({ reportRepo: new ReportRepository(pool), orderRepo: new OrderRepository(pool) });
});
afterAll(() => closeTestPool());

describe('ReportService.getSummary (MySQL)', () => {
  test('no filters: totals, breakdowns and orders', async () => {
    const r = await svc.getSummary({});
    expect(r.filters).toEqual({ from: null, to: null, warehouseId: null, vehicleId: null });
    expect(r.totals).toEqual({
      orders: 4, delivered: 1, inTransit: 1, cancelled: 1, new: 1, totalWeight: 1275.75, deliveryRate: 0.25,
    });
    expect(r.byWarehouse).toEqual([
      { warehouseId: ids.w1, code: 'WH-01', name: 'Kyiv Hub', inbound: 1, outbound: 2, weight: 1250.5 },
      { warehouseId: ids.w2, code: 'WH-02', name: 'Lviv Depot', inbound: 2, outbound: 0, weight: 1025.75 },
    ]);
    expect(r.byVehicle).toEqual([
      { vehicleId: ids.v1, licensePlate: 'AA1111AA', driverName: 'John Smith', trips: 2, delivered: 1, weight: 1200.5 },
      { vehicleId: ids.v2, licensePlate: 'BB2222BB', driverName: 'Jane Doe', trips: 0, delivered: 0, weight: 0 },
    ]);
    expect(r.orders.map(o => o.id)).toEqual([ids.o4, ids.o3, ids.o2, ids.o1]);
    expect(r.orders[0]).not.toHaveProperty('podSignature');
    expect(r.orders[0]).toHaveProperty('destinationWarehouseName', 'Lviv Depot');
  });

  test('date range is inclusive on both ends (createdAt UTC date)', async () => {
    const r = await svc.getSummary({ from: '2026-10-05', to: '2026-10-15' });
    expect(r.filters).toEqual({ from: '2026-10-05', to: '2026-10-15', warehouseId: null, vehicleId: null });
    expect(r.orders.map(o => o.id)).toEqual([ids.o3, ids.o2]);
    expect(r.totals).toMatchObject({ orders: 2, deliveryRate: 0, totalWeight: 250 });
    expect(r.byVehicle[0]).toMatchObject({ vehicleId: ids.v1, trips: 1, delivered: 0, weight: 200 });
  });

  test('warehouseId matches origin or destination and narrows byWarehouse', async () => {
    const r = await svc.getSummary({ warehouseId: String(ids.w2) });
    expect(r.filters.warehouseId).toBe(ids.w2);
    expect(r.orders.map(o => o.id)).toEqual([ids.o4, ids.o1]);
    expect(r.byWarehouse).toEqual([
      { warehouseId: ids.w2, code: 'WH-02', name: 'Lviv Depot', inbound: 2, outbound: 0, weight: 1025.75 },
    ]);
    expect(r.byVehicle).toHaveLength(2);
  });

  test('vehicleId narrows orders and byVehicle', async () => {
    const r = await svc.getSummary({ vehicleId: String(ids.v2) });
    expect(r.orders.map(o => o.id)).toEqual([ids.o3]);
    expect(r.byVehicle.map(v => v.vehicleId)).toEqual([ids.v2]);
    expect(r.totals).toMatchObject({ orders: 1, cancelled: 1, deliveryRate: 0 });
  });

  test('unknown entity id -> empty breakdown, zero totals', async () => {
    const r = await svc.getSummary({ vehicleId: '99999' });
    expect(r.byVehicle).toEqual([]);
    expect(r.totals.orders).toBe(0);
  });

  test('empty result -> zero totals', async () => {
    const r = await svc.getSummary({ from: '2030-01-01' });
    expect(r.totals).toEqual({ orders: 0, delivered: 0, inTransit: 0, cancelled: 0, new: 0, totalWeight: 0, deliveryRate: 0 });
    expect(r.byWarehouse.every(w => w.inbound === 0 && w.outbound === 0 && w.weight === 0)).toBe(true);
    expect(r.orders).toEqual([]);
  });

  test.each([
    [{ from: '2026-13-01' }], [{ to: 'yesterday' }], [{ from: '2026-10-10', to: '2026-10-01' }],
    [{ warehouseId: 'abc' }], [{ vehicleId: '0' }], [{ vehicleId: '1.5' }], [{ from: ['2026-10-01', 'x'] }],
  ])('invalid query -> 400 INVALID_QUERY (case %#)', async query => {
    await expect(svc.getSummary(query)).rejects.toMatchObject({ code: 'INVALID_QUERY', status: 400 });
  });

  test('empty strings are treated as absent filters', async () => {
    const r = await svc.getSummary({ from: '', to: '', warehouseId: '', vehicleId: '' });
    expect(r.filters).toEqual({ from: null, to: null, warehouseId: null, vehicleId: null });
  });
});

describe('ReportService date boundaries (MySQL)', () => {
  test('from/to use UTC calendar days at the boundaries', async () => {
    await resetDatabase();
    const edge = [];
    for (const iso of ['2026-10-05T00:15:00Z', '2026-10-05T23:45:00Z', '2026-10-04T23:59:00Z', '2026-10-06T00:01:00Z']) {
      edge.push(await insertOrder(pool, { createdAt: new Date(iso) }));
    }
    const r = await svc.getSummary({ from: '2026-10-05', to: '2026-10-05' });
    expect(r.orders.map(o => o.id)).toEqual([edge[1], edge[0]]);
    expect(r.totals.orders).toBe(2);
  });
});
