function reportController(service) {
  async function getSummary(req, res, next) {
    try {
      res.status(200).json(await service.getSummary(req.query));
    } catch (err) {
      next(err);
    }
  }

  return { getSummary };
}

module.exports = reportController;
