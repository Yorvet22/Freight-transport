const { AppError }    = require('../errors');
const { verifyToken } = require('./token');
const { parseCookies } = require('./cookies');

const COOKIE_NAME = 'ft_token';
const ROLE_RANK   = { viewer: 1, dispatcher: 2, admin: 3 };
const SYSTEM_USER = Object.freeze({ id: 0, username: 'system', role: 'admin' });

const unauthorized = () => new AppError('UNAUTHORIZED', 401, 'Authentication required.');

// Verifies the signed cookie, then loads the user record so that deletions and
// role changes take effect immediately (the token only proves identity).
function createAuthenticate({ secret, authDisabled = false, userRepo }) {
  return async function authenticate(req, res, next) {
    if (authDisabled) {
      req.user = { ...SYSTEM_USER };
      return next();
    }
    const token   = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
    const payload = verifyToken(token, secret);
    if (!payload) return next(unauthorized());
    try {
      const user = await userRepo.findById(payload.uid);
      if (!user) return next(unauthorized());
      req.user = { id: user.id, username: user.username, role: user.role };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function requireRole(minRole) {
  const min = ROLE_RANK[minRole];
  if (!min) throw new Error(`Unknown role: ${minRole}`);
  return function checkRole(req, res, next) {
    if (!req.user) return next(unauthorized());
    if ((ROLE_RANK[req.user.role] || 0) < min) {
      return next(new AppError('FORBIDDEN', 403, 'You do not have permission to perform this action.'));
    }
    return next();
  };
}

module.exports = { createAuthenticate, requireRole, COOKIE_NAME, ROLE_RANK, SYSTEM_USER };
