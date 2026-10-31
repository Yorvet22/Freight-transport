function userController(service) {
  async function list(req, res, next) {
    try {
      res.status(200).json(await service.list());
    } catch (err) {
      next(err);
    }
  }

  async function create(req, res, next) {
    try {
      res.status(201).json(await service.create(req.body, req.user));
    } catch (err) {
      next(err);
    }
  }

  async function remove(req, res, next) {
    try {
      await service.delete(req.params.id, req.user);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  return { list, create, remove };
}

module.exports = userController;
