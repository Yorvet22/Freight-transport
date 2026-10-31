const { AppError } = require('../errors');
const { DATE_ONLY_RE, round, ratio, toListShape } = require('./reportUtils');

const invalidQuery = (field, message) =>
  new AppError('INVALID_QUERY', 400, 'Invalid query parameters.', [{ field, message }]);

const isBlank = v => v === undefined || v === null || v === '';

function parseDate(query, field) {
  const v = query[field];
  if (isBlank(v)) return null;
  if (typeof v !== 'string' || !DATE_ONLY_RE.test(v)) throw invalidQuery(field, 'Date must be in YYYY-MM-DD format.');
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw invalidQuery(field, 'Date is not valid.');
  return v;
}

function parseId(query, field) {
  const v = query[field];
  if (isBlank(v)) return null;
  const n = Number(v);
  if (typeof v !== 'string' || !/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < 1) {
    throw invalidQuery(field, 'Id must be a positive integer.');
  }
  return n;
}

function parseFilters(query = {}) {
  const filters = {
    from:        parseDate(query, 'from'),
    to:          parseDate(query, 'to'),
    warehouseId: parseId(query, 'warehouseId'),
    vehicleId:   parseId(query, 'vehicleId'),
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    throw invalidQuery('to', '"to" must not be earlier than "from".');
  }
  return filters;
}

const roundWeight = row => ({ ...row, weight: round(row.weight, 2) });

// Composes the §6 report payload from SQL aggregates (reportRepo) and the order list query (orderRepo).
class ReportService {
  constructor({ reportRepo, orderRepo }) {
    Object.assign(this, { reportRepo, orderRepo });
  }

  async getSummary(query) {
    const filters = parseFilters(query);
    const [totals, byWarehouse, byVehicle, orders] = await Promise.all([
      this.reportRepo.totals(filters),
      this.reportRepo.byWarehouse(filters),
      this.reportRepo.byVehicle(filters),
      this.orderRepo.listAll({
        from: filters.from, to: filters.to, warehouseId: filters.warehouseId, direction: 'any',
        vehicleId: filters.vehicleId, sort: 'createdAt', dir: 'desc',
      }),
    ]);
    return {
      filters,
      totals: {
        ...totals,
        totalWeight:  round(totals.totalWeight, 2),
        deliveryRate: ratio(totals.delivered, totals.orders) || 0,
      },
      byWarehouse: byWarehouse.map(roundWeight),
      byVehicle:   byVehicle.map(roundWeight),
      orders:      orders.map(toListShape),
    };
  }
}

module.exports = ReportService;
module.exports.parseFilters = parseFilters;
