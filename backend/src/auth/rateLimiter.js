// In-process login rate limiter (SPEC §11): at most `max` failed attempts per key within `windowMs`.
// The window starts at the first failure; a successful login resets the key. No external store (KISS).
const { AppError } = require('../errors');

const DEFAULT_MAX       = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const SWEEP_THRESHOLD   = 1000;

class LoginRateLimiter {
  constructor({ max = DEFAULT_MAX, windowMs = DEFAULT_WINDOW_MS, now = () => Date.now() } = {}) {
    Object.assign(this, { max, windowMs, now });
    this.entries = new Map(); // key -> { count, resetAt }
  }

  static key(ip, username) {
    return `${ip || 'unknown'}|${String(username || '').trim().toLowerCase()}`;
  }

  current(key) {
    const entry = this.entries.get(key);
    if (entry && entry.resetAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry || null;
  }

  // Throws 429 TOO_MANY_REQUESTS while the key is blocked.
  assertAllowed(key) {
    const entry = this.current(key);
    if (entry && entry.count >= this.max) {
      const minutes = Math.max(1, Math.ceil((entry.resetAt - this.now()) / 60000));
      throw new AppError('TOO_MANY_REQUESTS', 429,
        `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
  }

  recordFailure(key) {
    const entry = this.current(key);
    if (entry) entry.count += 1;
    else this.entries.set(key, { count: 1, resetAt: this.now() + this.windowMs });
    if (this.entries.size > SWEEP_THRESHOLD) this.sweep();
  }

  reset(key) {
    this.entries.delete(key);
  }

  sweep() {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }
}

module.exports = LoginRateLimiter;
