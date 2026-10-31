const { resetDatabase, closeTestPool } = require('../../helpers/db');
const { repos, warehouse, order } = require('./fixtures');

describe('WarehouseRepository (MySQL)', () => {
  let warehouseRepo; let orderRepo;
  beforeAll(() => { ({ warehouseRepo, orderRepo } = repos()); });
  beforeEach(() => resetDatabase());
  afterAll(() => closeTestPool());

  it('creates, finds, updates and deletes; isActive is a boolean', async () => {
    const createdAt = new Date('2026-09-01T10:00:00Z');
    const id = await warehouseRepo.create(warehouse({ createdAt, id: 55 }));
    expect(await warehouseRepo.findById(id)).toEqual({
      id, code: 'WH-01', name: 'Kyiv Central Hub', address: '1 Industrial Ave', city: 'Kyiv', capacityPallets: 1000,
      managerName: 'Anna Green', phone: '+380 44 000 0001', isActive: true, createdAt,
    });
    await warehouseRepo.update(id, { isActive: false, name: 'Kyiv Hub', unknown: 1 });
    expect(await warehouseRepo.findById(id)).toMatchObject({ isActive: false, name: 'Kyiv Hub' });
    expect(await warehouseRepo.deleteById(id)).toBe(true);
    expect(await warehouseRepo.findById(id)).toBeNull();
    expect(await warehouseRepo.deleteById(id)).toBe(false);
  });

  it('sets createdAt when omitted and nullable fields default to null', async () => {
    const before = Date.now() - 1000;
    const id = await warehouseRepo.create({ code: 'WH-09', name: 'Small', address: 'A', city: 'B' });
    const saved = await warehouseRepo.findById(id);
    expect(saved).toMatchObject({ isActive: true, capacityPallets: null, managerName: null, phone: null });
    expect(saved.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('findByCode is exact but case-insensitive', async () => {
    const id = await warehouseRepo.create(warehouse());
    expect((await warehouseRepo.findByCode('wh-01')).id).toBe(id);
    expect(await warehouseRepo.findByCode('WH-0')).toBeNull();
  });

  it('surfaces ER_DUP_ENTRY on a duplicate code', async () => {
    await warehouseRepo.create(warehouse());
    await expect(warehouseRepo.create(warehouse())).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  describe('list / listAll', () => {
    let ids;
    beforeEach(async () => {
      ids = {
        a: await warehouseRepo.create(warehouse({ code: 'WH-03', name: 'Odesa Port Terminal', city: 'Odesa', address: '7 Harbour Rd' })),
        b: await warehouseRepo.create(warehouse({ code: 'WH-01', name: 'Kyiv Central Hub', city: 'Kyiv' })),
        c: await warehouseRepo.create(warehouse({ code: 'WH-02', name: 'Lviv West Depot', city: 'Lviv', isActive: false })),
      };
    });
    const listIds = async (query) => (await warehouseRepo.list({ page: 1, limit: 20, ...query })).items.map((w) => w.id);

    it('defaults to code asc, paginates and maps isActive', async () => {
      const { items, total } = await warehouseRepo.list({ page: 1, limit: 2 });
      expect(total).toBe(3);
      expect(items.map((w) => w.id)).toEqual([ids.b, ids.c]);
      expect(items[1].isActive).toBe(false);
      expect((await warehouseRepo.list()).items).toHaveLength(3);
    });

    it('filters by active and searches code, name, city and address', async () => {
      expect(await listIds({ active: true })).toEqual([ids.b, ids.a]);
      expect(await listIds({ active: false })).toEqual([ids.c]);
      expect(await listIds({ q: 'harbour' })).toEqual([ids.a]);
      expect(await listIds({ q: 'lviv' })).toEqual([ids.c]);
      expect(await listIds({ q: 'wh-0' })).toEqual([ids.b, ids.c, ids.a]);
      expect(await listIds({ q: '%' })).toEqual([]);
      expect((await warehouseRepo.list({ page: 1, limit: 20, active: false, q: 'kyiv' })).total).toBe(0);
    });

    it('sorts by whitelisted fields only', async () => {
      expect(await listIds({ sort: 'name', dir: 'desc' })).toEqual([ids.a, ids.c, ids.b]);
      expect(await listIds({ sort: 'city', dir: 'asc' })).toEqual([ids.b, ids.c, ids.a]);
      expect(await listIds({ sort: '(SELECT 1)', dir: 'desc' })).toEqual([ids.a, ids.c, ids.b]);
    });

    it('listAll returns every warehouse ordered by code', async () => {
      const all = await warehouseRepo.listAll();
      expect(all.map((w) => w.id)).toEqual([ids.b, ids.c, ids.a]);
      expect(all.map((w) => w.isActive)).toEqual([true, false, true]);
    });
  });

  it('countOpenOrders counts new/in_transit orders referencing the warehouse either way', async () => {
    const kyiv = await warehouseRepo.create(warehouse());
    const lviv = await warehouseRepo.create(warehouse({ code: 'WH-02', name: 'Lviv West Depot' }));
    expect(await warehouseRepo.countOpenOrders(kyiv)).toBe(0);
    await orderRepo.create(order({ type: 'outbound', originWarehouseId: kyiv, status: 'new' }));
    await orderRepo.create(order({ type: 'inbound', destinationWarehouseId: kyiv, status: 'in_transit' }));
    await orderRepo.create(order({ type: 'transfer', originWarehouseId: lviv, destinationWarehouseId: kyiv, status: 'new' }));
    await orderRepo.create(order({ type: 'outbound', originWarehouseId: kyiv, status: 'delivered' }));
    await orderRepo.create(order({ type: 'outbound', originWarehouseId: kyiv, status: 'cancelled' }));
    await orderRepo.create(order({ type: 'outbound', originWarehouseId: lviv, status: 'new' }));
    expect(await warehouseRepo.countOpenOrders(kyiv)).toBe(3);
    expect(await warehouseRepo.countOpenOrders(lviv)).toBe(2);
    expect(await warehouseRepo.countOpenOrders(9999)).toBe(0);
  });
});
