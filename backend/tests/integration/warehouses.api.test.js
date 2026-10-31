const { request, testApp, resetDatabase, closeTestPool, create, warehousePayload, orderPayload } = require('./helpers');

describe('/api/warehouses', () => {
  let app;
  beforeAll(() => { app = testApp(); });
  beforeEach(() => resetDatabase());
  afterAll(() => closeTestPool());

  it('creates, reads, updates and deletes a warehouse', async () => {
    const created = await request(app).post('/api/warehouses').send(warehousePayload());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, code: 'WH-01', isActive: true, managerName: null });

    const updated = await request(app).put('/api/warehouses/1').send(warehousePayload({ isActive: false, phone: '+380 44 000' }));
    expect(updated.body).toMatchObject({ isActive: false, phone: '+380 44 000' });
    expect((await request(app).get('/api/warehouses/1')).body.isActive).toBe(false);

    expect((await request(app).delete('/api/warehouses/1')).status).toBe(204);
    expect((await request(app).get('/api/warehouses/1')).status).toBe(404);
  });

  it('returns 409 DUPLICATE_CODE and 400 VALIDATION_ERROR', async () => {
    await create(app, '/api/warehouses', warehousePayload());
    expect((await request(app).post('/api/warehouses').send(warehousePayload())).body.error).toBe('DUPLICATE_CODE');
    expect((await request(app).post('/api/warehouses').send({ code: 'X' })).body.error).toBe('VALIDATION_ERROR');
  });

  it('lists with active filter, search and sort', async () => {
    await create(app, '/api/warehouses', warehousePayload());
    await create(app, '/api/warehouses', warehousePayload({ code: 'WH-02', name: 'Lviv West Terminal', city: 'Lviv', isActive: false }));
    const res = await request(app).get('/api/warehouses?sort=city&dir=desc');
    expect(res.body.items.map((w) => w.city)).toEqual(['Lviv', 'Kyiv']);
    expect((await request(app).get('/api/warehouses?active=true')).body.total).toBe(1);
    expect((await request(app).get('/api/warehouses?q=lviv')).body.total).toBe(1);
    expect((await request(app).get('/api/warehouses?active=1')).status).toBe(400);
  });

  it('BR6: returns 409 WAREHOUSE_IN_USE while open orders reference it', async () => {
    const wh = await create(app, '/api/warehouses', warehousePayload());
    const order = await create(app, '/api/orders', orderPayload({ originWarehouseId: wh.id }));
    const res = await request(app).delete(`/api/warehouses/${wh.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('WAREHOUSE_IN_USE');
    await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'cancelled' });
    expect((await request(app).delete(`/api/warehouses/${wh.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/orders/${order.id}`)).body.originWarehouseId).toBeNull();
  });

  it('rejects orders referencing an inactive warehouse', async () => {
    const wh = await create(app, '/api/warehouses', warehousePayload({ isActive: false }));
    expect((await request(app).post('/api/orders').send(orderPayload({ originWarehouseId: wh.id }))).status).toBe(400);
  });

  describe('GET /:id/schedule', () => {
    it('returns departures by pickup window and arrivals by planned date', async () => {
      const a = await create(app, '/api/warehouses', warehousePayload());
      const b = await create(app, '/api/warehouses', warehousePayload({ code: 'WH-02', name: 'Lviv', city: 'Lviv' }));
      await create(app, '/api/orders', orderPayload({ clientName: 'Late', originWarehouseId: a.id, pickupWindowStart: '2026-11-05T15:00:00Z' }));
      await create(app, '/api/orders', orderPayload({ clientName: 'Early', originWarehouseId: a.id, pickupWindowStart: '2026-11-05T07:00:00Z' }));
      await create(app, '/api/orders', orderPayload({ type: 'transfer', clientName: 'Incoming', originWarehouseId: b.id,
        destinationWarehouseId: a.id, plannedDeliveryDate: '2026-11-05', pickupWindowStart: '2026-11-04T07:00:00Z' }));

      const res = await request(app).get(`/api/warehouses/${a.id}/schedule?date=2026-11-05`);
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-11-05');
      expect(res.body.departures.map((o) => o.clientName)).toEqual(['Early', 'Late']);
      expect(res.body.arrivals.map((o) => o.clientName)).toEqual(['Incoming']);
    });

    it('defaults to today and validates date and id', async () => {
      const a = await create(app, '/api/warehouses', warehousePayload());
      const today = await request(app).get(`/api/warehouses/${a.id}/schedule`);
      expect(today.body.date).toBe(new Date().toISOString().slice(0, 10));
      expect((await request(app).get(`/api/warehouses/${a.id}/schedule?date=tomorrow`)).body.error).toBe('INVALID_QUERY');
      expect((await request(app).get('/api/warehouses/99/schedule')).status).toBe(404);
    });
  });
});
