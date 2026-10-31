const { resetDatabase, closeTestPool, seedDemo } = require('../../helpers/db');
const { repos, order, created } = require('./fixtures');

describe('HistoryRepository (MySQL)', () => {
  let historyRepo; let orderRepo;
  beforeAll(() => { ({ historyRepo, orderRepo } = repos()); });
  beforeEach(() => resetDatabase());
  afterAll(() => closeTestPool());

  it('adds entries and returns them oldest first per order', async () => {
    const a = await orderRepo.create(order(), created('new', { changedAt: new Date('2026-10-01T08:00:00Z') }));
    const b = await orderRepo.create(order());
    const later = await historyRepo.add({ orderId: a, fromStatus: 'in_transit', toStatus: 'delivered',
      changedAt: new Date('2026-10-03T08:00:00Z'), changedBy: 'admin', note: 'Signed', bogus: 1 });
    const middle = await historyRepo.add({ orderId: a, fromStatus: 'new', toStatus: 'in_transit',
      changedAt: new Date('2026-10-02T08:00:00Z') });
    await historyRepo.add({ orderId: b, fromStatus: null, toStatus: 'new', changedAt: new Date('2026-09-30T08:00:00Z') });

    const rows = await historyRepo.findByOrderId(a);
    expect(rows.map((r) => r.toStatus)).toEqual(['new', 'in_transit', 'delivered']);
    expect(rows[1]).toEqual({ id: middle, orderId: a, fromStatus: 'new', toStatus: 'in_transit',
      changedAt: new Date('2026-10-02T08:00:00Z'), changedBy: null, note: null });
    expect(rows[2]).toMatchObject({ id: later, changedBy: 'admin', note: 'Signed' });
    expect(await historyRepo.findByOrderId(9999)).toEqual([]);

    const all = await historyRepo.listAll();
    expect(all).toHaveLength(4);
    expect(all[0].orderId).toBe(b);
  });

  it('defaults changedAt to now', async () => {
    const id = await orderRepo.create(order());
    const before = Date.now() - 1000;
    await historyRepo.add({ orderId: id, fromStatus: null, toStatus: 'new' });
    expect((await historyRepo.findByOrderId(id))[0].changedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('rejects an entry for a missing order', async () => {
    await expect(historyRepo.add({ orderId: 9999, toStatus: 'new' })).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });

  it('reads the seeded demo data through the repositories', async () => {
    const counts = await seedDemo(undefined, { now: new Date('2026-10-31T12:00:00Z') });
    const { orderRepo: orders } = repos();
    expect((await orders.listAll()).length).toBe(counts.orders);
    expect((await historyRepo.listAll()).length).toBe(counts.history);
    const { items, total } = await orders.list({ page: 1, limit: 5 });
    expect(total).toBe(counts.orders);
    expect(items).toHaveLength(5);
  });
});
