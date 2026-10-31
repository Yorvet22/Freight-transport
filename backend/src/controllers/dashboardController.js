function dashboardController(service) {
  async function getKpis(req, res, next) {
    try {
      res.status(200).json(await service.getKpis());
    } catch (err) {
      next(err);
    }
  }

  return { getKpis };
}

module.exports = dashboardController;
