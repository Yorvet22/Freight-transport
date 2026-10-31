const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');

const { createPlatform }     = require('./platform');
const { notFound }           = require('./errors');
const { createRepositories } = require('./repositories');
const { createSafeAudit }    = require('./domain/audit');
const OrderService           = require('./services/orderService');
const VehicleService         = require('./services/vehicleService');
const WarehouseService       = require('./services/warehouseService');
const orderController        = require('./controllers/orderController');
const vehicleController      = require('./controllers/vehicleController');
const warehouseController    = require('./controllers/warehouseController');
const createOrderRoutes      = require('./routes/orderRoutes');
const createVehicleRoutes    = require('./routes/vehicleRoutes');
const createWarehouseRoutes  = require('./routes/warehouseRoutes');
const { createErrorHandler } = require('./middleware/errorHandler');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');

// CDNs used by the frontend pages (Bootstrap, icons, charts, Inter font).
const CDNS = ['https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com'];

const securityHeaders = () => helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", ...CDNS],
      styleSrc:   ["'self'", "'unsafe-inline'", ...CDNS, 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'data:', ...CDNS, 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],          // data: for POD signatures
      connectSrc: ["'self'", ...CDNS],                   // CDN source maps
    },
  },
});

// GET /api/health — pings the database (SPEC §11).
const healthCheck = (pool) => async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'down' });
  }
};

/**
 * options: { pool, authDisabled = false, sessionSecret, corsOrigin, trustProxy, logger = console } (SPEC §8, §11).
 * The MySQL pool is injected and owned by the caller (server.js / tests).
 */
function createApp({ pool, authDisabled = false, sessionSecret, corsOrigin, trustProxy, logger = console } = {}) {
  if (!pool) throw new Error('createApp: a MySQL pool is required');
  const repos    = createRepositories(pool);
  const platform = createPlatform({ pool, repos, authDisabled: Boolean(authDisabled), sessionSecret, logger });
  const { requireRole } = platform;
  const audit    = createSafeAudit(platform.audit, logger);

  const app = express();
  app.locals.repos = repos;
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy); // real client IP behind a reverse proxy (rate limiting)

  app.use(securityHeaders());
  if (corsOrigin) app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', healthCheck(pool));

  platform.mount(app);
  app.use('/api', platform.authenticate);
  app.use('/api/orders',     createOrderRoutes(orderController(new OrderService(repos, { audit })), requireRole));
  app.use('/api/vehicles',   createVehicleRoutes(vehicleController(new VehicleService(repos, { audit })), requireRole));
  app.use('/api/warehouses', createWarehouseRoutes(warehouseController(new WarehouseService(repos, { audit })), requireRole));
  app.use('/api', (req, res, next) => next(notFound('API route')));

  app.use(express.static(path.join(FRONTEND, 'pages')));
  app.use(express.static(FRONTEND));
  app.get('/', (req, res) => res.sendFile(path.join(FRONTEND, 'pages', 'index.html')));

  app.use(createErrorHandler(logger));
  return app;
}

module.exports = { createApp };
