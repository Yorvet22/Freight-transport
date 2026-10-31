// Platform module: authentication, users, audit log, dashboard KPIs and reports (docs/SPEC.md §5, §6, §8, §11).
const crypto = require('crypto');

const { createAuthenticate, requireRole } = require('./auth/middleware');
const LoginRateLimiter       = require('./auth/rateLimiter');
const UserRepository         = require('./repositories/userRepository');
const AuditRepository        = require('./repositories/auditRepository');
const DashboardRepository    = require('./repositories/dashboardRepository');
const ReportRepository       = require('./repositories/reportRepository');
const AuthService            = require('./services/authService');
const UserService            = require('./services/userService');
const AuditService           = require('./services/auditService');
const DashboardService       = require('./services/dashboardService');
const ReportService          = require('./services/reportService');
const authController         = require('./controllers/authController');
const userController         = require('./controllers/userController');
const auditController        = require('./controllers/auditController');
const dashboardController    = require('./controllers/dashboardController');
const reportController       = require('./controllers/reportController');
const createAuthRoutes       = require('./routes/authRoutes');
const createUserRoutes       = require('./routes/userRoutes');
const createAuditRoutes      = require('./routes/auditRoutes');
const createDashboardRoutes  = require('./routes/dashboardRoutes');
const createReportRoutes     = require('./routes/reportRoutes');

// SESSION_SECRET is mandatory in production; elsewhere a random per-process secret is used.
function resolveSecret(sessionSecret, { authDisabled, logger, env = process.env }) {
  if (sessionSecret) return sessionSecret;
  if (env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
  }
  if (!authDisabled) {
    logger.warn('SESSION_SECRET is not set: using a random secret. Sessions will not survive a restart.');
  }
  return crypto.randomBytes(32).toString('hex');
}

/**
 * options: { pool (mysql2 pool, required), repos: { orderRepo, vehicleRepo, warehouseRepo, userRepo?, auditRepo? },
 *            authDisabled, sessionSecret, logger, env?, rateLimiter? }
 * returns: { authenticate, requireRole, mount(app), audit, userRepo }
 */
function createPlatform({
  pool, repos = {}, authDisabled = false, sessionSecret, logger = console, env = process.env, rateLimiter,
} = {}) {
  if (!pool) throw new Error('createPlatform: a MySQL pool is required.');
  const secret       = resolveSecret(sessionSecret, { authDisabled, logger, env });
  const userRepo     = repos.userRepo || new UserRepository(pool);
  const auditRepo    = repos.auditRepo || new AuditRepository(pool);
  const audit        = new AuditService(auditRepo, { logger });
  const authenticate = createAuthenticate({ secret, authDisabled, userRepo });
  const guards       = { authenticate, requireRole };
  const limiter      = rateLimiter || new LoginRateLimiter();

  const authCtrl      = authController(new AuthService(userRepo, secret, { rateLimiter: limiter }));
  const userCtrl      = userController(new UserService(userRepo, { audit, logger }));
  const auditCtrl     = auditController(audit);
  const dashboardCtrl = dashboardController(new DashboardService({ dashboardRepo: new DashboardRepository(pool), orderRepo: repos.orderRepo }));
  const reportCtrl    = reportController(new ReportService({ reportRepo: new ReportRepository(pool), orderRepo: repos.orderRepo }));

  function mount(app) {
    app.use('/api/auth',      createAuthRoutes(authCtrl, guards));
    app.use('/api/users',     createUserRoutes(userCtrl, guards));
    app.use('/api/audit',     createAuditRoutes(auditCtrl, guards));
    app.use('/api/dashboard', createDashboardRoutes(dashboardCtrl, guards));
    app.use('/api/reports',   createReportRoutes(reportCtrl, guards));
  }

  return { authenticate, requireRole, mount, audit, userRepo };
}

module.exports = { createPlatform, resolveSecret };
