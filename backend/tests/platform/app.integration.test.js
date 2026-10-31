// End-to-end platform checks against the real app (createApp from src/app.js) on the seeded test database.
const request = require('supertest');
const { getTestPool, resetDatabase, seedDemo, closeTestPool } = require('../helpers/db');
const { createApp } = require('../../src/app');

describe('platform integrated in createApp (MySQL, demo data)', () => {
  let app;
  let pool;
  beforeAll(async () => {
    pool = getTestPool();
    await resetDatabase();
    await seedDemo(pool);
    app = createApp({ pool, authDisabled: false, sessionSecret: 'integration-secret', logger: { warn() {}, error() {}, log() {} } });
  });
  afterAll(() => closeTestPool());

  const login = async username => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ username, password: `${username}123` });
    expect(res.status).toBe(200);
    return agent;
  };

  test('login / me / logout', async () => {
    const agent = await login('admin');
    expect((await agent.get('/api/auth/me')).body.user).toMatchObject({ username: 'admin', role: 'admin' });
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
  });

  test('domain endpoints need a session; tampered token is rejected', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
    const res = await request(app).get('/api/orders').set('Cookie', 'ft_token=eyJ1aWQiOjF9.AAAA');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  test('viewer can read but not write (403 on POST /api/vehicles)', async () => {
    const viewer = await login('viewer');
    expect((await viewer.get('/api/vehicles')).status).toBe(200);
    const res = await viewer.post('/api/vehicles')
      .send({ model: 'Volvo FH', licensePlate: 'ZZ9999ZZ', driverName: 'Test Driver', capacityKg: 20000 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  test('dashboard and report payloads on demo data agree with each other', async () => {
    const viewer = await login('viewer');
    const kpis = await viewer.get('/api/dashboard/kpis');
    expect(kpis.status).toBe(200);
    expect(kpis.body.orders.total).toBeGreaterThan(0);
    expect(kpis.body.ordersPerDay).toHaveLength(14);
    expect(kpis.body.recentOrders).toHaveLength(5);
    expect(kpis.body.warehouses.length).toBe(4);
    expect(kpis.body.onTimeRate).toBeGreaterThanOrEqual(0);
    expect(kpis.body.avgTransitHours).toBeGreaterThan(0);

    const report = await viewer.get('/api/reports/summary');
    expect(report.status).toBe(200);
    expect(report.body.totals.orders).toBe(kpis.body.orders.total);
    expect(report.body.totals.delivered).toBe(kpis.body.orders.delivered);
    expect(report.body.orders).toHaveLength(kpis.body.orders.total);
    expect(report.body.orders[0]).not.toHaveProperty('podSignature');
    expect(report.body.byWarehouse[0]).toEqual(expect.objectContaining({
      warehouseId: expect.any(Number), code: expect.any(String), inbound: expect.any(Number),
    }));
    const inboundSum = report.body.byWarehouse.reduce((s, w) => s + w.inbound, 0);
    expect(inboundSum).toBe(kpis.body.warehouses.reduce((s, w) => s + w.inbound, 0));
  });

  test('rate-limited login maps to 429 through the app error handler', async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'wrong' });
    }
    const res = await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('TOO_MANY_REQUESTS');
  });

  test('admin sees audit entries written by domain writes and user management', async () => {
    const admin = await login('admin');
    const v = await admin.post('/api/vehicles')
      .send({ model: 'MAN TGX', licensePlate: 'AU0001AU', driverName: 'Audit Driver', capacityKg: 18000 });
    expect(v.status).toBe(201);
    const u = await admin.post('/api/users').send({ username: 'auditee', password: 'secret1', role: 'viewer' });
    expect(u.status).toBe(201);

    const vehicleAudit = await admin.get(`/api/audit?entity=vehicle&entityId=${v.body.id}`);
    expect(vehicleAudit.status).toBe(200);
    expect(vehicleAudit.body.items[0]).toMatchObject({ action: 'create', username: 'admin', entity: 'vehicle' });
    const userAudit = await admin.get(`/api/audit?entity=user&entityId=${u.body.id}`);
    expect(userAudit.body.total).toBe(1);
    expect((await (await login('viewer')).get('/api/audit')).status).toBe(403);
  });
});
