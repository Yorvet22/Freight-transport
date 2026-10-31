const { hashPassword, verifyPassword } = require('../../src/auth/password');
const { signToken, verifyToken, TOKEN_TTL_SECONDS } = require('../../src/auth/token');
const { parseCookies } = require('../../src/auth/cookies');
const { createAuthenticate, requireRole, COOKIE_NAME } = require('../../src/auth/middleware');

describe('password', () => {
  test('hash has scrypt$salt$hash format and verifies', () => {
    const hash = hashPassword('secret123');
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyPassword('secret123', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  test('same password gives different hashes (random salt)', () => {
    expect(hashPassword('a')).not.toBe(hashPassword('a'));
  });

  test('malformed hashes never verify', () => {
    for (const bad of [undefined, null, '', 'plain', 'scrypt$zz', 'md5$00$00', 'scrypt$00$']) {
      expect(verifyPassword('x', bad)).toBe(false);
    }
  });
});

describe('token', () => {
  const secret = 'test-secret';
  const now = 1_700_000_000_000;

  test('round-trips payload and sets 8h expiry', () => {
    const t = signToken({ uid: 1, username: 'admin', role: 'admin' }, secret, now);
    expect(t.split('.')).toHaveLength(2);
    const p = verifyToken(t, secret, now);
    expect(p).toMatchObject({ uid: 1, username: 'admin', role: 'admin' });
    expect(p.exp).toBe(Math.floor(now / 1000) + TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBe(8 * 3600);
  });

  test('rejects expired, wrong secret, tampered and garbage tokens', () => {
    const t = signToken({ uid: 1, username: 'v', role: 'viewer' }, secret, now);
    expect(verifyToken(t, secret, now + 8 * 3600 * 1000 + 1000)).toBeNull();
    expect(verifyToken(t, 'other', now)).toBeNull();
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 1, username: 'v', role: 'admin', exp: 9e9 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(verifyToken(`${payload}.${sig}x`, secret, now)).toBeNull();
    for (const bad of [undefined, '', 'abc', 'a.b.c', '.', `${payload}.`]) {
      expect(verifyToken(bad, secret, now)).toBeNull();
    }
  });
});

describe('parseCookies', () => {
  test('parses header into object, decoding values', () => {
    expect(parseCookies('a=1; ft_token=x.y; b=%20z')).toEqual({ a: '1', ft_token: 'x.y', b: ' z' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('junk; =v; k=')).toEqual({ k: '' });
    expect(parseCookies('bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });
});

function run(mw, req) {
  return new Promise(resolve => mw(req, {}, err => resolve(err)));
}

describe('authenticate middleware', () => {
  const secret = 's';

  test('authDisabled sets system admin user', async () => {
    const req = { headers: {} };
    const err = await run(createAuthenticate({ secret, authDisabled: true }), req);
    expect(err).toBeUndefined();
    expect(req.user).toEqual({ id: 0, username: 'system', role: 'admin' });
  });

  const db = {
    7: { id: 7, username: 'd', passwordHash: 'h', role: 'dispatcher', createdAt: 'x' },
    8: { id: 8, username: 'demoted', passwordHash: 'h', role: 'viewer', createdAt: 'x' },
  };
  const userRepo = { findById: jest.fn(async id => db[id] || null) };
  const cookieFor = payload => `${COOKIE_NAME}=${signToken(payload, secret)}`;

  test('valid cookie loads the user from the repository and sets req.user', async () => {
    const req = { headers: { cookie: cookieFor({ uid: 7, username: 'd', role: 'dispatcher' }) } };
    const err = await run(createAuthenticate({ secret, userRepo }), req);
    expect(err).toBeUndefined();
    expect(userRepo.findById).toHaveBeenCalledWith(7);
    expect(req.user).toEqual({ id: 7, username: 'd', role: 'dispatcher' });
  });

  test('role comes from the DB record, not the token (role change takes effect immediately)', async () => {
    const req = { headers: { cookie: cookieFor({ uid: 8, username: 'demoted', role: 'admin' }) } };
    await run(createAuthenticate({ secret, userRepo }), req);
    expect(req.user).toEqual({ id: 8, username: 'demoted', role: 'viewer' });
  });

  test('valid token for a deleted user -> 401 UNAUTHORIZED', async () => {
    const req = { headers: { cookie: cookieFor({ uid: 99, username: 'gone', role: 'admin' }) } };
    const err = await run(createAuthenticate({ secret, userRepo }), req);
    expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(req.user).toBeUndefined();
  });

  test('repository errors are passed to next', async () => {
    const boom = new Error('db down');
    const failing = { findById: async () => { throw boom; } };
    const req = { headers: { cookie: cookieFor({ uid: 7, username: 'd', role: 'dispatcher' }) } };
    expect(await run(createAuthenticate({ secret, userRepo: failing }), req)).toBe(boom);
  });

  test('missing or invalid cookie -> 401 UNAUTHORIZED without a DB lookup', async () => {
    userRepo.findById.mockClear();
    for (const cookie of [undefined, 'ft_token=nope', 'other=1']) {
      const err = await run(createAuthenticate({ secret, userRepo }), { headers: { cookie } });
      expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    }
    expect(userRepo.findById).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  test('hierarchy viewer < dispatcher < admin', async () => {
    const cases = [
      ['viewer', 'viewer', true], ['viewer', 'dispatcher', false], ['viewer', 'admin', false],
      ['dispatcher', 'dispatcher', true], ['dispatcher', 'admin', false],
      ['admin', 'viewer', true], ['admin', 'admin', true],
    ];
    for (const [role, min, ok] of cases) {
      const err = await run(requireRole(min), { user: { id: 1, username: 'u', role } });
      if (ok) expect(err).toBeUndefined();
      else expect(err).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }
  });

  test('no user -> 401, unknown role on user -> 403, unknown min role throws', async () => {
    expect(await run(requireRole('viewer'), {})).toMatchObject({ status: 401 });
    expect(await run(requireRole('viewer'), { user: { role: 'hacker' } })).toMatchObject({ status: 403 });
    expect(() => requireRole('superuser')).toThrow();
  });
});
