const { AppError, validation } = require('../errors');
const { hashPassword, verifyPassword } = require('../auth/password');
const { signToken } = require('../auth/token');
const LoginRateLimiter = require('../auth/rateLimiter');

// Used when the username does not exist, so both failure paths cost one scrypt call.
const DUMMY_HASH = hashPassword('timing-equalizer');

const toPublicUser = u => ({ id: u.id, username: u.username, role: u.role });

class AuthService {
  constructor(userRepo, secret, { rateLimiter = new LoginRateLimiter() } = {}) {
    this.userRepo    = userRepo;
    this.secret      = secret;
    this.rateLimiter = rateLimiter;
  }

  // context.ip identifies the client for rate limiting (per IP + username).
  async login(body, { ip } = {}) {
    const { username, password } = body || {};
    const details = [];
    if (typeof username !== 'string' || !username.trim()) details.push({ field: 'username', message: 'Username is required.' });
    if (typeof password !== 'string' || !password) details.push({ field: 'password', message: 'Password is required.' });
    if (details.length) throw validation(details);

    const name = username.trim();
    const key  = LoginRateLimiter.key(ip, name);
    this.rateLimiter.assertAllowed(key);

    const user = await this.userRepo.findByUsername(name);
    const ok   = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) {
      this.rateLimiter.recordFailure(key);
      throw new AppError('UNAUTHORIZED', 401, 'Invalid username or password.');
    }
    this.rateLimiter.reset(key);

    const token = signToken({ uid: user.id, username: user.username, role: user.role }, this.secret);
    return { user: toPublicUser(user), token };
  }
}

module.exports = AuthService;
