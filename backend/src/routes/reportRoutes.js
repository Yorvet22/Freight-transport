const express = require('express');

function createReportRoutes(controller, { authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/summary', controller.getSummary);
  return router;
}

module.exports = createReportRoutes;
