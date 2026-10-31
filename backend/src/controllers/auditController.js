function auditController(service) {
  async function list(req, res, next) {
    try {
      res.status(200).json(await service.list(req.query));
    } catch (err) {
      next(err);
    }
  }

  return { list };
}

module.exports = auditController;
