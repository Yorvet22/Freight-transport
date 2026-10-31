// Dashboard aggregates computed in SQL (SPEC §6, §11). DATETIME columns hold UTC values,
// so DATE()/DATE_FORMAT() yield UTC calendar days.
const { num } = require('../services/reportUtils');

function mapNumbers(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = num(v);
  return out;
}

class DashboardRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async orderCounts() {
    const [[row]] = await this.pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'new') AS \`new\`, SUM(status = 'in_transit') AS in_transit,
              SUM(status = 'delivered') AS delivered, SUM(status = 'cancelled') AS cancelled
         FROM orders`,
    );
    return mapNumbers(row);
  }

  async vehicleCounts() {
    const [[row]] = await this.pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'available') AS available, SUM(status = 'on_trip') AS on_trip,
              SUM(status = 'maintenance') AS maintenance
         FROM vehicles`,
    );
    return mapNumbers(row);
  }

  // Delivered orders having a planned date, and how many of them arrived on/before that UTC day.
  async onTimeCounts() {
    const [[row]] = await this.pool.query(
      `SELECT COUNT(*) AS planned, SUM(DATE(deliveredAt) <= plannedDeliveryDate) AS onTime
         FROM orders
        WHERE status = 'delivered' AND plannedDeliveryDate IS NOT NULL`,
    );
    return mapNumbers(row);
  }

  // Average hours between the latest "-> in_transit" history row and deliveredAt; null if none.
  async avgTransitHours() {
    const [[row]] = await this.pool.query(
      `SELECT AVG(TIMESTAMPDIFF(SECOND, h.departedAt, o.deliveredAt)) / 3600 AS hours
         FROM orders o
         JOIN (SELECT orderId, MAX(changedAt) AS departedAt
                 FROM order_status_history
                WHERE toStatus = 'in_transit'
                GROUP BY orderId) h ON h.orderId = o.id
        WHERE o.status = 'delivered' AND o.deliveredAt IS NOT NULL AND o.deliveredAt >= h.departedAt`,
    );
    return row.hours === null || row.hours === undefined ? null : Number(row.hours);
  }

  // Orders created in [from, to) grouped by UTC day -> [{ date: 'YYYY-MM-DD', count }]; empty days omitted.
  async ordersPerDay(from, to) {
    const [rows] = await this.pool.query(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS day, COUNT(*) AS count
         FROM orders
        WHERE createdAt >= ? AND createdAt < ?
        GROUP BY day
        ORDER BY day`,
      [from, to],
    );
    return rows.map(r => ({ date: r.day, count: num(r.count) }));
  }

  // Every warehouse with its order counts: inbound = destination, outbound = origin.
  async warehouseFlows() {
    const [rows] = await this.pool.query(
      `SELECT w.id, w.code, w.name,
              (SELECT COUNT(*) FROM orders o WHERE o.destinationWarehouseId = w.id) AS inbound,
              (SELECT COUNT(*) FROM orders o WHERE o.originWarehouseId = w.id) AS outbound
         FROM warehouses w
        ORDER BY w.code, w.id`,
    );
    return rows.map(r => ({ id: r.id, code: r.code, name: r.name, inbound: num(r.inbound), outbound: num(r.outbound) }));
  }
}

module.exports = DashboardRepository;
