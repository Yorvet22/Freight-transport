// Column whitelists. Only names listed here ever reach SQL.

const WAREHOUSE_COLUMNS = ['code', 'name', 'address', 'city', 'capacityPallets', 'managerName', 'phone', 'isActive', 'createdAt'];

const VEHICLE_COLUMNS = ['model', 'licensePlate', 'driverName', 'capacityKg', 'status'];

const ORDER_COLUMNS = [
  'type', 'clientName', 'pickupAddress', 'deliveryAddress', 'cargoDescription', 'cargoWeight', 'status',
  'vehicleId', 'originWarehouseId', 'destinationWarehouseId', 'plannedDeliveryDate',
  'pickupWindowStart', 'pickupWindowEnd', 'dockNumber',
  'podRecipientName', 'podSignature', 'podNote', 'createdAt', 'deliveredAt',
];

const HISTORY_COLUMNS = ['orderId', 'fromStatus', 'toStatus', 'changedAt', 'changedBy', 'note'];

const OPEN_ORDER_STATUSES = ['new', 'in_transit'];

const formatOrderNumber = (id) => `ORD-${String(id).padStart(6, '0')}`;

// Keeps only whitelisted keys that are present in `data`.
function pickColumns(data, columns) {
  const out = {};
  for (const col of columns) {
    if (data[col] !== undefined) out[col] = data[col];
  }
  return out;
}

module.exports = {
  WAREHOUSE_COLUMNS, VEHICLE_COLUMNS, ORDER_COLUMNS, HISTORY_COLUMNS, OPEN_ORDER_STATUSES, formatOrderNumber, pickColumns,
};
