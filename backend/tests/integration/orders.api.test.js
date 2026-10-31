const { request, testApp, resetDatabase, closeTestPool, getTestPool, create, warehousePayload, vehiclePayload, orderPayload } = require('./helpers');

describe('/api/orders', () => {
  let app;
  let whA;
  let whB;
  let vehicle;

  beforeAll(() => { app = testApp(); });
  afterAll(() => closeTestPool());

  beforeEach(async () => {
    await resetDatabase();
    whA     = await create(app, '/api/warehouses', warehousePayload());
    whB     = await create(app, '/api/warehouses', warehousePayload({ code: 'WH-02', name: 'Lviv West Terminal', city: 'Lviv' }));
    vehicle = await create(app, '/api/vehicles', vehiclePayload());
  });

  const newOrder = (o = {}) => create(app, '/api/orders', orderPayload({ originWarehouseId: whA.id, ...o }));

  describe('POST', () => {
    it('creates a new order with derived number and joined fields', async () => {
      const res = await request(app).post('/api/orders').send(orderPayload({ originWarehouseId: whA.id, vehicleId: vehicle.id,
        pickupWindowStart: '2026-11-02T08:00:00Z', pickupWindowEnd: '2026-11-02T10:00:00Z', plannedDeliveryDate: '2026-11-03' }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 1, orderNumber: 'ORD-000001', status: 'new', truckPlate: 'AA1234BB',
        driverName: 'John Smith', originWarehouseName: 'Kyiv Central Hub', destinationWarehouseName: null,
        pickupWindowStart: '2026-11-02T08:00:00.000Z', plannedDeliveryDate: '2026-11-03', deliveredAt: null });
      expect(Date.parse(res.body.createdAt)).not.toBeNaN();
    });

    it('returns 400 VALIDATION_ERROR with details', async () => {
      const res = await request(app).post('/api/orders').send({ cargoWeight: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d) => d.field)).toEqual(expect.arrayContaining(['type', 'clientName', 'cargoWeight']));
    });

    it('enforces BR1 (transfer needs two different warehouses)', async () => {
      const res = await request(app).post('/api/orders').send(orderPayload({ type: 'transfer', originWarehouseId: whA.id,
        destinationWarehouseId: whA.id }));
      expect(res.status).toBe(400);
    });
  });

  describe('GET list', () => {
    beforeEach(async () => {
      await newOrder({ clientName: 'Alpha', cargoWeight: 300 });
      await newOrder({ clientName: 'Bravo', cargoWeight: 100, vehicleId: vehicle.id });
      await newOrder({ type: 'inbound', originWarehouseId: null, destinationWarehouseId: whB.id, clientName: 'Charlie', cargoWeight: 200 });
    });

    it('returns the paginated envelope, newest first by default, without podSignature', async () => {
      const res = await request(app).get('/api/orders');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(res.body.items.map((o) => o.clientName)).toEqual(['Charlie', 'Bravo', 'Alpha']);
      expect(res.body.items[0]).not.toHaveProperty('podSignature');
    });

    it('filters, searches, sorts and paginates', async () => {
      const sorted = await request(app).get('/api/orders?sort=cargoWeight&dir=asc&limit=2&page=1');
      expect(sorted.body.items.map((o) => o.cargoWeight)).toEqual([100, 200]);
      expect((await request(app).get('/api/orders?type=inbound')).body.total).toBe(1);
      expect((await request(app).get(`/api/orders?vehicleId=${vehicle.id}`)).body.total).toBe(1);
      expect((await request(app).get(`/api/orders?warehouseId=${whB.id}&direction=inbound`)).body.total).toBe(1);
      expect((await request(app).get(`/api/orders?warehouseId=${whB.id}&direction=outbound`)).body.total).toBe(0);
      expect((await request(app).get('/api/orders?q=aa1234')).body.items[0].clientName).toBe('Bravo');
    });

    it.each(['sort=driverName', 'dir=down', 'limit=1000', 'page=0', 'status=lost', 'type=air', 'direction=up'])(
      'rejects ?%s with 400 INVALID_QUERY', async (qs) => {
        const res = await request(app).get(`/api/orders?${qs}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_QUERY');
      },
    );
  });

  describe('GET /:id and history', () => {
    it('returns 404 for unknown order', async () => {
      const res = await request(app).get('/api/orders/999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('returns history oldest first', async () => {
      const order = await newOrder({ vehicleId: vehicle.id });
      await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'in_transit', note: 'Departed' });
      const res = await request(app).get(`/api/orders/${order.id}/history`);
      expect(res.status).toBe(200);
      expect(res.body.map((h) => [h.fromStatus, h.toStatus, h.changedBy])).toEqual([
        [null, 'new', 'system'], ['new', 'in_transit', 'system'],
      ]);
      expect(res.body[1].note).toBe('Departed');
    });
  });

  describe('PUT', () => {
    it('updates editable fields and ignores status', async () => {
      const order = await newOrder();
      const res = await request(app).put(`/api/orders/${order.id}`).send(orderPayload({ originWarehouseId: whA.id,
        clientName: 'Renamed Ltd', status: 'delivered' }));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ clientName: 'Renamed Ltd', status: 'new', orderNumber: order.orderNumber });
    });

    it('returns 409 ORDER_LOCKED for in-transit orders', async () => {
      const order = await newOrder({ vehicleId: vehicle.id });
      await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'in_transit' });
      const res = await request(app).put(`/api/orders/${order.id}`).send(orderPayload({ originWarehouseId: whA.id }));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ORDER_LOCKED');
    });
  });

  describe('PATCH /:id/status — full lifecycle', () => {
    it('dispatches, delivers with POD and frees the vehicle', async () => {
      const order = await newOrder({ vehicleId: vehicle.id });
      const go = await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'in_transit' });
      expect(go.status).toBe(200);
      expect((await request(app).get(`/api/vehicles/${vehicle.id}`)).body.status).toBe('on_trip');

      // BR5: vehicle on trip cannot be deleted or have its status changed
      expect((await request(app).delete(`/api/vehicles/${vehicle.id}`)).body.error).toBe('VEHICLE_IN_USE');

      const noPod = await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'delivered' });
      expect(noPod.status).toBe(400);

      const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const done = await request(app).patch(`/api/orders/${order.id}/status`)
        .send({ status: 'delivered', podRecipientName: 'Helen Carter', podSignature: sig, podNote: 'All good' });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: 'delivered', podRecipientName: 'Helen Carter', podSignature: sig });
      expect(Date.parse(done.body.deliveredAt)).not.toBeNaN();
      expect((await request(app).get(`/api/vehicles/${vehicle.id}`)).body.status).toBe('available');

      expect((await request(app).get(`/api/orders/${order.id}`)).body.podSignature).toBe(sig);
      expect((await request(app).get('/api/orders')).body.items[0]).not.toHaveProperty('podSignature');

      const again = await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'cancelled' });
      expect(again.status).toBe(409);
      expect(again.body.error).toBe('INVALID_TRANSITION');
      expect((await request(app).delete(`/api/orders/${order.id}`)).body.error).toBe('ORDER_LOCKED');
    });

    it('returns 409 VEHICLE_UNAVAILABLE when the vehicle is already on a trip', async () => {
      const a = await newOrder({ vehicleId: vehicle.id });
      const b = await newOrder({ vehicleId: vehicle.id });
      await request(app).patch(`/api/orders/${a.id}/status`).send({ status: 'in_transit' });
      const res = await request(app).patch(`/api/orders/${b.id}/status`).send({ status: 'in_transit' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('VEHICLE_UNAVAILABLE');
    });

    it('audits status changes as status_change with from/to details', async () => {
      const order = await newOrder({ vehicleId: vehicle.id });
      await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'in_transit' });
      const [rows] = await getTestPool().query(
        "SELECT action, details FROM audit_log WHERE entity = 'order' AND entityId = ? ORDER BY id", [order.id]);
      expect(rows.map((r) => r.action)).toEqual(['create', 'status_change']);
      const details = typeof rows[1].details === 'string' ? JSON.parse(rows[1].details) : rows[1].details;
      expect(details).toEqual({ from: 'new', to: 'in_transit' });
    });

    it('returns 400 for an unknown status value', async () => {
      const order = await newOrder();
      expect((await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'Delivered!' })).status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('deletes new orders with 204 and then 404s', async () => {
      const order = await newOrder();
      expect((await request(app).delete(`/api/orders/${order.id}`)).status).toBe(204);
      expect((await request(app).get(`/api/orders/${order.id}`)).status).toBe(404);
      expect((await request(app).delete(`/api/orders/${order.id}`)).status).toBe(404);
    });
  });
});
