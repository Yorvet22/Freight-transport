const WarehouseService = require('../../src/services/warehouseService');
const { fakeRepos, fakeAudit, rejection } = require('./fakes');

const USER = { id: 1, username: 'admin', role: 'admin' };
const NOW  = new Date('2026-05-10T12:00:00Z');
const payload = (o = {}) => ({ code: 'WH-01', name: 'Kyiv Central Hub', address: '12 Industrial St', city: 'Kyiv',
  capacityPallets: 1200, managerName: 'Olena Marsh', phone: '+380441234567', ...o });

describe('WarehouseService', () => {
  let repos;
  let audit;
  let service;
  beforeEach(() => {
    repos   = fakeRepos();
    audit   = fakeAudit();
    service = new WarehouseService(repos, { now: () => NOW, audit });
  });

  it('creates an active warehouse with createdAt and audits it', async () => {
    const w = await service.create(payload(), USER);
    expect(w).toMatchObject({ id: 1, code: 'WH-01', isActive: true, createdAt: NOW });
    expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'create', entity: 'warehouse', entityId: 1,
      details: { code: 'WH-01' } });
  });

  it('validates fields', async () => {
    const err = await rejection(service.create({ code: 'x'.repeat(21), phone: 'p'.repeat(31), capacityPallets: 'many', isActive: 'yes' }, USER));
    expect(err.details.map((d) => d.field).sort()).toEqual(['address', 'capacityPallets', 'city', 'code', 'isActive', 'name', 'phone']);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects duplicate codes', async () => {
    await service.create(payload(), USER);
    const other = await service.create(payload({ code: 'WH-02' }), USER);
    expect((await rejection(service.create(payload({ code: 'wh-01' }), USER))).code).toBe('DUPLICATE_CODE');
    expect((await rejection(service.update(other.id, payload(), USER))).code).toBe('DUPLICATE_CODE');
  });

  it('updates fields, keeps isActive unless provided and audits the update', async () => {
    const w = await service.create(payload(), USER);
    expect((await service.update(w.id, payload({ isActive: false }), USER)).isActive).toBe(false);
    const renamed = await service.update(w.id, payload({ name: 'Renamed' }), USER);
    expect(renamed).toMatchObject({ name: 'Renamed', isActive: false, createdAt: NOW });
    expect(audit.record).toHaveBeenLastCalledWith({ user: USER, action: 'update', entity: 'warehouse', entityId: w.id,
      details: { code: 'WH-01' } });
  });

  it('BR6: refuses to delete a warehouse with open orders', async () => {
    const w = await service.create(payload(), USER);
    repos.warehouseRepo.countOpenOrders.mockResolvedValueOnce(2);
    expect(await rejection(service.delete(w.id, USER))).toMatchObject({ code: 'WAREHOUSE_IN_USE', status: 409 });
    expect(repos.warehouseRepo.deleteById).not.toHaveBeenCalled();
    audit.record.mockClear();
    await service.delete(w.id, USER);
    expect(repos.warehouseRepo.deleteById).toHaveBeenCalledWith(w.id);
    expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'delete', entity: 'warehouse', entityId: w.id,
      details: { code: 'WH-01' } });
  });

  it('NOT_FOUND for unknown ids', async () => {
    expect((await rejection(service.getById(5))).code).toBe('NOT_FOUND');
    expect((await rejection(service.update(5, payload(), USER))).code).toBe('NOT_FOUND');
    expect((await rejection(service.delete(5, USER))).code).toBe('NOT_FOUND');
    expect((await rejection(service.getSchedule(5, {}))).code).toBe('NOT_FOUND');
  });

  it('lists with active filter and validates the query', async () => {
    await service.list({ active: 'true' });
    expect(repos.warehouseRepo.list).toHaveBeenCalledWith(expect.objectContaining({ active: true, sort: 'code', dir: 'asc' }));
    expect((await rejection(service.list({ active: 'yes' }))).code).toBe('INVALID_QUERY');
  });

  describe('getSchedule()', () => {
    it('queries departures by pickup date and arrivals by planned date (defaults to today, UTC)', async () => {
      const a = await service.create(payload(), USER);
      repos.orderRepo.listAll
        .mockResolvedValueOnce([{ clientName: 'early' }])
        .mockResolvedValueOnce([{ clientName: 'arrival' }]);
      const today = await service.getSchedule(a.id, {});
      expect(today).toEqual({ date: '2026-05-10', departures: [{ clientName: 'early' }], arrivals: [{ clientName: 'arrival' }] });
      expect(repos.orderRepo.listAll).toHaveBeenCalledWith({ originWarehouseId: a.id, pickupDate: '2026-05-10',
        sort: 'pickupWindowStart', dir: 'asc' });
      expect(repos.orderRepo.listAll).toHaveBeenCalledWith({ destinationWarehouseId: a.id, plannedDeliveryDate: '2026-05-10',
        sort: 'createdAt', dir: 'asc' });
      expect((await service.getSchedule(a.id, { date: '2026-05-11' })).date).toBe('2026-05-11');
    });

    it('rejects an invalid date with INVALID_QUERY', async () => {
      const a = await service.create(payload(), USER);
      expect((await rejection(service.getSchedule(a.id, { date: '10.05.2026' }))).code).toBe('INVALID_QUERY');
    });
  });
});
