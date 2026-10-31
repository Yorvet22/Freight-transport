const OrderService = require('../../src/services/orderService');
const { fakeRepos, fakeAudit, rejection } = require('./fakes');

const USER = { id: 7, username: 'dispatcher', role: 'dispatcher' };
const NOW  = new Date('2026-05-10T12:00:00Z');
const WH_A = 1;
const WH_B = 2;
const VEHICLE = 10;

describe('OrderService', () => {
  let repos;
  let audit;
  let service;

  const payload = (o = {}) => ({
    type: 'outbound', clientName: 'Acme Ltd', pickupAddress: '1 Depot Rd', deliveryAddress: '5 Market St',
    cargoDescription: 'Pallets of paper', cargoWeight: 1200, originWarehouseId: WH_A, ...o,
  });

  beforeEach(() => {
    repos = fakeRepos({
      warehouses: [
        { id: WH_A, code: 'WH-01', name: 'Kyiv Hub', isActive: true },
        { id: WH_B, code: 'WH-02', name: 'Lviv Terminal', isActive: true },
        { id: 3, code: 'WH-03', name: 'Closed', isActive: false },
      ],
      vehicles: [{ id: VEHICLE, licensePlate: 'AA1', status: 'available' }],
    });
    audit   = fakeAudit();
    service = new OrderService(repos, { now: () => NOW, audit });
  });

  const setOrderStatus = (id, status) => { repos.orderRepo.rows[id].status = status; };
  const setVehicleStatus = (status) => { repos.vehicleRepo.rows[VEHICLE].status = status; };

  describe('create()', () => {
    it('creates a new order and its first history row in one repository call', async () => {
      const order = await service.create(payload({ status: 'delivered', vehicleId: VEHICLE }), USER);
      expect(order).toMatchObject({ orderNumber: 'ORD-000001', status: 'new', createdAt: NOW, vehicleId: VEHICLE });
      expect(repos.orderRepo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'new' }),
        { fromStatus: null, toStatus: 'new', changedAt: NOW, changedBy: 'dispatcher', note: null });
    });

    it('records a create audit entry', async () => {
      const order = await service.create(payload(), USER);
      expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'create', entity: 'order', entityId: order.id,
        details: { orderNumber: 'ORD-000001' } });
    });

    it('ignores POD fields on create', async () => {
      await service.create(payload({ podRecipientName: 'X', podNote: 'Y' }), USER);
      const [data] = repos.orderRepo.create.mock.calls[0];
      expect(data).not.toHaveProperty('podRecipientName');
      expect(data).not.toHaveProperty('podNote');
    });

    it('validates required fields, lengths, weight and type', async () => {
      const err = await rejection(service.create({ clientName: 'x'.repeat(101), cargoWeight: 100001 }, USER));
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details.map((d) => d.field)).toEqual(expect.arrayContaining(['type', 'clientName', 'pickupAddress',
        'deliveryAddress', 'cargoDescription', 'cargoWeight']));
      expect(repos.orderRepo.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects a pickup window that ends before it starts', async () => {
      const err = await rejection(service.create(payload({ pickupWindowStart: '2026-05-11T10:00:00Z',
        pickupWindowEnd: '2026-05-11T09:00:00Z' }), USER));
      expect(err.details).toEqual([expect.objectContaining({ field: 'pickupWindowEnd' })]);
    });

    describe('BR1 type ↔ warehouses', () => {
      it.each([
        [{ type: 'inbound', originWarehouseId: undefined }, 'destinationWarehouseId'],
        [{ type: 'outbound', originWarehouseId: undefined }, 'originWarehouseId'],
        [{ type: 'transfer', destinationWarehouseId: undefined }, 'destinationWarehouseId'],
      ])('%p requires %s', async (override, field) => {
        const err = await rejection(service.create(payload(override), USER));
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.details.map((d) => d.field)).toContain(field);
      });

      it('transfer requires two different warehouses', async () => {
        const err = await rejection(service.create(payload({ type: 'transfer', destinationWarehouseId: WH_A }), USER));
        expect(err.details.map((d) => d.field)).toContain('destinationWarehouseId');
        const ok = await service.create(payload({ type: 'transfer', destinationWarehouseId: WH_B }), USER);
        expect(ok.destinationWarehouseId).toBe(WH_B);
      });

      it('rejects missing or inactive warehouses', async () => {
        expect((await rejection(service.create(payload({ originWarehouseId: 999 }), USER))).code).toBe('VALIDATION_ERROR');
        expect((await rejection(service.create(payload({ originWarehouseId: 3 }), USER))).code).toBe('VALIDATION_ERROR');
      });
    });

    describe('BR2 vehicle assignment', () => {
      it('rejects unknown vehicles and vehicles in maintenance', async () => {
        expect((await rejection(service.create(payload({ vehicleId: 999 }), USER))).details[0].field).toBe('vehicleId');
        setVehicleStatus('maintenance');
        expect((await rejection(service.create(payload({ vehicleId: VEHICLE }), USER))).details[0].field).toBe('vehicleId');
      });
    });
  });

  describe('update()', () => {
    it('updates editable fields but never status or POD, and audits the update', async () => {
      const { id } = await service.create(payload(), USER);
      audit.record.mockClear();
      const updated = await service.update(id, payload({ clientName: 'Beta LLC', status: 'delivered',
        podRecipientName: 'Z', vehicleId: VEHICLE }), USER);
      expect(updated).toMatchObject({ clientName: 'Beta LLC', status: 'new', vehicleId: VEHICLE });
      const [, data] = repos.orderRepo.update.mock.calls[0];
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('podRecipientName');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ user: USER, action: 'update', entity: 'order', entityId: id }));
    });

    it('throws NOT_FOUND for unknown order', async () => {
      expect((await rejection(service.update(999, payload(), USER))).code).toBe('NOT_FOUND');
    });

    it.each(['in_transit', 'delivered'])('BR4: %s orders are locked', async (status) => {
      const { id } = await service.create(payload(), USER);
      setOrderStatus(id, status);
      expect(await rejection(service.update(id, payload(), USER))).toMatchObject({ code: 'ORDER_LOCKED', status: 409 });
    });

    it('BR4: vehicle can only be changed while new', async () => {
      const { id } = await service.create(payload(), USER);
      setOrderStatus(id, 'cancelled');
      expect((await rejection(service.update(id, payload({ vehicleId: VEHICLE }), USER))).code).toBe('ORDER_LOCKED');
      expect((await service.update(id, payload({ clientName: 'Still editable' }), USER)).clientName).toBe('Still editable');
    });

    it('does not re-check unchanged warehouses (BR1 on PUT only when ids change)', async () => {
      const { id } = await service.create(payload(), USER);
      repos.warehouseRepo.rows[WH_A].isActive = false;
      expect((await service.update(id, payload({ clientName: 'Kept' }), USER)).clientName).toBe('Kept');
    });
  });

  describe('changeStatus()', () => {
    let id;
    beforeEach(async () => {
      ({ id } = await service.create(payload({ vehicleId: VEHICLE }), USER));
      audit.record.mockClear();
    });

    it('rejects an unknown status with VALIDATION_ERROR', async () => {
      expect((await rejection(service.changeStatus(id, { status: 'lost' }, USER))).code).toBe('VALIDATION_ERROR');
    });

    it('rejects disallowed transitions', async () => {
      const err = await rejection(service.changeStatus(id, { status: 'delivered', podRecipientName: 'X' }, USER));
      expect(err).toMatchObject({ code: 'INVALID_TRANSITION', status: 409 });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('new → in_transit is one atomic repository call and is audited as status_change', async () => {
      const order = await service.changeStatus(id, { status: 'in_transit', note: 'Go' }, USER);
      expect(order.status).toBe('in_transit');
      expect(repos.orderRepo.applyStatusChange).toHaveBeenCalledWith({ orderId: id, orderPatch: { status: 'in_transit' },
        vehicleId: VEHICLE, vehicleStatus: 'on_trip', historyEntry: { fromStatus: 'new', toStatus: 'in_transit',
          changedAt: NOW, changedBy: 'dispatcher', note: 'Go' } });
      expect(repos.vehicleRepo.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'status_change', entity: 'order', entityId: id,
        details: { from: 'new', to: 'in_transit' } });
    });

    it('→ in_transit requires an assigned vehicle', async () => {
      const other = await service.create(payload(), USER);
      const err = await rejection(service.changeStatus(other.id, { status: 'in_transit' }, USER));
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details[0].field).toBe('vehicleId');
    });

    it('→ in_transit requires the vehicle to be available', async () => {
      setVehicleStatus('on_trip');
      expect(await rejection(service.changeStatus(id, { status: 'in_transit' }, USER)))
        .toMatchObject({ code: 'VEHICLE_UNAVAILABLE', status: 409 });
    });

    it('in_transit → delivered requires podRecipientName, stores POD and frees the vehicle', async () => {
      await service.changeStatus(id, { status: 'in_transit' }, USER);
      expect((await rejection(service.changeStatus(id, { status: 'delivered' }, USER))).details[0].field)
        .toBe('podRecipientName');
      const sig = 'data:image/png;base64,iVBORw0KGgo=';
      const order = await service.changeStatus(id, { status: 'delivered', podRecipientName: ' Mark Lee ',
        podSignature: sig, podNote: 'Left at gate' }, USER);
      expect(order).toMatchObject({ status: 'delivered', podRecipientName: 'Mark Lee', podSignature: sig,
        podNote: 'Left at gate', deliveredAt: NOW });
      expect(repos.vehicleRepo.rows[VEHICLE].status).toBe('available');
    });

    it('validates the POD signature format and size', async () => {
      await service.changeStatus(id, { status: 'in_transit' }, USER);
      const bad = await rejection(service.changeStatus(id, { status: 'delivered', podRecipientName: 'A',
        podSignature: 'data:image/jpeg;base64,xx' }, USER));
      expect(bad.details[0].field).toBe('podSignature');
      const huge = await rejection(service.changeStatus(id, { status: 'delivered', podRecipientName: 'A',
        podSignature: `data:image/png;base64,${'A'.repeat(512 * 1024)}` }, USER));
      expect(huge.details[0].field).toBe('podSignature');
    });

    it('in_transit → cancelled frees the vehicle', async () => {
      await service.changeStatus(id, { status: 'in_transit' }, USER);
      expect((await service.changeStatus(id, { status: 'cancelled' }, USER)).status).toBe('cancelled');
      expect(repos.vehicleRepo.rows[VEHICLE].status).toBe('available');
    });

    it('new → cancelled leaves the vehicle untouched', async () => {
      setVehicleStatus('maintenance');
      await service.changeStatus(id, { status: 'cancelled' }, USER);
      expect(repos.orderRepo.applyStatusChange).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: null, vehicleStatus: null }));
      expect(repos.vehicleRepo.rows[VEHICLE].status).toBe('maintenance');
    });
  });

  describe('delete()', () => {
    it('deletes new orders (audited) and locks in_transit ones', async () => {
      const a = await service.create(payload(), USER);
      const b = await service.create(payload(), USER);
      setOrderStatus(b.id, 'in_transit');
      audit.record.mockClear();
      await service.delete(a.id, USER);
      expect(repos.orderRepo.deleteById).toHaveBeenCalledWith(a.id);
      expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'delete', entity: 'order', entityId: a.id,
        details: { orderNumber: a.orderNumber } });
      expect((await rejection(service.delete(b.id, USER))).code).toBe('ORDER_LOCKED');
      expect((await rejection(service.delete(999, USER))).code).toBe('NOT_FOUND');
      expect(audit.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('list() / getById() / getHistory()', () => {
    it('passes the parsed query to the repository and returns the envelope', async () => {
      const res = await service.list({ type: 'inbound', page: '2', limit: '5' });
      expect(res).toEqual({ items: [], total: 0, page: 2, limit: 5 });
      expect(repos.orderRepo.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 5, sort: 'createdAt',
        dir: 'desc' }));
    });

    it('rejects invalid queries with INVALID_QUERY', async () => {
      expect((await rejection(service.list({ sort: 'id; DROP TABLE orders' }))).code).toBe('INVALID_QUERY');
      expect((await rejection(service.list({ direction: 'sideways' }))).code).toBe('INVALID_QUERY');
    });

    it('getById throws NOT_FOUND and getHistory returns repository rows', async () => {
      expect((await rejection(service.getById(42))).code).toBe('NOT_FOUND');
      const { id } = await service.create(payload({ vehicleId: VEHICLE }), USER);
      await service.changeStatus(id, { status: 'in_transit' }, USER);
      expect((await service.getHistory(id)).map((h) => h.toStatus)).toEqual(['new', 'in_transit']);
      expect((await rejection(service.getHistory(42))).code).toBe('NOT_FOUND');
    });
  });

  it('works without an audit (defaults to a no-op)', async () => {
    const plain = new OrderService(repos, { now: () => NOW });
    await expect(plain.create(payload(), USER)).resolves.toMatchObject({ status: 'new' });
  });
});
