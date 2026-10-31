const { request, testApp, create, vehiclePayload, getTestPool, resetDatabase, seedDemo, closeTestPool } = require('./helpers');

afterAll(() => closeTestPool());

describe('app wiring', () => {
  let app;
  beforeAll(() => { app = testApp(); });
  beforeEach(() => resetDatabase());

  it('requires an injected pool', () => {
    expect(() => testApp({ pool: undefined })).toThrow(/pool/);
  });

  it('GET /api/health pings the database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /api/health returns 503 when the database is down', async () => {
    const deadPool = { query: () => Promise.reject(new Error('ECONNREFUSED')) };
    const res = await request(testApp({ pool: deadPool })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
  });

  it('sends security headers with a CSP allowing the frontend CDNs and data: images', async () => {
    const res = await request(app).get('/api/health');
    const csp = res.headers['content-security-policy'];
    ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']
      .forEach((host) => expect(csp).toContain(host));
    expect(csp).toMatch(/img-src[^;]*data:/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('CORS is same-origin only unless corsOrigin is set', async () => {
    const origin = 'http://localhost:5173';
    expect((await request(app).get('/api/health').set('Origin', origin)).headers)
      .not.toHaveProperty('access-control-allow-origin');
    const res = await request(testApp({ corsOrigin: origin })).get('/api/health').set('Origin', origin);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('unknown /api routes return JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'NOT_FOUND', message: expect.any(String) });
  });

  it('malformed JSON returns 400 INVALID_JSON', async () => {
    const res = await request(app).post('/api/vehicles').set('Content-Type', 'application/json').send('{"model":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_JSON');
  });

  it('a body over 1 MB returns 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/vehicles').send({ model: 'x'.repeat(1100 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it.each(['/api/orders/abc', '/api/orders/0', '/api/vehicles/-1', '/api/warehouses/1.5', '/api/orders/x/history'])(
    'GET %s returns 400 INVALID_ID', async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ID');
    },
  );

  it('serves the frontend at /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('serves the demo data set from MySQL', async () => {
    await seedDemo(getTestPool());
    expect((await request(app).get('/api/warehouses')).body.total).toBe(4);
    expect((await request(app).get('/api/vehicles')).body.total).toBe(10);
    const orders = await request(app).get('/api/orders?limit=5');
    expect(orders.body.total).toBe(60);
    expect(orders.body.items[0]).toMatchObject({ orderNumber: expect.stringMatching(/^ORD-\d{6}$/) });
    expect(orders.body.items[0]).not.toHaveProperty('podSignature');
    expect(typeof orders.body.items[0].cargoWeight).toBe('number');
  });
});

describe('audit trail', () => {
  let app;
  beforeAll(() => { app = testApp(); });
  beforeEach(() => resetDatabase());

  const auditRows = async () => {
    const [rows] = await getTestPool().query('SELECT username, action, entity, entityId FROM audit_log ORDER BY id');
    return rows;
  };

  it('records create/update/delete of vehicles as the acting user', async () => {
    const vehicle = await create(app, '/api/vehicles', vehiclePayload());
    await request(app).put(`/api/vehicles/${vehicle.id}`).send(vehiclePayload({ driverName: 'Ann Lee' }));
    await request(app).delete(`/api/vehicles/${vehicle.id}`);
    expect(await auditRows()).toEqual(['create', 'update', 'delete'].map((action) => ({ username: 'system', action,
      entity: 'vehicle', entityId: vehicle.id })));
  });

  it('a failing audit write never fails the request', async () => {
    await getTestPool().query('RENAME TABLE audit_log TO audit_log_moved');
    try {
      const res = await request(app).post('/api/vehicles').send(vehiclePayload());
      expect(res.status).toBe(201);
    } finally {
      await getTestPool().query('RENAME TABLE audit_log_moved TO audit_log');
    }
  });
});

describe('role enforcement (auth enabled)', () => {
  let app;
  beforeAll(async () => {
    await resetDatabase();
    await seedDemo(getTestPool());
    app = testApp({ authDisabled: false, sessionSecret: 'domain-test-secret' });
  });

  const login = async (username) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ username, password: `${username}123` });
    expect(res.status).toBe(200);
    return agent;
  };

  it('requires authentication for domain routes but not for health', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('viewer can read orders but not write them', async () => {
    const viewer = await login('viewer');
    expect((await viewer.get('/api/orders')).status).toBe(200);
    expect((await viewer.post('/api/orders').send({})).status).toBe(403);
    expect((await viewer.patch('/api/orders/1/status').send({ status: 'cancelled' })).status).toBe(403);
    expect((await viewer.post('/api/vehicles').send({})).status).toBe(403);
  });

  it('dispatcher can write orders but not warehouses; changedBy and audit use the username', async () => {
    const dispatcher = await login('dispatcher');
    expect((await dispatcher.post('/api/warehouses').send({})).status).toBe(403);
    const created = await dispatcher.post('/api/orders').send({ type: 'outbound', clientName: 'Acme', pickupAddress: 'a',
      deliveryAddress: 'b', cargoDescription: 'c', cargoWeight: 10, originWarehouseId: 1 });
    expect(created.status).toBe(201);
    const history = await dispatcher.get(`/api/orders/${created.body.id}/history`);
    expect(history.body[0]).toMatchObject({ toStatus: 'new', changedBy: 'dispatcher' });
    const [rows] = await getTestPool().query(
      "SELECT username, action FROM audit_log WHERE entity = 'order' AND entityId = ?", [created.body.id]);
    expect(rows).toEqual([{ username: 'dispatcher', action: 'create' }]);
  });
});
