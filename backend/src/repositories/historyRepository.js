const { HISTORY_COLUMNS, pickColumns } = require('./columns');
const { insertSql } = require('./sqlUtils');

class HistoryRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async add(entry) {
    const { sql, params } = insertSql('order_status_history', { changedAt: new Date(), ...pickColumns(entry, HISTORY_COLUMNS) });
    const [result] = await this.pool.query(sql, params);
    return result.insertId;
  }

  async findByOrderId(orderId) {
    const [rows] = await this.pool.query(
      'SELECT * FROM order_status_history WHERE orderId = ? ORDER BY changedAt ASC, id ASC', [orderId],
    );
    return rows;
  }

  async listAll() {
    const [rows] = await this.pool.query('SELECT * FROM order_status_history ORDER BY changedAt ASC, id ASC');
    return rows;
  }
}

module.exports = HistoryRepository;
