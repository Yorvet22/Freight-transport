// HTTP tests for platform.mount() on a minimal Express app backed by the test database.
const express  = require('express');
const request  = require('supertest');
const { getTestPool, resetDatabase, closeTestPool } = require('../helpers/db');
const { createPlatform } = require('../../src/platform');
const { signToken }      = require('../../src/auth/token');
const OrderRepository    = require('../../src/repositories/orderRepository');
const LoginRateLimiter   = require('../../src/auth/rateLimiter');
const { insertUsers, insertWarehouse, insertVehicle, insertOrder } = require('./fixtures');

const SECRET = 'api-test-secret';
let pool;
let userIds;

beforeAll(() => { pool = getTestPool(); });
beforeEach(async () => {
  await resetDatabase();
  userIds = await insertUsers(pool);
});
afterAll(() => closeTestPool());

function buildApp(options = {}) {
  const platform = createPlatform({
    pool, repos: { orderRepo: new OrderRepository(pool) }, sessionSecret: SECRET, logger: { warn() {} }, ...options,
  });
  const app = express();
  app.use(express.json());
  platform.mount(app);
  app.use('/api', platform.authenticate);
  app.post('/api/things', platform.requireRole('dispatcher'), async (req, res) => {
    await platform.audit.record({ user: req.user, action: 'create', entity: 'order', entityId: 42, details: { via: 'test' } });
    res.status(201).json({ by: req.user.username });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_SERVER_ERROR', message: err.message, details: err.details });
  });
  return app;
}

async function loginAs(app, username, password = `${username}123`) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  return agent;
}

describe('auth endpoints', () => {
  test('login sets HttpOnly SameSite=Lax cookie and returns user', async () => {
    const res = await request(buildApp()).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: userIds.admin, username: 'admin', role: 'admin' } });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^ft_token=[^;]+\.[^;]+;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/);
  });

  test('bad credentials -> 401 generic message, no cookie', async () => {
    const res = await request(buildApp()).post('/api/auth/login').send({ username: 'admin', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'UNAUTHORIZED', message: 'Invalid username or password.' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('me and logout', async () => {
    const agent = await loginAs(buildApp(), 'viewer');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ id: userIds.viewer, username: 'viewer', role: 'viewer' });
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'][0]).toMatch(/ft_token=;/);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  test('401 without cookie, with tampered or wrongly-signed token', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/dashboard/kpis')).status).toBe(401);
    const good = signToken({ uid: userIds.viewer, username: 'viewer', role: 'viewer' }, SECRET);
    const [, sig] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: userIds.viewer, username: 'viewer', role: 'admin', exp: 9e9 })).toString('base64url');
    expect((await request(app).get('/api/users').set('Cookie', `ft_token=${forged}.${sig}`)).status).toBe(401);
    const other = signToken({ uid: userIds.admin, username: 'admin', role: 'admin' }, 'other');
    expect((await request(app).get('/api/auth/me').set('Cookie', `ft_token=${other}`)).status).toBe(401);
  });

  test('login rate limit: 10 failures per IP+username -> 429 TOO_MANY_REQUESTS; other usernames unaffected', async () => {
    const app = buildApp();
    for (let i = 0; i < 10; i += 1) {
      expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' })).status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: 'TOO_MANY_REQUESTS', message: expect.stringMatching(/Too many failed login attempts/) });
    expect(blocked.headers['set-cookie']).toBeUndefined();
    await loginAs(app, 'viewer');
  });

  test('successful login resets the failure counter', async () => {
    const app = buildApp({ rateLimiter: new LoginRateLimiter({ max: 2 }) });
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' });
    await loginAs(app, 'admin');
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' });
    await loginAs(app, 'admin');
  });
});

describe('roles and users', () => {
  test('viewer cannot write (403), dispatcher can; users and audit endpoints are admin-only', async () => {
    const app = buildApp();
    const viewer = await loginAs(app, 'viewer');
    const r = await viewer.post('/api/things').send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('FORBIDDEN');
    const dispatcher = await loginAs(app, 'dispatcher');
    expect((await dispatcher.post('/api/things').send({})).status).toBe(201);
    expect((await dispatcher.get('/api/users')).status).toBe(403);
    expect((await dispatcher.get('/api/audit')).status).toBe(403);
    expect((await request(app).get('/api/audit')).status).toBe(401);
  });

  test('deleted user is logged out immediately', async () => {
    const app = buildApp();
    const admin = await loginAs(app, 'admin');
    await admin.post('/api/users').send({ username: 'temp', password: 'temp1234', role: 'dispatcher' });
    const temp = await loginAs(app, 'temp', 'temp1234');
    const id = (await temp.get('/api/auth/me')).body.user.id;
    expect((await admin.delete(`/api/users/${id}`)).status).toBe(204);
    const res = await temp.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  test('admin lists, creates and deletes users; cannot delete self', async () => {
    const app = buildApp();
    const admin = await loginAs(app, 'admin');
    const list = await admin.get('/api/users');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(3);
    expect(list.body[0]).not.toHaveProperty('passwordHash');

    const created = await admin.post('/api/users').send({ username: 'erin', password: 'erin1234', role: 'viewer' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ username: 'erin', role: 'viewer' });
    expect(created.body).not.toHaveProperty('passwordHash');

    const dup = await admin.post('/api/users').send({ username: 'ERIN', password: 'erin1234', role: 'viewer' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('DUPLICATE_USERNAME');

    const bad = await admin.post('/api/users').send({ username: '', password: '1', role: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toHaveLength(3);

    await loginAs(app, 'erin', 'erin1234');

    const self = await admin.delete(`/api/users/${userIds.admin}`);
    expect(self.status).toBe(400);
    expect(self.body.error).toBe('VALIDATION_ERROR');

    expect((await admin.delete(`/api/users/${created.body.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/users/${created.body.id}`)).status).toBe(404);
    expect((await admin.delete('/api/users/abc')).status).toBe(400);
  });
});

describe('audit endpoint', () => {
  test('user create/delete and platform.audit.record entries are listed, filtered and paginated', async () => {
    const app = buildApp();
    const admin = await loginAs(app, 'admin');
    const created = (await admin.post('/api/users').send({ username: 'erin', password: 'erin1234', role: 'viewer' })).body;
    await admin.delete(`/api/users/${created.id}`);
    await (await loginAs(app, 'dispatcher')).post('/api/things').send({});

    const all = await admin.get('/api/audit');
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, limit: 20 });
    expect(all.body.items.map(i => `${i.entity}:${i.action}`).sort()).toEqual(['order:create', 'user:create', 'user:delete']);

    const users = await admin.get(`/api/audit?entity=user&entityId=${created.id}`);
    expect(users.body.total).toBe(2);
    const createEntry = users.body.items.find(i => i.action === 'create');
    expect(createEntry).toMatchObject({
      userId: userIds.admin, username: 'admin', entity: 'user', entityId: created.id,
      details: { username: 'erin', role: 'viewer' }, createdAt: expect.any(String),
    });

    const order = await admin.get('/api/audit?entity=order');
    expect(order.body.items[0]).toMatchObject({ username: 'dispatcher', entityId: 42, details: { via: 'test' } });

    const page2 = await admin.get('/api/audit?page=2&limit=2');
    expect(page2.body).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(page2.body.items).toHaveLength(1);

    const bad = await admin.get('/api/audit?entity=planet');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_QUERY');
  });
});

describe('analytics endpoints', () => {
  beforeEach(async () => {
    const w = await insertWarehouse(pool);
    const v = await insertVehicle(pool);
    await insertOrder(pool, { status: 'delivered', vehicleId: v, originWarehouseId: w, createdAt: new Date(), deliveredAt: new Date() });
  });

  test('dashboard KPIs shape', async () => {
    const viewer = await loginAs(buildApp(), 'viewer');
    const res = await viewer.get('/api/dashboard/kpis');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'avgTransitHours', 'fleetUtilization', 'onTimeRate', 'orders', 'ordersPerDay', 'recentOrders', 'vehicles', 'warehouses',
    ]);
    expect(res.body.orders.total).toBe(1);
    expect(res.body.ordersPerDay).toHaveLength(14);
    expect(res.body.ordersPerDay[13].count).toBe(1);
    expect(res.body.recentOrders).toHaveLength(1);
  });

  test('reports summary shape and invalid query', async () => {
    const viewer = await loginAs(buildApp(), 'viewer');
    const w = (await pool.query('SELECT id FROM warehouses'))[0][0].id;
    const res = await viewer.get(`/api/reports/summary?warehouseId=${w}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['byVehicle', 'byWarehouse', 'filters', 'orders', 'totals']);
    expect(res.body.filters.warehouseId).toBe(w);
    expect(res.body.totals.orders).toBe(1);
    const bad = await viewer.get('/api/reports/summary?from=nope');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_QUERY');
  });
});

describe('authDisabled and secrets', () => {
  test('authDisabled acts as system admin; audit rows get userId null', async () => {
    const app = buildApp({ authDisabled: true });
    const res = await request(app).get('/api/auth/me');
    expect(res.body.user).toEqual({ id: 0, username: 'system', role: 'admin' });
    expect((await request(app).post('/api/things')).status).toBe(201);
    const audit = await request(app).get('/api/audit');
    expect(audit.body.items[0]).toMatchObject({ userId: null, username: 'system' });
  });

  test('missing secret -> random secret with a warning (non-production)', () => {
    const logger = { warn: jest.fn() };
    createPlatform({ pool, repos: {}, logger, env: { NODE_ENV: 'development' } });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('missing secret in production -> throws', () => {
    expect(() => createPlatform({ pool, repos: {}, env: { NODE_ENV: 'production' } })).toThrow(/SESSION_SECRET/);
    expect(() => createPlatform({ pool, repos: {}, sessionSecret: 's', env: { NODE_ENV: 'production' } })).not.toThrow();
  });

  test('requires a pool and exposes the MySQL user repository', () => {
    expect(() => createPlatform({ repos: {}, sessionSecret: 's' })).toThrow(/pool/);
    const p = createPlatform({ pool, repos: {}, sessionSecret: 's' });
    expect(p.userRepo.constructor.name).toBe('UserRepository');
    expect(typeof p.audit.record).toBe('function');
  });
});
