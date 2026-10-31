// audit_log table (SPEC §11). Rows outlive users and entities on purpose (no FKs).
const COLUMNS = 'id, userId, username, action, entity, entityId, details, createdAt';

function parseDetails(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value; // mysql2 already parses JSON columns
  try { return JSON.parse(value); } catch { return value; }
}

const toEntry = row => ({ ...row, details: parseDetails(row.details) });

class AuditRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // `db` may be a transaction connection so the audit row commits/rolls back with the change.
  async add({ userId = null, username, action, entity, entityId, details = null, createdAt = new Date() }, db = this.pool) {
    const [result] = await db.query(
      `INSERT INTO audit_log (userId, username, action, entity, entityId, details, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, username, action, entity, entityId, details === null ? null : JSON.stringify(details), createdAt],
    );
    return result.insertId;
  }

  // filters: { entity?, entityId? }; newest first.
  async list({ entity, entityId, offset = 0, limit = 20 } = {}) {
    const where = [];
    const params = [];
    if (entity)   { where.push('entity = ?');   params.push(entity); }
    if (entityId) { where.push('entityId = ?'); params.push(entityId); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[{ total }]] = await this.pool.query(`SELECT COUNT(*) AS total FROM audit_log ${clause}`, params);
    const [rows] = await this.pool.query(
      `SELECT ${COLUMNS} FROM audit_log ${clause} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows.map(toEntry), total: Number(total) };
  }
}

module.exports = AuditRepository;
