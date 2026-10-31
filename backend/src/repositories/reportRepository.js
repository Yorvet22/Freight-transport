// Report aggregates computed in SQL (SPEC §6, §10, §11).
// filters: { from?, to? ('YYYY-MM-DD', inclusive UTC days on createdAt), warehouseId?, vehicleId? }
const { num, dayStart, nextDay } = require('../services/reportUtils');

const TRIP_STATUSES = ['in_transit', 'delivered'];

// Order filter conditions for alias `o`; values always travel as parameters.
function orderConditions({ from, to, warehouseId, vehicleId } = {}) {
  const clauses = [];
  const params  = [];
  if (from)        { clauses.push('o.createdAt >= ?'); params.push(dayStart(from)); }
  if (to)          { clauses.push('o.createdAt < ?');  params.push(nextDay(to)); }
  if (warehouseId) { clauses.push('(o.originWarehouseId = ? OR o.destinationWarehouseId = ?)'); params.push(warehouseId, warehouseId); }
  if (vehicleId)   { clauses.push('o.vehicleId = ?');  params.push(vehicleId); }
  return { clauses, params };
}

const andAll = clauses => clauses.map(c => ` AND ${c}`).join('');

class ReportRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async totals(filters = {}) {
    const { clauses, params } = orderConditions(filters);
    const [[row]] = await this.pool.query(
      `SELECT COUNT(*) AS orders,
              SUM(o.status = 'delivered') AS delivered, SUM(o.status = 'in_transit') AS inTransit,
              SUM(o.status = 'cancelled') AS cancelled, SUM(o.status = 'new') AS \`new\`,
              SUM(o.cargoWeight) AS totalWeight
         FROM orders o
        WHERE 1 = 1${andAll(clauses)}`,
      params,
    );
    return {
      orders: num(row.orders), delivered: num(row.delivered), inTransit: num(row.inTransit),
      cancelled: num(row.cancelled), new: num(row.new), totalWeight: num(row.totalWeight),
    };
  }

  // All warehouses (or only filters.warehouseId) with the filtered orders touching them.
  async byWarehouse(filters = {}) {
    const { clauses, params } = orderConditions(filters);
    const only = filters.warehouseId ? 'WHERE w.id = ?' : '';
    const [rows] = await this.pool.query(
      `SELECT w.id AS warehouseId, w.code, w.name,
              SUM(o.destinationWarehouseId = w.id) AS inbound,
              SUM(o.originWarehouseId = w.id) AS outbound,
              SUM(o.cargoWeight) AS weight
         FROM warehouses w
         LEFT JOIN orders o
           ON (o.originWarehouseId = w.id OR o.destinationWarehouseId = w.id)${andAll(clauses)}
         ${only}
        GROUP BY w.id, w.code, w.name
        ORDER BY w.code, w.id`,
      filters.warehouseId ? [...params, filters.warehouseId] : params,
    );
    return rows.map(r => ({
      warehouseId: r.warehouseId, code: r.code, name: r.name,
      inbound: num(r.inbound), outbound: num(r.outbound), weight: num(r.weight),
    }));
  }

  // All vehicles (or only filters.vehicleId); trips = filtered in_transit + delivered orders.
  async byVehicle(filters = {}) {
    const { clauses, params } = orderConditions(filters);
    const only = filters.vehicleId ? 'WHERE v.id = ?' : '';
    const [rows] = await this.pool.query(
      `SELECT v.id AS vehicleId, v.licensePlate, v.driverName,
              COUNT(o.id) AS trips, SUM(o.status = 'delivered') AS delivered, SUM(o.cargoWeight) AS weight
         FROM vehicles v
         LEFT JOIN orders o
           ON o.vehicleId = v.id AND o.status IN (?, ?)${andAll(clauses)}
         ${only}
        GROUP BY v.id, v.licensePlate, v.driverName
        ORDER BY v.licensePlate, v.id`,
      [...TRIP_STATUSES, ...params, ...(filters.vehicleId ? [filters.vehicleId] : [])],
    );
    return rows.map(r => ({
      vehicleId: r.vehicleId, licensePlate: r.licensePlate, driverName: r.driverName,
      trips: num(r.trips), delivered: num(r.delivered), weight: num(r.weight),
    }));
  }
}

module.exports = ReportRepository;
