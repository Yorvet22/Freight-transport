const asyncHandler = require('../middleware/asyncHandler');
const { parseId }  = require('../domain/validation');

function warehouseController(service) {
  const id = (req) => parseId(req.params.id);

  return {
    list:    asyncHandler(async (req, res) => res.json(await service.list(req.query))),
    getById: asyncHandler(async (req, res) => res.json(await service.getById(id(req)))),
    create:  asyncHandler(async (req, res) => res.status(201).json(await service.create(req.body, req.user))),
    update:  asyncHandler(async (req, res) => res.json(await service.update(id(req), req.body, req.user))),
    remove:  asyncHandler(async (req, res) => {
      await service.delete(id(req), req.user);
      res.status(204).end();
    }),
    getSchedule: asyncHandler(async (req, res) => res.json(await service.getSchedule(id(req), req.query))),
  };
}

module.exports = warehouseController;
