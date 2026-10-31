// Inserts the demo data set (demoData.js) into MySQL with plain SQL, inside one transaction.
const { withTransaction }           = require('../db/transaction');
const { hashPassword }              = require('../auth/password');
const { buildDemoData, DEMO_USERS } = require('./demoData');

const USER_COLUMNS      = ['username', 'passwordHash', 'role', 'createdAt'];
const WAREHOUSE_COLUMNS = ['code', 'name', 'address', 'city', 'capacityPallets', 'managerName', 'phone', 'isActive', 'createdAt'];
const VEHICLE_COLUMNS   = ['model', 'licensePlate', 'driverName', 'capacityKg', 'status'];
const ORDER_COLUMNS     = ['type', 'clientName', 'pickupAddress', 'deliveryAddress', 'cargoDescription', 'cargoWeight',
  'status', 'vehicleId', 'originWarehouseId', 'destinationWarehouseId', 'plannedDeliveryDate', 'pickupWindowStart',
  'pickupWindowEnd', 'dockNumber', 'podRecipientName', 'podSignature', 'podNote', 'createdAt', 'deliveredAt'];
const HISTORY_COLUMNS   = ['orderId', 'fromStatus', 'toStatus', 'changedAt', 'changedBy', 'note'];
const DATA_TABLES       = ['users', 'warehouses', 'vehicles', 'orders'];

async function insert(conn, table, columns, row) {
  const [result] = await conn.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((c) => (row[c] === undefined ? null : row[c])));
  return result.insertId;
}

const idAt = (ids, index) => (index == null ? null : ids[index]);

// Resolves with the inserted row counts { users, warehouses, vehicles, orders, history }.
async function seedDemoSql(pool, { now = new Date() } = {}) {
  const data = buildDemoData(now);
  return withTransaction(pool, async (conn) => {
    for (const u of DEMO_USERS) {
      await insert(conn, 'users', USER_COLUMNS,
        { username: u.username, passwordHash: hashPassword(u.password), role: u.role, createdAt: now });
    }
    const warehouseIds = [];
    for (const w of data.warehouses) warehouseIds.push(await insert(conn, 'warehouses', WAREHOUSE_COLUMNS, w));
    const vehicleIds = [];
    for (const v of data.vehicles) vehicleIds.push(await insert(conn, 'vehicles', VEHICLE_COLUMNS, v));

    let history = 0;
    for (const { vehicleIndex, originIndex, destinationIndex, history: entries, ...order } of data.orders) {
      const orderId = await insert(conn, 'orders', ORDER_COLUMNS, {
        ...order,
        vehicleId:              idAt(vehicleIds, vehicleIndex),
        originWarehouseId:      idAt(warehouseIds, originIndex),
        destinationWarehouseId: idAt(warehouseIds, destinationIndex),
      });
      await conn.query("UPDATE orders SET orderNumber = CONCAT('ORD-', LPAD(id, 6, '0')) WHERE id = ?", [orderId]);
      for (const entry of entries) await insert(conn, 'order_status_history', HISTORY_COLUMNS, { ...entry, orderId });
      history += entries.length;
    }
    return { users: DEMO_USERS.length, warehouses: warehouseIds.length, vehicles: vehicleIds.length,
      orders: data.orders.length, history };
  });
}

// True when any core table already holds rows.
async function hasData(pool) {
  for (const table of DATA_TABLES) {
    const [rows] = await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
    if (rows.length) return true;
  }
  return false;
}

module.exports = { seedDemoSql, hasData };
