const express = require('express');

function createAuditRoutes(controller, { authenticate, requireRole }) {
  const router = express.Router();
  router.use(authenticate, requireRole('admin'));
  router.get('/', controller.list);
  return router;
}

module.exports = createAuditRoutes;
