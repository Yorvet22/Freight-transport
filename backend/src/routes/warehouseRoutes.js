const express = require('express');

function createWarehouseRoutes(controller, requireRole) {
  const router = express.Router();
  const write  = requireRole('admin');

  router.get('/',              controller.list);
  router.get('/:id',           controller.getById);
  router.get('/:id/schedule',  controller.getSchedule);
  router.post('/',             write, controller.create);
  router.put('/:id',           write, controller.update);
  router.delete('/:id',        write, controller.remove);

  return router;
}

module.exports = createWarehouseRoutes;
