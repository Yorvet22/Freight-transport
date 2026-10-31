// Helpers that build SQL only from whitelisted identifiers; all values travel as `?` parameters.
const { withTransaction } = require('../db/transaction');

const DEFAULT_LIMIT = 20;

// LIKE pattern for "contains q"; `\`, `%` and `_` in q match literally (backslash is MySQL's default LIKE escape).
const escapeLike = (q) => `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;

function insertSql(table, data) {
  const cols = Object.keys(data);
  return {
    sql:    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    params: cols.map((c) => data[c]),
  };
}

function updateSql(table, id, data) {
  const cols = Object.keys(data);
  if (!cols.length) return null;
  return {
    sql:    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    params: [...cols.map((c) => data[c]), id],
  };
}

// `sortMap` maps API sort names to SQL expressions; unknown names fall back to `fallback.sort`,
// anything but 'asc'/'desc' to `fallback.dir`. The id tie-breaker keeps pagination stable.
function orderBySql(sortMap, sort, dir, fallback, idColumn = 'id') {
  const column    = sortMap[sort] || sortMap[fallback.sort];
  const direction = (dir === 'asc' || dir === 'desc' ? dir : fallback.dir).toUpperCase();
  return `ORDER BY ${column} ${direction}, ${idColumn} ${direction}`;
}

function limitSql({ page, limit } = {}) {
  const size = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  const num  = Number.isInteger(page) && page > 0 ? page : 1;
  return { sql: 'LIMIT ? OFFSET ?', params: [size, (num - 1) * size] };
}

const whereSql = (clauses) => (clauses.length ? `WHERE ${clauses.join(' AND ')}` : '');

const dayStart = (date) => new Date(`${date}T00:00:00Z`);
const nextDay  = (date) => new Date(dayStart(date).getTime() + 24 * 60 * 60 * 1000);

module.exports = { withTransaction, escapeLike, insertSql, updateSql, orderBySql, limitSql, whereSql, dayStart, nextDay };
