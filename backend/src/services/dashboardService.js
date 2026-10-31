const { lastUtcDays, nextDay, dayStart, round, ratio, toListShape } = require('./reportUtils');

const DAYS   = 14;
const RECENT = 5;

// Composes the §6 KPI payload from SQL aggregates (dashboardRepo) and the order list query (orderRepo).
class DashboardService {
  constructor({ dashboardRepo, orderRepo }, { now = () => new Date() } = {}) {
    Object.assign(this, { dashboardRepo, orderRepo, now });
  }

  async getKpis() {
    const days = lastUtcDays(this.now(), DAYS);
    const repo = this.dashboardRepo;
    const [orders, vehicles, onTime, transit, perDay, warehouses, recent] = await Promise.all([
      repo.orderCounts(),
      repo.vehicleCounts(),
      repo.onTimeCounts(),
      repo.avgTransitHours(),
      repo.ordersPerDay(dayStart(days[0]), nextDay(days[days.length - 1])),
      repo.warehouseFlows(),
      this.orderRepo.list({ page: 1, limit: RECENT, sort: 'createdAt', dir: 'desc' }),
    ]);
    const counts = new Map(perDay.map(d => [d.date, d.count]));
    return {
      orders,
      vehicles,
      onTimeRate:       ratio(onTime.onTime, onTime.planned),
      fleetUtilization: ratio(vehicles.on_trip, vehicles.total - vehicles.maintenance),
      avgTransitHours:  transit === null ? null : round(transit, 2),
      ordersPerDay:     days.map(date => ({ date, count: counts.get(date) || 0 })),
      warehouses,
      recentOrders:     recent.items.map(toListShape),
    };
  }
}

module.exports = DashboardService;
