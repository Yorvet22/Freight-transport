const { VEHICLE_COLUMNS, pickColumns } = require('./columns');
const { escapeLike, insertSql, updateSql, orderBySql, limitSql, whereSql } = require('./sqlUtils');

const SORT_MAP = { licensePlate: 'licensePlate', model: 'model', driverName: 'driverName', status: 'status' };
const DEFAULT_SORT = { sort: 'licensePlate', dir: 'asc' };

class VehicleRepository {
  constructor(pool) {
    this.pool = pool;
  }

  _where({ status, q } = {}) {
    const clauses = [];
    const params  = [];
    if (status) { clauses.push('status = ?'); params.push(status); }
    if (q) {
      clauses.push('(model LIKE ? OR licensePlate LIKE ? OR driverName LIKE ?)');
      params.push(...Array(3).fill(escapeLike(q)));
    }
    return { sql: whereSql(clauses), params };
  }

  async list(query = {}) {
    const where = this._where(query);
    const limit = limitSql(query);
    const [rows] = await this.pool.query(
      `SELECT * FROM vehicles ${where.sql} ${orderBySql(SORT_MAP, query.sort, query.dir, DEFAULT_SORT)} ${limit.sql}`,
      [...where.params, ...limit.params],
    );
    const [[{ total }]] = await this.pool.query(`SELECT COUNT(*) AS total FROM vehicles ${where.sql}`, where.params);
    return { items: rows, total: Number(total) };
  }

  async listAll() {
    const [rows] = await this.pool.query('SELECT * FROM vehicles ORDER BY licensePlate ASC, id ASC');
    return rows;
  }

  async findById(id) {
    const [rows] = await this.pool.query('SELECT * FROM vehicles WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async findByPlate(plate) {
    const [rows] = await this.pool.query('SELECT * FROM vehicles WHERE licensePlate = ?', [plate]);
    return rows[0] || null;
  }

  async create(data) {
    const { sql, params } = insertSql('vehicles', pickColumns(data, VEHICLE_COLUMNS));
    const [result] = await this.pool.query(sql, params);
    return result.insertId;
  }

  async update(id, data) {
    const stmt = updateSql('vehicles', id, pickColumns(data, VEHICLE_COLUMNS));
    if (stmt) await this.pool.query(stmt.sql, stmt.params);
  }

  // → true when a row was deleted (orders referencing it get NULL via ON DELETE SET NULL).
  async deleteById(id) {
    const [result] = await this.pool.query('DELETE FROM vehicles WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = VehicleRepository;
