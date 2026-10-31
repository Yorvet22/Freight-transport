const express = require('express');

// Reads are open to any authenticated user; writes need dispatcher+ (SPEC §5).
function createOrderRoutes(controller, requireRole) {
  const router = express.Router();
  const write  = requireRole('dispatcher');

  router.get('/',              controller.list);
  router.get('/:id',           controller.getById);
  router.get('/:id/history',   controller.getHistory);
  router.post('/',             write, controller.create);
  router.put('/:id',           write, controller.update);
  router.patch('/:id/status',  write, controller.changeStatus);
  router.delete('/:id',        write, controller.remove);

  return router;
}

module.exports = createOrderRoutes;
