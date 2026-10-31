const { AppError } = require('../errors');

const COLUMNS = 'id, username, passwordHash, role, createdAt';

class UserRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByUsername(username) {
    const [rows] = await this.pool.query(`SELECT ${COLUMNS} FROM users WHERE username = ?`, [username]);
    return rows[0] || null;
  }

  async findById(id) {
    const [rows] = await this.pool.query(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  async listAll() {
    const [rows] = await this.pool.query(`SELECT ${COLUMNS} FROM users ORDER BY id`);
    return rows;
  }

  async create({ username, passwordHash, role }) {
    try {
      const [result] = await this.pool.query(
        'INSERT INTO users (username, passwordHash, role, createdAt) VALUES (?, ?, ?, ?)',
        [username, passwordHash, role, new Date()],
      );
      return result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new AppError('DUPLICATE_USERNAME', 409, 'A user with this username already exists.');
      }
      throw err;
    }
  }

  async deleteById(id) {
    const [result] = await this.pool.query('DELETE FROM users WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = UserRepository;
