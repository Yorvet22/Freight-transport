const { notFound, validation, conflict } = require('../errors');
const { validateBody }   = require('../domain/validation');
const { parseListQuery } = require('../domain/listQuery');
const { ORDER_STATUS, ORDER_STATUSES, ORDER_TYPES, VEHICLE_STATUS, canTransition } = require('../domain/enums');
const { AUDIT_ACTIONS, NOOP_AUDIT } = require('../domain/audit');

const POD_PREFIX        = 'data:image/png;base64,';
const MAX_SIGNATURE_LEN = 500 * 1024;
const LOCKED_STATUSES   = [ORDER_STATUS.IN_TRANSIT, ORDER_STATUS.DELIVERED];

const ORDER_SCHEMA = {
  type:                   { type: 'enum', values: ORDER_TYPES, required: true },
  clientName:             { type: 'string', max: 100, required: true },
  pickupAddress:          { type: 'string', max: 200, required: true },
  deliveryAddress:        { type: 'string', max: 200, required: true },
  cargoDescription:       { type: 'string', max: 2000, required: true },
  cargoWeight:            { type: 'number', gt: 0, max: 100000, required: true },
  vehicleId:              { type: 'int' },
  originWarehouseId:      { type: 'int' },
  destinationWarehouseId: { type: 'int' },
  plannedDeliveryDate:    { type: 'date' },
  pickupWindowStart:      { type: 'datetime' },
  pickupWindowEnd:        { type: 'datetime' },
  dockNumber:             { type: 'string', max: 10 },
};

const STATUS_SCHEMA = {
  status:           { type: 'enum', values: ORDER_STATUSES, required: true },
  note:             { type: 'string', max: 500 },
  podRecipientName: { type: 'string', max: 100 },
  podSignature:     { type: 'string' },
  podNote:          { type: 'string', max: 500 },
};

const LIST_SPEC = {
  sorts:       ['createdAt', 'orderNumber', 'clientName', 'cargoWeight', 'status', 'plannedDeliveryDate'],
  defaultSort: 'createdAt',
  defaultDir:  'desc',
  filters: {
    status:      { type: 'enum', values: ORDER_STATUSES },
    type:        { type: 'enum', values: ORDER_TYPES },
    vehicleId:   { type: 'int' },
    warehouseId: { type: 'int' },
    direction:   { type: 'enum', values: ['inbound', 'outbound', 'any'], default: 'any' },
  },
};

const REQUIRED_WAREHOUSES = {
  inbound:  ['destinationWarehouseId'],
  outbound: ['originWarehouseId'],
  transfer: ['originWarehouseId', 'destinationWarehouseId'],
};

const detail = (field, message) => ({ field, message });

function checkPickupWindow(data) {
  const { pickupWindowStart: start, pickupWindowEnd: end } = data;
  if (start && end && end < start) {
    throw validation([detail('pickupWindowEnd', 'pickupWindowEnd must not be earlier than pickupWindowStart')]);
  }
}

class OrderService {
  // audit: { record(entry) } that never rejects (see domain/audit.createSafeAudit).
  constructor({ orderRepo, vehicleRepo, warehouseRepo, historyRepo }, { now = () => new Date(), audit = NOOP_AUDIT } = {}) {
    this.orderRepo     = orderRepo;
    this.vehicleRepo   = vehicleRepo;
    this.warehouseRepo = warehouseRepo;
    this.historyRepo   = historyRepo;
    this.now           = now;
    this.audit         = audit;
  }

  async recordAudit(user, action, order, details = { orderNumber: order.orderNumber }) {
    await this.audit.record({ user, action, entity: 'order', entityId: order.id, details });
  }

  async list(rawQuery) {
    const query = parseListQuery(rawQuery, LIST_SPEC);
    const { items, total } = await this.orderRepo.list(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getById(id) {
    const order = await this.orderRepo.findById(id);
    if (!order) throw notFound('Order');
    return order;
  }

  async getHistory(id) {
    await this.getById(id);
    return this.historyRepo.findByOrderId(id);
  }

  async create(body, user) {
    const data = validateBody(body, ORDER_SCHEMA);
    checkPickupWindow(data);
    await this.checkWarehouses(data);
    await this.checkVehicle(data.vehicleId);

    const createdAt = this.now();
    const id = await this.orderRepo.create(
      { ...data, status: ORDER_STATUS.NEW, createdAt },
      historyEntry(null, ORDER_STATUS.NEW, user, null, createdAt),
    );
    const order = await this.orderRepo.findById(id);
    await this.recordAudit(user, AUDIT_ACTIONS.CREATE, order);
    return order;
  }

  async update(id, body, user) {
    const existing = await this.getById(id);
    if (LOCKED_STATUSES.includes(existing.status)) {
      throw conflict('ORDER_LOCKED', `Orders that are ${existing.status} cannot be edited`);
    }
    const data = validateBody(body, ORDER_SCHEMA);
    checkPickupWindow(data);
    if (data.vehicleId !== existing.vehicleId) {
      if (existing.status !== ORDER_STATUS.NEW) {
        throw conflict('ORDER_LOCKED', 'The vehicle can only be changed while the order is new');
      }
      await this.checkVehicle(data.vehicleId);
    }
    await this.checkWarehouses(data, existing);
    await this.orderRepo.update(id, data);
    const order = await this.orderRepo.findById(id);
    await this.recordAudit(user, AUDIT_ACTIONS.UPDATE, order);
    return order;
  }

  async changeStatus(id, body, user) {
    const order = await this.getById(id);
    const input = validateBody(body, STATUS_SCHEMA);
    if (!canTransition(order.status, input.status)) {
      throw conflict('INVALID_TRANSITION', `Cannot change status from ${order.status} to ${input.status}`);
    }

    const { orderPatch, vehicleStatus } = await this.planTransition(order, input);
    const changedAt = this.now();
    if (input.status === ORDER_STATUS.DELIVERED) orderPatch.deliveredAt = changedAt;

    await this.orderRepo.applyStatusChange({                 // one atomic write (BR3)
      orderId:      id,
      orderPatch:   { ...orderPatch, status: input.status },
      vehicleId:    vehicleStatus ? order.vehicleId : null,
      vehicleStatus,
      historyEntry: historyEntry(order.status, input.status, user, input.note, changedAt),
    });
    const updated = await this.orderRepo.findById(id);
    await this.recordAudit(user, AUDIT_ACTIONS.STATUS_CHANGE, updated, { from: order.status, to: input.status });
    return updated;
  }

  async delete(id, user) {
    const existing = await this.getById(id);
    if (LOCKED_STATUSES.includes(existing.status)) {
      throw conflict('ORDER_LOCKED', `Orders that are ${existing.status} cannot be deleted`);
    }
    await this.orderRepo.deleteById(id);
    await this.recordAudit(user, AUDIT_ACTIONS.DELETE, existing);
  }

  // Checks BR3 preconditions; returns extra order columns and the new vehicle status (if any).
  async planTransition(order, input) {
    if (input.status === ORDER_STATUS.IN_TRANSIT) {
      const vehicle = order.vehicleId ? await this.vehicleRepo.findById(order.vehicleId) : null;
      if (!vehicle) throw validation([detail('vehicleId', 'Assign a vehicle before dispatching the order')]);
      if (vehicle.status !== VEHICLE_STATUS.AVAILABLE) {
        throw conflict('VEHICLE_UNAVAILABLE', `Vehicle ${vehicle.licensePlate} is not available`);
      }
      return { orderPatch: {}, vehicleStatus: VEHICLE_STATUS.ON_TRIP };
    }
    const release = order.vehicleId ? VEHICLE_STATUS.AVAILABLE : null;
    if (input.status === ORDER_STATUS.DELIVERED) {
      checkProofOfDelivery(input);
      const { podRecipientName, podSignature, podNote } = input;
      return { orderPatch: { podRecipientName, podSignature, podNote }, vehicleStatus: release };
    }
    // → cancelled: only an in-transit order holds its vehicle
    return { orderPatch: {}, vehicleStatus: order.status === ORDER_STATUS.IN_TRANSIT ? release : null };
  }

  // BR1. Warehouses unchanged since `existing` are not re-checked for existence/activity.
  async checkWarehouses(data, existing = {}) {
    const details = REQUIRED_WAREHOUSES[data.type]
      .filter((field) => !data[field])
      .map((field) => detail(field, `${field} is required for ${data.type} orders`));
    if (data.type === 'transfer' && data.originWarehouseId && data.originWarehouseId === data.destinationWarehouseId) {
      details.push(detail('destinationWarehouseId', 'Origin and destination warehouses must differ'));
    }
    for (const field of ['originWarehouseId', 'destinationWarehouseId']) {
      if (!data[field] || data[field] === existing[field]) continue;
      const warehouse = await this.warehouseRepo.findById(data[field]);
      if (!warehouse || !warehouse.isActive) details.push(detail(field, `${field} must reference an active warehouse`));
    }
    if (details.length) throw validation(details);
  }

  // BR2
  async checkVehicle(vehicleId) {
    if (!vehicleId) return;
    const vehicle = await this.vehicleRepo.findById(vehicleId);
    if (!vehicle) throw validation([detail('vehicleId', 'vehicleId must reference an existing vehicle')]);
    if (vehicle.status === VEHICLE_STATUS.MAINTENANCE) {
      throw validation([detail('vehicleId', 'Vehicles in maintenance cannot be assigned')]);
    }
  }

}

function historyEntry(fromStatus, toStatus, user, note, changedAt) {
  return { fromStatus, toStatus, changedAt, changedBy: user && user.username ? user.username : null, note: note || null };
}

function checkProofOfDelivery({ podRecipientName, podSignature }) {
  const details = [];
  if (!podRecipientName) details.push(detail('podRecipientName', 'podRecipientName is required for delivery'));
  if (podSignature && (!podSignature.startsWith(POD_PREFIX) || podSignature.length > MAX_SIGNATURE_LEN)) {
    details.push(detail('podSignature', `podSignature must be a PNG data URL (${POD_PREFIX}…) of at most 500 KB`));
  }
  if (details.length) throw validation(details);
}

OrderService.LIST_SPEC = LIST_SPEC;

module.exports = OrderService;
