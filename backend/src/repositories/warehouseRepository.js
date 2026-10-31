const { WAREHOUSE_COLUMNS, OPEN_ORDER_STATUSES, pickColumns } = require('./columns');
const { escapeLike, insertSql, updateSql, orderBySql, limitSql, whereSql } = require('./sqlUtils');

const SORT_MAP = { code: 'code', name: 'name', city: 'city' };
const DEFAULT_SORT = { sort: 'code', dir: 'asc' };

const toWarehouse = (row) => (row ? { ...row, isActive: Boolean(row.isActive) } : null);

class WarehouseRepository {
  constructor(pool) {
    this.pool = pool;
  }

  _where({ active, q } = {}) {
    const clauses = [];
    const params  = [];
    if (active != null) { clauses.push('isActive = ?'); params.push(active); }
    if (q) {
      clauses.push('(code LIKE ? OR name LIKE ? OR city LIKE ? OR address LIKE ?)');
      params.push(...Array(4).fill(escapeLike(q)));
    }
    return { sql: whereSql(clauses), params };
  }

  async list(query = {}) {
    const where = this._where(query);
    const limit = limitSql(query);
    const [rows] = await this.pool.query(
      `SELECT * FROM warehouses ${where.sql} ${orderBySql(SORT_MAP, query.sort, query.dir, DEFAULT_SORT)} ${limit.sql}`,
      [...where.params, ...limit.params],
    );
    const [[{ total }]] = await this.pool.query(`SELECT COUNT(*) AS total FROM warehouses ${where.sql}`, where.params);
    return { items: rows.map(toWarehouse), total: Number(total) };
  }

  async listAll() {
    const [rows] = await this.pool.query('SELECT * FROM warehouses ORDER BY code ASC, id ASC');
    return rows.map(toWarehouse);
  }

  async findById(id) {
    const [rows] = await this.pool.query('SELECT * FROM warehouses WHERE id = ?', [id]);
    return toWarehouse(rows[0]);
  }

  async findByCode(code) {
    const [rows] = await this.pool.query('SELECT * FROM warehouses WHERE code = ?', [code]);
    return toWarehouse(rows[0]);
  }

  async create(data) {
    const { sql, params } = insertSql('warehouses', { createdAt: new Date(), ...pickColumns(data, WAREHOUSE_COLUMNS) });
    const [result] = await this.pool.query(sql, params);
    return result.insertId;
  }

  async update(id, data) {
    const stmt = updateSql('warehouses', id, pickColumns(data, WAREHOUSE_COLUMNS));
    if (stmt) await this.pool.query(stmt.sql, stmt.params);
  }

  // → true when a row was deleted (orders referencing it get NULL via ON DELETE SET NULL).
  async deleteById(id) {
    const [result] = await this.pool.query('DELETE FROM warehouses WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async countOpenOrders(id) {
    const [[{ n }]] = await this.pool.query(
      'SELECT COUNT(*) AS n FROM orders WHERE status IN (?) AND (originWarehouseId = ? OR destinationWarehouseId = ?)',
      [OPEN_ORDER_STATUSES, id, id],
    );
    return Number(n);
  }
}

module.exports = WarehouseRepository;
