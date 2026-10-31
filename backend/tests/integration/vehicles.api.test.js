const { request, testApp, resetDatabase, closeTestPool, create, vehiclePayload } = require('./helpers');

describe('/api/vehicles', () => {
  let app;
  beforeAll(() => { app = testApp(); });
  beforeEach(() => resetDatabase());
  afterAll(() => closeTestPool());

  it('creates, reads, updates and deletes a vehicle', async () => {
    const created = await request(app).post('/api/vehicles').send(vehiclePayload());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, status: 'available', licensePlate: 'AA1234BB' });

    expect((await request(app).get('/api/vehicles/1')).body.model).toBe('Volvo FH 500');

    const updated = await request(app).put('/api/vehicles/1').send(vehiclePayload({ status: 'maintenance', driverName: 'Ann Lee' }));
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ status: 'maintenance', driverName: 'Ann Lee' });

    expect((await request(app).delete('/api/vehicles/1')).status).toBe(204);
    expect((await request(app).get('/api/vehicles/1')).status).toBe(404);
  });

  it('returns 409 DUPLICATE_PLATE', async () => {
    await create(app, '/api/vehicles', vehiclePayload());
    const res = await request(app).post('/api/vehicles').send(vehiclePayload());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_PLATE');
  });

  it('returns 400 VALIDATION_ERROR for missing fields and on_trip status', async () => {
    expect((await request(app).post('/api/vehicles').send({})).body.details).toHaveLength(3);
    expect((await request(app).post('/api/vehicles').send(vehiclePayload({ status: 'on_trip' }))).status).toBe(400);
  });

  it('lists sorted by plate with filters and pagination', async () => {
    await create(app, '/api/vehicles', vehiclePayload({ licensePlate: 'CC3' }));
    await create(app, '/api/vehicles', vehiclePayload({ licensePlate: 'AA1', status: 'maintenance' }));
    await create(app, '/api/vehicles', vehiclePayload({ licensePlate: 'BB2', model: 'Scania R 450' }));
    const res = await request(app).get('/api/vehicles');
    expect(res.body).toMatchObject({ total: 3, page: 1, limit: 20 });
    expect(res.body.items.map((v) => v.licensePlate)).toEqual(['AA1', 'BB2', 'CC3']);
    expect((await request(app).get('/api/vehicles?status=maintenance')).body.total).toBe(1);
    expect((await request(app).get('/api/vehicles?q=scania')).body.items[0].licensePlate).toBe('BB2');
    expect((await request(app).get('/api/vehicles?sort=model&dir=desc&limit=1&page=2')).body.items).toHaveLength(1);
    expect((await request(app).get('/api/vehicles?sort=capacityKg')).body.error).toBe('INVALID_QUERY');
  });

  it('PUT/DELETE unknown vehicle return 404', async () => {
    expect((await request(app).put('/api/vehicles/77').send(vehiclePayload())).status).toBe(404);
    expect((await request(app).delete('/api/vehicles/77')).status).toBe(404);
  });
});
