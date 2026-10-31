// Runs `work(conn)` inside a transaction on a dedicated pool connection.
// Commits and resolves with work's result, or rolls back and rethrows. The connection is always released.
async function withTransaction(pool, work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { withTransaction };
