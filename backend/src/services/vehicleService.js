const { notFound, validation, conflict } = require('../errors');
const { validateBody }   = require('../domain/validation');
const { parseListQuery } = require('../domain/listQuery');
const { VEHICLE_STATUS, VEHICLE_STATUSES } = require('../domain/enums');
const { AUDIT_ACTIONS, NOOP_AUDIT } = require('../domain/audit');

const MANUAL_STATUSES = [VEHICLE_STATUS.AVAILABLE, VEHICLE_STATUS.MAINTENANCE];

const VEHICLE_SCHEMA = {
  model:        { type: 'string', max: 100, required: true },
  licensePlate: { type: 'string', max: 20, required: true },
  driverName:   { type: 'string', max: 100, required: true },
  capacityKg:   { type: 'int', min: 1 },
  status:       { type: 'enum', values: VEHICLE_STATUSES },
};

const LIST_SPEC = {
  sorts:       ['licensePlate', 'model', 'driverName', 'status'],
  defaultSort: 'licensePlate',
  defaultDir:  'asc',
  filters:     { status: { type: 'enum', values: VEHICLE_STATUSES } },
};

const manualStatusError = () => validation([
  { field: 'status', message: `status can only be set manually to: ${MANUAL_STATUSES.join(', ')}` },
]);

class VehicleService {
  // audit: { record(entry) } that never rejects (see domain/audit.createSafeAudit).
  constructor({ vehicleRepo }, { audit = NOOP_AUDIT } = {}) {
    this.vehicleRepo = vehicleRepo;
    this.audit       = audit;
  }

  async recordAudit(user, action, vehicle) {
    await this.audit.record({ user, action, entity: 'vehicle', entityId: vehicle.id,
      details: { licensePlate: vehicle.licensePlate } });
  }

  async list(rawQuery) {
    const query = parseListQuery(rawQuery, LIST_SPEC);
    const { items, total } = await this.vehicleRepo.list(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getById(id) {
    const vehicle = await this.vehicleRepo.findById(id);
    if (!vehicle) throw notFound('Vehicle');
    return vehicle;
  }

  async create(body, user) {
    const data = validateBody(body, VEHICLE_SCHEMA);
    if (data.status && !MANUAL_STATUSES.includes(data.status)) throw manualStatusError();
    await this.ensureUniquePlate(data.licensePlate);
    const id = await this.vehicleRepo.create({ ...data, status: data.status || VEHICLE_STATUS.AVAILABLE });
    const vehicle = await this.vehicleRepo.findById(id);
    await this.recordAudit(user, AUDIT_ACTIONS.CREATE, vehicle);
    return vehicle;
  }

  async update(id, body, user) {
    const existing = await this.getById(id);
    const data     = validateBody(body, VEHICLE_SCHEMA);
    data.status    = this.resolveStatus(existing, data.status);
    await this.ensureUniquePlate(data.licensePlate, existing.id);
    await this.vehicleRepo.update(existing.id, data);
    const vehicle = await this.vehicleRepo.findById(existing.id);
    await this.recordAudit(user, AUDIT_ACTIONS.UPDATE, vehicle);
    return vehicle;
  }

  async delete(id, user) {
    const existing = await this.getById(id);
    if (existing.status === VEHICLE_STATUS.ON_TRIP) {
      throw conflict('VEHICLE_IN_USE', 'A vehicle that is on a trip cannot be deleted');
    }
    await this.vehicleRepo.deleteById(existing.id);
    await this.recordAudit(user, AUDIT_ACTIONS.DELETE, existing);
  }

  // BR5: on_trip is controlled by orders only.
  resolveStatus(existing, requested) {
    if (!requested || requested === existing.status) return existing.status;
    if (existing.status === VEHICLE_STATUS.ON_TRIP) {
      throw conflict('VEHICLE_IN_USE', 'The status of a vehicle on a trip cannot be changed manually');
    }
    if (!MANUAL_STATUSES.includes(requested)) throw manualStatusError();
    return requested;
  }

  async ensureUniquePlate(plate, ownId) {
    const other = await this.vehicleRepo.findByPlate(plate);
    if (other && other.id !== ownId) {
      throw conflict('DUPLICATE_PLATE', `A vehicle with plate ${plate} already exists`);
    }
  }
}

module.exports = VehicleService;
