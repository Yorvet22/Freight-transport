// Pure unit tests for AuthService / UserService / AuditService with fake repositories (no DB).
const AuthService      = require('../../src/services/authService');
const UserService      = require('../../src/services/userService');
const AuditService     = require('../../src/services/auditService');
const LoginRateLimiter = require('../../src/auth/rateLimiter');
const { verifyToken }  = require('../../src/auth/token');
const { hashPassword, verifyPassword } = require('../../src/auth/password');

const SECRET = 'unit-secret';

// Minimal user repository fake (case-insensitive usernames, like the utf8mb4_unicode_ci column).
function fakeUserRepo(names = ['admin', 'dispatcher', 'viewer']) {
  const rows = names.map((name, i) => ({
    id: i + 1, username: name, passwordHash: hashPassword(`${name}123`), role: name, createdAt: new Date(),
  }));
  let nextId = rows.length + 1;
  return {
    rows,
    findByUsername: async u => rows.find(r => r.username.toLowerCase() === u.toLowerCase()) || null,
    findById: async id => rows.find(r => r.id === id) || null,
    listAll: async () => [...rows],
    create: async data => { const id = nextId++; rows.push({ id, createdAt: new Date(), ...data }); return id; },
    deleteById: async id => {
      const i = rows.findIndex(r => r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
}

let repo;
beforeAll(() => { repo = fakeUserRepo(); });

describe('AuthService.login', () => {
  test('valid credentials return public user and signed token', async () => {
    const svc = new AuthService(repo, SECRET);
    const { user, token } = await svc.login({ username: ' dispatcher ', password: 'dispatcher123' });
    expect(user).toEqual({ id: expect.any(Number), username: 'dispatcher', role: 'dispatcher' });
    expect(verifyToken(token, SECRET)).toMatchObject({ uid: user.id, username: 'dispatcher', role: 'dispatcher' });
  });

  test.each([
    [{ username: 'admin', password: 'wrong' }],
    [{ username: 'ghost', password: 'admin123' }],
  ])('bad credentials -> generic 401 (case %#)', async creds => {
    const err = await new AuthService(repo, SECRET).login(creds).catch(e => e);
    expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 401, message: 'Invalid username or password.' });
  });

  test.each([
    [undefined], [{}], [{ username: 'admin' }], [{ username: 1, password: 2 }], [{ username: ' ', password: 'x' }],
  ])('malformed body -> 400 VALIDATION_ERROR (case %#)', async body => {
    await expect(new AuthService(repo, SECRET).login(body))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  test('rate limit: 429 after max failures per IP+username, even with the right password; success resets', async () => {
    const rateLimiter = new LoginRateLimiter({ max: 2 });
    const svc = new AuthService(repo, SECRET, { rateLimiter });
    const ctx = { ip: '10.0.0.1' };
    await expect(svc.login({ username: 'admin', password: 'x' }, ctx)).rejects.toMatchObject({ status: 401 });
    // success resets the counter
    await svc.login({ username: 'admin', password: 'admin123' }, ctx);
    await expect(svc.login({ username: 'admin', password: 'x' }, ctx)).rejects.toMatchObject({ status: 401 });
    await expect(svc.login({ username: 'ADMIN', password: 'x' }, ctx)).rejects.toMatchObject({ status: 401 });
    await expect(svc.login({ username: 'admin', password: 'admin123' }, ctx))
      .rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
    // different IP or username is not blocked
    await svc.login({ username: 'admin', password: 'admin123' }, { ip: '10.0.0.2' });
    await svc.login({ username: 'viewer', password: 'viewer123' }, ctx);
  });
});

describe('UserService', () => {
  let svc, users, audit;
  beforeEach(() => {
    users = fakeUserRepo();
    audit = { record: jest.fn(async () => 1) };
    svc = new UserService(users, { audit });
  });

  test('list never exposes passwordHash', async () => {
    const list = await svc.list();
    expect(list).toHaveLength(3);
    for (const u of list) expect(Object.keys(u).sort()).toEqual(['createdAt', 'id', 'role', 'username']);
  });

  test('create hashes the password, returns public user and audits', async () => {
    const admin = { id: 1, username: 'admin', role: 'admin' };
    const u = await svc.create({ username: '  carol ', password: 'secret1', role: 'dispatcher' }, admin);
    expect(u).toEqual({ id: expect.any(Number), username: 'carol', role: 'dispatcher', createdAt: expect.anything() });
    const stored = await users.findByUsername('carol');
    expect(verifyPassword('secret1', stored.passwordHash)).toBe(true);
    expect(audit.record).toHaveBeenCalledWith({
      user: admin, action: 'create', entity: 'user', entityId: u.id, details: { username: 'carol', role: 'dispatcher' },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/secret1|scrypt/);
  });

  test('create validates fields with details', async () => {
    const err = await svc.create({ username: '', password: '123', role: 'root' }).catch(e => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(err.details.map(d => d.field).sort()).toEqual(['password', 'role', 'username']);
    const long = await svc.create({ username: 'x'.repeat(51), password: 'secret1', role: 'viewer' }).catch(e => e);
    expect(long.details[0]).toMatchObject({ field: 'username' });
    const spaces = await svc.create({ username: 'a b', password: 'secret1', role: 'viewer' }).catch(e => e);
    expect(spaces.details[0]).toMatchObject({ field: 'username' });
    await expect(svc.create(undefined)).rejects.toMatchObject({ status: 400 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  test('create duplicate (case-insensitive) -> 409 DUPLICATE_USERNAME', async () => {
    await expect(svc.create({ username: 'Viewer', password: 'secret1', role: 'viewer' }))
      .rejects.toMatchObject({ code: 'DUPLICATE_USERNAME', status: 409 });
  });

  test('delete: invalid id 400, self 400, missing 404, ok + audited', async () => {
    const admin  = await users.findByUsername('admin');
    const viewer = await users.findByUsername('viewer');
    await expect(svc.delete('abc', admin)).rejects.toMatchObject({ code: 'INVALID_ID', status: 400 });
    await expect(svc.delete('0', admin)).rejects.toMatchObject({ code: 'INVALID_ID' });
    await expect(svc.delete(String(admin.id), admin)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(svc.delete('999', admin)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(audit.record).not.toHaveBeenCalled();
    await svc.delete(String(viewer.id), admin);
    expect(await users.findById(viewer.id)).toBeNull();
    expect(audit.record).toHaveBeenCalledWith({
      user: admin, action: 'delete', entity: 'user', entityId: viewer.id, details: { username: 'viewer', role: 'viewer' },
    });
  });

  test('audit failure is logged and does not fail the request', async () => {
    const logger = { error: jest.fn() };
    const failing = new UserService(fakeUserRepo(), { audit: { record: async () => { throw new Error('db down'); } }, logger });
    await expect(failing.create({ username: 'dave', password: 'secret1', role: 'viewer' })).resolves.toMatchObject({ username: 'dave' });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Audit record failed \(create user #\d+\)/), expect.any(Error));
  });

  test('works without an audit service', async () => {
    const plain = new UserService(fakeUserRepo());
    await expect(plain.create({ username: 'dave', password: 'secret1', role: 'viewer' })).resolves.toMatchObject({ username: 'dave' });
  });
});

describe('AuditService', () => {
  const repoFake = () => ({ add: jest.fn(async () => 7), list: jest.fn(async () => ({ items: [], total: 0 })) });

  test('record maps the user; system user (id 0) and missing user get userId null', async () => {
    const auditRepo = repoFake();
    const svc = new AuditService(auditRepo);
    await expect(svc.record({ user: { id: 3, username: 'bob' }, action: 'status_change', entity: 'order', entityId: 5, details: { to: 'delivered' } }))
      .resolves.toBe(7);
    expect(auditRepo.add).toHaveBeenLastCalledWith(
      { userId: 3, username: 'bob', action: 'status_change', entity: 'order', entityId: 5, details: { to: 'delivered' } }, undefined);
    await svc.record({ user: { id: 0, username: 'system' }, action: 'create', entity: 'vehicle', entityId: '2' });
    expect(auditRepo.add.mock.calls[1][0]).toMatchObject({ userId: null, username: 'system', entityId: 2, details: null });
    const conn = {};
    await svc.record({ action: 'delete', entity: 'warehouse', entityId: 1 }, conn);
    expect(auditRepo.add.mock.calls[2]).toEqual([expect.objectContaining({ userId: null, username: 'system' }), conn]);
  });

  test.each([
    [{ action: 'status', entity: 'order', entityId: 1 }],
    [{ action: 'create', entity: 'planet', entityId: 1 }],
    [{ action: 'create', entity: 'order', entityId: 0 }],
  ])('record rejects programming errors (case %#)', async entry => {
    await expect(new AuditService(repoFake()).record(entry)).rejects.toThrow(/audit.record/);
  });

  test('list parses query and paginates', async () => {
    const auditRepo = repoFake();
    const svc = new AuditService(auditRepo);
    expect(await svc.list({})).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(auditRepo.list).toHaveBeenLastCalledWith({ entity: null, entityId: null, offset: 0, limit: 20 });
    await svc.list({ entity: 'order', entityId: '4', page: '3', limit: '10' });
    expect(auditRepo.list).toHaveBeenLastCalledWith({ entity: 'order', entityId: 4, offset: 20, limit: 10 });
  });

  test.each([
    [{ entity: 'planet' }], [{ entityId: 'x' }], [{ page: '0' }], [{ limit: '501' }], [{ limit: ['1', '2'] }],
  ])('list invalid query -> 400 INVALID_QUERY (case %#)', async q => {
    await expect(new AuditService(repoFake()).list(q)).rejects.toMatchObject({ code: 'INVALID_QUERY', status: 400 });
  });
});
