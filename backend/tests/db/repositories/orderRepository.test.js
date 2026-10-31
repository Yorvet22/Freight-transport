const { getTestPool, resetDatabase, closeTestPool } = require('../../helpers/db');
const { repos, warehouse, vehicle, order, created } = require('./fixtures');

describe('OrderRepository (MySQL)', () => {
  let orderRepo; let vehicleRepo; let warehouseRepo; let historyRepo;
  let kyiv; let lviv; let truck;

  beforeAll(() => { ({ orderRepo, vehicleRepo, warehouseRepo, historyRepo } = repos()); });
  beforeEach(async () => {
    await resetDatabase();
    kyiv  = await warehouseRepo.create(warehouse());
    lviv  = await warehouseRepo.create(warehouse({ code: 'WH-02', name: 'Lviv West Depot', city: 'Lviv' }));
    truck = await vehicleRepo.create(vehicle());
  });
  afterAll(() => closeTestPool());

  const count = async (table) => (await getTestPool().query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n;
  const number = (id) => `ORD-${String(id).padStart(6, '0')}`;

  describe('create', () => {
    it('derives orderNumber from the id and writes the initial history row', async () => {
      const id = await orderRepo.create(order({ originWarehouseId: kyiv }), created());
      const saved = await orderRepo.findById(id);
      expect(saved.orderNumber).toBe(number(id));
      expect(saved).toMatchObject({ type: 'outbound', status: 'new', cargoWeight: 1250.5, originWarehouseId: kyiv });
      expect(saved.createdAt).toEqual(new Date('2026-10-01T08:00:00Z'));
      const history = await historyRepo.findByOrderId(id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ orderId: id, fromStatus: null, toStatus: 'new', changedBy: 'admin' });
    });

    it('works without a history entry and ignores non-whitelisted keys', async () => {
      const id = await orderRepo.create(order({ id: 999, orderNumber: 'HACK', bogus: 'x' }));
      const saved = await orderRepo.findById(id);
      expect(id).not.toBe(999);
      expect(saved.orderNumber).toBe(number(id));
      expect(await count('order_status_history')).toBe(0);
    });

    it('assigns distinct numbers to concurrent creates', async () => {
      const ids = await Promise.all([1, 2, 3, 4, 5].map(() => orderRepo.create(order(), created())));
      const numbers = await Promise.all(ids.map(async (id) => (await orderRepo.findById(id)).orderNumber));
      expect(new Set(numbers).size).toBe(5);
      ids.forEach((id, i) => expect(numbers[i]).toBe(number(id)));
    });

    it('is all-or-nothing: a failing history insert leaves no order behind', async () => {
      await expect(orderRepo.create(order(), created(null))).rejects.toThrow();
      expect(await count('orders')).toBe(0);
    });
  });

  describe('findById', () => {
    it('returns joined fields and podSignature', async () => {
      const id = await orderRepo.create(order({
        type: 'transfer', vehicleId: truck, originWarehouseId: kyiv, destinationWarehouseId: lviv,
        plannedDeliveryDate: '2026-10-05', podSignature: 'data:image/png;base64,AAAA',
      }));
      expect(await orderRepo.findById(id)).toMatchObject({
        truckPlate: 'AA 1001 AA', driverName: 'John Smith',
        originWarehouseName: 'Kyiv Central Hub', destinationWarehouseName: 'Lviv West Depot',
        plannedDeliveryDate: '2026-10-05', podSignature: 'data:image/png;base64,AAAA',
      });
    });

    it('returns null joined fields when nothing is linked, and null for a missing id', async () => {
      const id = await orderRepo.create(order());
      expect(await orderRepo.findById(id)).toMatchObject({
        truckPlate: null, driverName: null, originWarehouseName: null, destinationWarehouseName: null,
      });
      expect(await orderRepo.findById(12345)).toBeNull();
    });
  });

  describe('update / deleteById', () => {
    it('updates whitelisted columns only', async () => {
      const id = await orderRepo.create(order());
      await orderRepo.update(id, { clientName: 'Contoso Ltd', orderNumber: 'HACK', vehicleId: truck });
      expect(await orderRepo.findById(id)).toMatchObject({ clientName: 'Contoso Ltd', vehicleId: truck, orderNumber: number(id) });
      await expect(orderRepo.update(id, { unknown: 1 })).resolves.toBeUndefined();
    });

    it('deletes the order and cascades its history', async () => {
      const id = await orderRepo.create(order(), created());
      expect(await orderRepo.deleteById(id)).toBe(true);
      expect(await orderRepo.findById(id)).toBeNull();
      expect(await count('order_status_history')).toBe(0);
      expect(await orderRepo.deleteById(id)).toBe(false);
    });
  });

  describe('applyStatusChange', () => {
    it('updates order, vehicle and history atomically', async () => {
      const id = await orderRepo.create(order({ vehicleId: truck }), created());
      await orderRepo.applyStatusChange({
        orderId: id, orderPatch: { status: 'in_transit' }, vehicleId: truck, vehicleStatus: 'on_trip',
        historyEntry: { fromStatus: 'new', toStatus: 'in_transit', changedBy: 'dispatcher', note: 'Left the dock' },
      });
      expect((await orderRepo.findById(id)).status).toBe('in_transit');
      expect((await vehicleRepo.findById(truck)).status).toBe('on_trip');
      const history = await historyRepo.findByOrderId(id);
      expect(history.map((h) => h.toStatus)).toEqual(['new', 'in_transit']);
      expect(history[1]).toMatchObject({ fromStatus: 'new', changedBy: 'dispatcher', note: 'Left the dock' });
    });

    it('stores POD fields and leaves vehicles alone when no vehicle is given', async () => {
      const id = await orderRepo.create(order({ vehicleId: truck }), created());
      const deliveredAt = new Date('2026-10-03T12:30:00Z');
      await orderRepo.applyStatusChange({
        orderId: id, orderPatch: { status: 'delivered', deliveredAt, podRecipientName: 'Mary Major', podNote: 'OK' },
        vehicleId: null, vehicleStatus: null,
        historyEntry: { fromStatus: 'in_transit', toStatus: 'delivered', changedBy: 'admin', changedAt: deliveredAt },
      });
      expect(await orderRepo.findById(id)).toMatchObject({
        status: 'delivered', podRecipientName: 'Mary Major', podNote: 'OK', deliveredAt,
      });
      expect((await vehicleRepo.findById(truck)).status).toBe('available');
      expect((await historyRepo.findByOrderId(id))[1].changedAt).toEqual(deliveredAt);
    });

    it('rolls everything back when one statement fails', async () => {
      const id = await orderRepo.create(order({ vehicleId: truck }), created());
      await expect(orderRepo.applyStatusChange({
        orderId: id, orderPatch: { status: 'in_transit' }, vehicleId: truck, vehicleStatus: 'on_trip',
        historyEntry: { fromStatus: 'new', toStatus: null },
      })).rejects.toThrow();
      expect((await orderRepo.findById(id)).status).toBe('new');
      expect((await vehicleRepo.findById(truck)).status).toBe('available');
      expect(await historyRepo.findByOrderId(id)).toHaveLength(1);
    });
  });

  describe('list', () => {
    let ids;
    beforeEach(async () => {
      const van = await vehicleRepo.create(vehicle({ licensePlate: 'BC 2002 BC', driverName: 'Peter Brown', model: 'MAN TGX' }));
      ids = {
        a: await orderRepo.create(order({ clientName: 'Alpha Foods', type: 'outbound', originWarehouseId: kyiv,
          cargoWeight: 300, vehicleId: truck, createdAt: new Date('2026-10-01T08:00:00Z') })),
        b: await orderRepo.create(order({ clientName: 'Beta 100% Steel', type: 'inbound', destinationWarehouseId: kyiv,
          cargoWeight: 900, vehicleId: van, status: 'in_transit', createdAt: new Date('2026-10-02T08:00:00Z') })),
        c: await orderRepo.create(order({ clientName: 'Gamma_Logistics', type: 'transfer', originWarehouseId: lviv,
          destinationWarehouseId: kyiv, cargoWeight: 50, status: 'delivered', createdAt: new Date('2026-10-03T08:00:00Z'),
          podSignature: 'data:image/png;base64,AAAA', cargoDescription: 'Spare parts' })),
        d: await orderRepo.create(order({ clientName: 'Delta Retail', type: 'outbound', originWarehouseId: lviv,
          cargoWeight: 600, status: 'cancelled', createdAt: new Date('2026-10-04T08:00:00Z') })),
      };
    });

    const listIds = async (query) => (await orderRepo.list({ page: 1, limit: 20, ...query })).items.map((o) => o.id);

    it('defaults to createdAt desc, returns total and joined fields, omits podSignature', async () => {
      const { items, total } = await orderRepo.list({ page: 1, limit: 20 });
      expect(total).toBe(4);
      expect(items.map((o) => o.id)).toEqual([ids.d, ids.c, ids.b, ids.a]);
      expect(items.find((o) => o.id === ids.a)).toMatchObject({ truckPlate: 'AA 1001 AA', originWarehouseName: 'Kyiv Central Hub' });
      expect(items.find((o) => o.id === ids.c)).toMatchObject({ originWarehouseName: 'Lviv West Depot', destinationWarehouseName: 'Kyiv Central Hub' });
      items.forEach((o) => expect(o).not.toHaveProperty('podSignature'));
    });

    it('paginates with a total that ignores the page', async () => {
      const page2 = await orderRepo.list({ page: 2, limit: 3 });
      expect(page2.total).toBe(4);
      expect(page2.items.map((o) => o.id)).toEqual([ids.a]);
    });

    it('falls back to page 1 / limit 20 when paging is missing', async () => {
      expect((await orderRepo.list({})).items).toHaveLength(4);
      expect((await orderRepo.list()).total).toBe(4);
    });

    it('filters by status, type and vehicleId', async () => {
      expect(await listIds({ status: 'in_transit' })).toEqual([ids.b]);
      expect(await listIds({ type: 'outbound' })).toEqual([ids.d, ids.a]);
      expect(await listIds({ vehicleId: truck })).toEqual([ids.a]);
    });

    it('filters by warehouseId and direction', async () => {
      expect(await listIds({ warehouseId: kyiv, direction: 'inbound' })).toEqual([ids.c, ids.b]);
      expect(await listIds({ warehouseId: kyiv, direction: 'outbound' })).toEqual([ids.a]);
      expect(await listIds({ warehouseId: kyiv, direction: 'any' })).toEqual([ids.c, ids.b, ids.a]);
      expect(await listIds({ warehouseId: lviv })).toEqual([ids.d, ids.c]);
    });

    it('searches orderNumber, client, cargo, plate and driver (case-insensitive)', async () => {
      const num = (await orderRepo.findById(ids.c)).orderNumber;
      expect(await listIds({ q: num })).toEqual([ids.c]);
      expect(await listIds({ q: 'alpha' })).toEqual([ids.a]);
      expect(await listIds({ q: 'SPARE' })).toEqual([ids.c]);
      expect(await listIds({ q: 'BC 2002' })).toEqual([ids.b]);
      expect(await listIds({ q: 'peter' })).toEqual([ids.b]);
      expect((await orderRepo.list({ page: 1, limit: 1, q: 'peter' })).total).toBe(1);
    });

    it('treats %, _ and backslash in the search text literally', async () => {
      expect(await listIds({ q: '100%' })).toEqual([ids.b]);
      expect(await listIds({ q: '%' })).toEqual([ids.b]);
      expect(await listIds({ q: '_' })).toEqual([ids.c]);
      expect(await listIds({ q: '\\' })).toEqual([]);
    });

    it('sorts by whitelisted fields in both directions', async () => {
      expect(await listIds({ sort: 'cargoWeight', dir: 'asc' })).toEqual([ids.c, ids.a, ids.d, ids.b]);
      expect(await listIds({ sort: 'clientName', dir: 'desc' })).toEqual([ids.c, ids.d, ids.b, ids.a]);
      expect(await listIds({ sort: 'orderNumber', dir: 'asc' })).toEqual([ids.a, ids.b, ids.c, ids.d]);
      expect(await listIds({ sort: 'status', dir: 'asc' })).toEqual([ids.d, ids.c, ids.b, ids.a]);
    });

    it('ignores non-whitelisted sort names and directions (no SQL injection)', async () => {
      expect(await listIds({ sort: 'id; DROP TABLE orders', dir: 'desc' })).toEqual([ids.d, ids.c, ids.b, ids.a]);
      expect(await listIds({ sort: 'createdAt', dir: 'sideways' })).toEqual([ids.d, ids.c, ids.b, ids.a]);
      expect(await listIds({ sort: 'createdAt', dir: 'asc' })).toEqual([ids.a, ids.b, ids.c, ids.d]);
      expect(await count('orders')).toBe(4);
    });

    it('combines filters', async () => {
      expect(await listIds({ type: 'outbound', warehouseId: lviv, status: 'cancelled', q: 'delta' })).toEqual([ids.d]);
      expect(await orderRepo.list({ page: 1, limit: 20, type: 'inbound', status: 'new' })).toEqual({ items: [], total: 0 });
    });
  });

  describe('listAll', () => {
    it('returns every order (newest first by default) without podSignature, honouring filters', async () => {
      const a = await orderRepo.create(order({ originWarehouseId: kyiv, createdAt: new Date('2026-10-01T08:00:00Z'),
        pickupWindowStart: new Date('2026-10-06T09:00:00Z'), podSignature: 'data:image/png;base64,AAAA' }));
      const b = await orderRepo.create(order({ originWarehouseId: kyiv, createdAt: new Date('2026-10-02T23:59:59Z'),
        pickupWindowStart: new Date('2026-10-06T07:00:00Z'), vehicleId: truck }));
      const c = await orderRepo.create(order({ type: 'inbound', destinationWarehouseId: lviv,
        createdAt: new Date('2026-10-03T00:00:00Z'), plannedDeliveryDate: '2026-10-06', status: 'delivered' }));

      const all = await orderRepo.listAll();
      expect(all.map((o) => o.id)).toEqual([c, b, a]);
      all.forEach((o) => expect(o).not.toHaveProperty('podSignature'));
      expect(all[1]).toMatchObject({ truckPlate: 'AA 1001 AA', originWarehouseName: 'Kyiv Central Hub' });

      const ids = async (filters) => (await orderRepo.listAll(filters)).map((o) => o.id);
      expect(await ids({ from: '2026-10-02', to: '2026-10-02' })).toEqual([b]);
      expect(await ids({ from: '2026-10-02' })).toEqual([c, b]);
      expect(await ids({ originWarehouseId: kyiv, pickupDate: '2026-10-06', sort: 'pickupWindowStart', dir: 'asc' })).toEqual([b, a]);
      expect(await ids({ destinationWarehouseId: lviv, plannedDeliveryDate: '2026-10-06' })).toEqual([c]);
      expect(await ids({ status: 'delivered' })).toEqual([c]);
      expect(await ids({ vehicleId: truck })).toEqual([b]);
      expect(await ids({ warehouseId: kyiv, direction: 'outbound' })).toEqual([b, a]);
      expect(await ids({ pickupDate: '2026-10-07' })).toEqual([]);
    });
  });

  describe('foreign keys', () => {
    it('sets vehicleId / warehouse ids to NULL when the referenced row is deleted', async () => {
      const id = await orderRepo.create(order({ type: 'transfer', vehicleId: truck, originWarehouseId: kyiv, destinationWarehouseId: lviv }));
      await vehicleRepo.deleteById(truck);
      await warehouseRepo.deleteById(kyiv);
      await warehouseRepo.deleteById(lviv);
      expect(await orderRepo.findById(id)).toMatchObject({
        vehicleId: null, originWarehouseId: null, destinationWarehouseId: null, truckPlate: null, originWarehouseName: null,
      });
    });

    it('rejects references to missing rows and rolls the create back', async () => {
      await expect(orderRepo.create(order({ vehicleId: 9999 }), created())).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
      expect(await count('orders')).toBe(0);
    });
  });
});
