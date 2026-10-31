const { ORDER_COLUMNS, HISTORY_COLUMNS, formatOrderNumber, pickColumns } = require('./columns');
const { withTransaction, escapeLike, insertSql, updateSql, orderBySql, limitSql, whereSql, dayStart, nextDay } = require('./sqlUtils');

// List shape: every column except the (large) podSignature, plus joined read-only fields.
const LIST_COLUMNS = ['id', 'orderNumber', ...ORDER_COLUMNS.filter((c) => c !== 'podSignature')]
  .map((c) => `o.${c}`).join(', ');

const JOINED_COLUMNS = `v.licensePlate AS truckPlate, v.driverName AS driverName,
  ow.name AS originWarehouseName, dw.name AS destinationWarehouseName`;

const FROM_JOINED = `FROM orders o
  LEFT JOIN vehicles v    ON v.id  = o.vehicleId
  LEFT JOIN warehouses ow ON ow.id = o.originWarehouseId
  LEFT JOIN warehouses dw ON dw.id = o.destinationWarehouseId`;

const SORT_MAP = {
  createdAt: 'o.createdAt', orderNumber: 'o.orderNumber', clientName: 'o.clientName', cargoWeight: 'o.cargoWeight',
  status: 'o.status', plannedDeliveryDate: 'o.plannedDeliveryDate', pickupWindowStart: 'o.pickupWindowStart',
};
const DEFAULT_SORT = { sort: 'createdAt', dir: 'desc' };

const WAREHOUSE_DIRECTION = {
  inbound:  'o.destinationWarehouseId = ?',
  outbound: 'o.originWarehouseId = ?',
  any:      '(o.originWarehouseId = ? OR o.destinationWarehouseId = ?)',
};

// Filters supported by list() and listAll(). `usesVehicle` tells whether the vehicles join is needed.
function orderWhere(f = {}) {
  const clauses = [];
  const params  = [];
  const add = (clause, ...values) => { clauses.push(clause); params.push(...values); };

  if (f.status) add('o.status = ?', f.status);
  if (f.type) add('o.type = ?', f.type);
  if (f.vehicleId) add('o.vehicleId = ?', f.vehicleId);
  if (f.warehouseId) {
    const clause = WAREHOUSE_DIRECTION[f.direction] || WAREHOUSE_DIRECTION.any;
    add(clause, ...Array((clause.match(/\?/g) || []).length).fill(f.warehouseId));
  }
  if (f.originWarehouseId) add('o.originWarehouseId = ?', f.originWarehouseId);
  if (f.destinationWarehouseId) add('o.destinationWarehouseId = ?', f.destinationWarehouseId);
  if (f.from) add('o.createdAt >= ?', dayStart(f.from));
  if (f.to) add('o.createdAt < ?', nextDay(f.to));
  if (f.pickupDate) add('o.pickupWindowStart >= ? AND o.pickupWindowStart < ?', dayStart(f.pickupDate), nextDay(f.pickupDate));
  if (f.plannedDeliveryDate) add('o.plannedDeliveryDate = ?', f.plannedDeliveryDate);
  if (f.q) {
    add('(o.orderNumber LIKE ? OR o.clientName LIKE ? OR o.cargoDescription LIKE ? OR v.licensePlate LIKE ? OR v.driverName LIKE ?)',
      ...Array(5).fill(escapeLike(f.q)));
  }
  return { sql: whereSql(clauses), params, usesVehicle: Boolean(f.q) };
}

function insertHistory(conn, orderId, entry) {
  const { sql, params } = insertSql('order_status_history',
    { changedAt: new Date(), ...pickColumns({ ...entry, orderId }, HISTORY_COLUMNS) });
  return conn.query(sql, params);
}

class OrderRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // query: { page, limit, sort, dir, ...filters } → { items, total }
  async list(query = {}) {
    const where = orderWhere(query);
    const limit = limitSql(query);
    const [rows] = await this.pool.query(
      `SELECT ${LIST_COLUMNS}, ${JOINED_COLUMNS} ${FROM_JOINED} ${where.sql}
       ${orderBySql(SORT_MAP, query.sort, query.dir, DEFAULT_SORT, 'o.id')} ${limit.sql}`,
      [...where.params, ...limit.params],
    );
    const join = where.usesVehicle ? 'LEFT JOIN vehicles v ON v.id = o.vehicleId' : '';
    const [[{ total }]] = await this.pool.query(`SELECT COUNT(*) AS total FROM orders o ${join} ${where.sql}`, where.params);
    return { items: rows, total: Number(total) };
  }

  // Unpaginated list (reports, schedules); same filters and sort options as list().
  async listAll(filters = {}) {
    const where = orderWhere(filters);
    const [rows] = await this.pool.query(
      `SELECT ${LIST_COLUMNS}, ${JOINED_COLUMNS} ${FROM_JOINED} ${where.sql}
       ${orderBySql(SORT_MAP, filters.sort, filters.dir, DEFAULT_SORT, 'o.id')}`,
      where.params,
    );
    return rows;
  }

  // Full order including podSignature, or null.
  async findById(id) {
    const [rows] = await this.pool.query(
      `SELECT ${LIST_COLUMNS}, o.podSignature, ${JOINED_COLUMNS} ${FROM_JOINED} WHERE o.id = ?`, [id]);
    return rows[0] || null;
  }

  // orderNumber is derived from the auto-increment id; order, number and the optional
  // initial history row are written in one transaction (race-free, all-or-nothing). → id
  async create(data, historyEntry = null) {
    return withTransaction(this.pool, async (conn) => {
      const { sql, params } = insertSql('orders', { createdAt: new Date(), ...pickColumns(data, ORDER_COLUMNS) });
      const [result] = await conn.query(sql, params);
      const id = result.insertId;
      await conn.query('UPDATE orders SET orderNumber = ? WHERE id = ?', [formatOrderNumber(id), id]);
      if (historyEntry) await insertHistory(conn, id, historyEntry);
      return id;
    });
  }

  // BR3: order patch + optional vehicle status + history row, all-or-nothing.
  async applyStatusChange({ orderId, orderPatch = {}, vehicleId = null, vehicleStatus = null, historyEntry }) {
    await withTransaction(this.pool, async (conn) => {
      const order = updateSql('orders', orderId, pickColumns(orderPatch, ORDER_COLUMNS));
      if (order) await conn.query(order.sql, order.params);
      if (vehicleId && vehicleStatus) {
        await conn.query('UPDATE vehicles SET status = ? WHERE id = ?', [vehicleStatus, vehicleId]);
      }
      await insertHistory(conn, orderId, historyEntry);
    });
  }

  async update(id, data) {
    const stmt = updateSql('orders', id, pickColumns(data, ORDER_COLUMNS));
    if (stmt) await this.pool.query(stmt.sql, stmt.params);
  }

  // → true when a row was deleted (history rows cascade).
  async deleteById(id) {
    const [result] = await this.pool.query('DELETE FROM orders WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = OrderRepository;
