// Minimal hand-rolled repository fakes for service unit tests (no database, SPEC §11).
// Each fake keeps rows in a plain object keyed by id; every method is a jest.fn so calls can be asserted.

function table(rows = []) {
  const byId = {};
  rows.forEach((row) => { byId[row.id] = { ...row }; });
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  return {
    byId,
    find:   async (id) => (byId[id] ? { ...byId[id] } : null),
    insert: async (data) => { const id = nextId++; byId[id] = { id, ...data }; return id; },
    patch:  async (id, data) => { byId[id] = { ...byId[id], ...data }; },
    remove: async (id) => { delete byId[id]; },
  };
}

function fakeRepos({ orders = [], vehicles = [], warehouses = [], history = [] } = {}) {
  const o = table(orders);
  const v = table(vehicles);
  const w = table(warehouses);
  const h = [...history];

  const orderRepo = {
    rows:              o.byId,
    list:              jest.fn(async () => ({ items: Object.values(o.byId), total: Object.keys(o.byId).length })),
    listAll:           jest.fn(async () => []),
    findById:          jest.fn(o.find),
    create:            jest.fn(async (data, entry) => {
      const id = await o.insert(data);
      await o.patch(id, { orderNumber: `ORD-${String(id).padStart(6, '0')}` });
      if (entry) h.push({ orderId: id, ...entry });
      return id;
    }),
    update:            jest.fn(o.patch),
    deleteById:        jest.fn(o.remove),
    applyStatusChange: jest.fn(async ({ orderId, orderPatch, vehicleId, vehicleStatus, historyEntry }) => {
      await o.patch(orderId, orderPatch);
      if (vehicleId && vehicleStatus) await v.patch(vehicleId, { status: vehicleStatus });
      h.push({ orderId, ...historyEntry });
    }),
  };
  const vehicleRepo = {
    rows:        v.byId,
    list:        jest.fn(async () => ({ items: Object.values(v.byId), total: Object.keys(v.byId).length })),
    findById:    jest.fn(v.find),
    findByPlate: jest.fn(async (plate) => Object.values(v.byId)
      .find((x) => x.licensePlate.toLowerCase() === plate.toLowerCase()) || null),
    create:      jest.fn(v.insert),
    update:      jest.fn(v.patch),
    deleteById:  jest.fn(v.remove),
  };
  const warehouseRepo = {
    rows:            w.byId,
    list:            jest.fn(async () => ({ items: Object.values(w.byId), total: Object.keys(w.byId).length })),
    findById:        jest.fn(w.find),
    findByCode:      jest.fn(async (code) => Object.values(w.byId)
      .find((x) => x.code.toLowerCase() === code.toLowerCase()) || null),
    create:          jest.fn(w.insert),
    update:          jest.fn(w.patch),
    deleteById:      jest.fn(w.remove),
    countOpenOrders: jest.fn(async () => 0),
  };
  const historyRepo = {
    rows:          h,
    findByOrderId: jest.fn(async (orderId) => h.filter((x) => x.orderId === orderId)),
  };
  return { orderRepo, vehicleRepo, warehouseRepo, historyRepo };
}

const fakeAudit = () => ({ record: jest.fn(async () => {}) });

async function rejection(promise) {
  try { await promise; } catch (err) { return err; }
  throw new Error('expected promise to reject');
}

module.exports = { fakeRepos, fakeAudit, rejection };
