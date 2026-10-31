const { notFound, conflict } = require('../errors');
const { validateBody }   = require('../domain/validation');
const { parseQuery, parseListQuery } = require('../domain/listQuery');
const { AUDIT_ACTIONS, NOOP_AUDIT } = require('../domain/audit');

const WAREHOUSE_SCHEMA = {
  code:            { type: 'string', max: 20, required: true },
  name:            { type: 'string', max: 100, required: true },
  address:         { type: 'string', max: 200, required: true },
  city:            { type: 'string', max: 100, required: true },
  capacityPallets: { type: 'int', min: 0 },
  managerName:     { type: 'string', max: 100 },
  phone:           { type: 'string', max: 30 },
  isActive:        { type: 'boolean' },
};

const LIST_SPEC = {
  sorts:       ['code', 'name', 'city'],
  defaultSort: 'code',
  defaultDir:  'asc',
  filters:     { active: { type: 'boolean' } },
};

const SCHEDULE_SCHEMA = { date: { type: 'date' } };

class WarehouseService {
  // audit: { record(entry) } that never rejects (see domain/audit.createSafeAudit).
  constructor({ warehouseRepo, orderRepo }, { now = () => new Date(), audit = NOOP_AUDIT } = {}) {
    this.warehouseRepo = warehouseRepo;
    this.orderRepo     = orderRepo;
    this.now           = now;
    this.audit         = audit;
  }

  async recordAudit(user, action, warehouse) {
    await this.audit.record({ user, action, entity: 'warehouse', entityId: warehouse.id, details: { code: warehouse.code } });
  }

  async list(rawQuery) {
    const query = parseListQuery(rawQuery, LIST_SPEC);
    const { items, total } = await this.warehouseRepo.list(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getById(id) {
    const warehouse = await this.warehouseRepo.findById(id);
    if (!warehouse) throw notFound('Warehouse');
    return warehouse;
  }

  // Dates are calendar days in UTC.
  async getSchedule(id, rawQuery) {
    await this.getById(id);
    const { date: requested } = parseQuery(rawQuery, SCHEDULE_SCHEMA);
    const date = requested || this.now().toISOString().slice(0, 10);
    const [departures, arrivals] = await Promise.all([
      this.orderRepo.listAll({ originWarehouseId: id, pickupDate: date, sort: 'pickupWindowStart', dir: 'asc' }),
      this.orderRepo.listAll({ destinationWarehouseId: id, plannedDeliveryDate: date, sort: 'createdAt', dir: 'asc' }),
    ]);
    return { date, departures, arrivals };
  }

  async create(body, user) {
    const data = validateBody(body, WAREHOUSE_SCHEMA);
    await this.ensureUniqueCode(data.code);
    const id = await this.warehouseRepo.create({ ...data, isActive: data.isActive !== false, createdAt: this.now() });
    const warehouse = await this.warehouseRepo.findById(id);
    await this.recordAudit(user, AUDIT_ACTIONS.CREATE, warehouse);
    return warehouse;
  }

  async update(id, body, user) {
    const existing = await this.getById(id);
    const data     = validateBody(body, WAREHOUSE_SCHEMA);
    if (data.isActive === null) data.isActive = existing.isActive;
    await this.ensureUniqueCode(data.code, existing.id);
    await this.warehouseRepo.update(existing.id, data);
    const warehouse = await this.warehouseRepo.findById(existing.id);
    await this.recordAudit(user, AUDIT_ACTIONS.UPDATE, warehouse);
    return warehouse;
  }

  async delete(id, user) {
    const existing = await this.getById(id);
    if (await this.warehouseRepo.countOpenOrders(existing.id) > 0) {
      throw conflict('WAREHOUSE_IN_USE', 'The warehouse is referenced by new or in-transit orders');
    }
    await this.warehouseRepo.deleteById(existing.id);
    await this.recordAudit(user, AUDIT_ACTIONS.DELETE, existing);
  }

  async ensureUniqueCode(code, ownId) {
    const other = await this.warehouseRepo.findByCode(code);
    if (other && other.id !== ownId) {
      throw conflict('DUPLICATE_CODE', `A warehouse with code ${code} already exists`);
    }
  }
}

module.exports = WarehouseService;
