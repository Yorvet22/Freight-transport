const LoginRateLimiter = require('../../src/auth/rateLimiter');

describe('LoginRateLimiter', () => {
  let clock;
  let limiter;
  const key = LoginRateLimiter.key('1.2.3.4', 'Admin');
  beforeEach(() => {
    clock = 1_000_000;
    limiter = new LoginRateLimiter({ max: 3, windowMs: 60_000, now: () => clock });
  });

  test('key combines IP and case-insensitive trimmed username', () => {
    expect(LoginRateLimiter.key('1.2.3.4', ' ADMIN ')).toBe(key);
    expect(LoginRateLimiter.key(undefined, 'x')).toBe('unknown|x');
  });

  test('blocks after max failures with 429 TOO_MANY_REQUESTS', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(() => limiter.assertAllowed(key)).not.toThrow();
      limiter.recordFailure(key);
    }
    let err;
    try { limiter.assertAllowed(key); } catch (e) { err = e; }
    expect(err).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
    expect(err.message).toMatch(/1 minute/);
    // other keys are unaffected
    expect(() => limiter.assertAllowed(LoginRateLimiter.key('5.6.7.8', 'admin'))).not.toThrow();
  });

  test('window expiry unblocks the key', () => {
    for (let i = 0; i < 3; i += 1) limiter.recordFailure(key);
    clock += 59_999;
    expect(() => limiter.assertAllowed(key)).toThrow();
    clock += 1;
    expect(() => limiter.assertAllowed(key)).not.toThrow();
    limiter.recordFailure(key); // new window starts with count 1
    expect(limiter.entries.get(key).count).toBe(1);
  });

  test('reset clears the counter; sweep removes expired entries', () => {
    for (let i = 0; i < 3; i += 1) limiter.recordFailure(key);
    limiter.reset(key);
    expect(() => limiter.assertAllowed(key)).not.toThrow();
    limiter.recordFailure('other');
    clock += 60_000;
    limiter.sweep();
    expect(limiter.entries.size).toBe(0);
  });

  test('defaults: 10 attempts per 15 minutes', () => {
    const d = new LoginRateLimiter();
    expect(d.max).toBe(10);
    expect(d.windowMs).toBe(15 * 60 * 1000);
  });
});
