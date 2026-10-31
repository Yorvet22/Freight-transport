const express = require('express');

function createDashboardRoutes(controller, { authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/kpis', controller.getKpis);
  return router;
}

module.exports = createDashboardRoutes;
