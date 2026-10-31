const { COOKIE_NAME } = require('../auth/middleware');
const { TOKEN_TTL_SECONDS } = require('../auth/token');

// Secure cookies in production (served over HTTPS).
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' };

function authController(service) {
  async function login(req, res, next) {
    try {
      const { user, token } = await service.login(req.body, { ip: req.ip });
      res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: TOKEN_TTL_SECONDS * 1000 });
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  }

  function logout(req, res) {
    res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
    res.status(204).end();
  }

  function me(req, res) {
    const { id, username, role } = req.user;
    res.status(200).json({ user: { id, username, role } });
  }

  return { login, logout, me };
}

module.exports = authController;
