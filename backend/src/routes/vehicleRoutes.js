const express = require('express');

function createVehicleRoutes(controller, requireRole) {
  const router = express.Router();
  const write  = requireRole('dispatcher');

  router.get('/',       controller.list);
  router.get('/:id',    controller.getById);
  router.post('/',      write, controller.create);
  router.put('/:id',    write, controller.update);
  router.delete('/:id', write, controller.remove);

  return router;
}

module.exports = createVehicleRoutes;
