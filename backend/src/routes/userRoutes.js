const express = require('express');

function createUserRoutes(controller, { authenticate, requireRole }) {
  const router = express.Router();
  router.use(authenticate, requireRole('admin'));
  router.get('/', controller.list);
  router.post('/', express.json(), controller.create);
  router.delete('/:id', controller.remove);
  return router;
}

module.exports = createUserRoutes;
