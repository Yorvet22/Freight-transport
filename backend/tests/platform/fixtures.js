// Small SQL fixture builders for platform integration tests (test database only).
const { hashPassword } = require('../../src/auth/password');

const utc = (y, m, d, h = 10, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min, 0));

async function insert(pool, table, row) {
  const cols = Object.keys(row);
  const [result] = await pool.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map(c => row[c]),
  );
  return result.insertId;
}

const PASSWORD_HASHES = new Map();
const hashFor = password => {
  if (!PASSWORD_HASHES.has(password)) PASSWORD_HASHES.set(password, hashPassword(password));
  return PASSWORD_HASHES.get(password);
};

// Demo-style users: admin/admin123, dispatcher/dispatcher123, viewer/viewer123.
async function insertUsers(pool, names = ['admin', 'dispatcher', 'viewer']) {
  const ids = {};
  for (const name of names) {
    ids[name] = await insert(pool, 'users', {
      username: name, passwordHash: hashFor(`${name}123`), role: name, createdAt: new Date(),
    });
  }
  return ids;
}

const insertWarehouse = (pool, extra = {}) => insert(pool, 'warehouses', {
  code: 'WH-01', name: 'Kyiv Hub', address: '1 Main St', city: 'Kyiv', isActive: true, createdAt: new Date(), ...extra,
});

const insertVehicle = (pool, extra = {}) => insert(pool, 'vehicles', {
  model: 'Volvo FH', licensePlate: 'AA1111AA', driverName: 'John Smith', status: 'available', ...extra,
});

async function insertOrder(pool, extra = {}) {
  const id = await insert(pool, 'orders', {
    type: 'outbound', clientName: 'Northwind', pickupAddress: 'A', deliveryAddress: 'B', cargoDescription: 'Boxes',
    cargoWeight: 100, status: 'new', createdAt: utc(2026, 10, 30), ...extra,
  });
  await pool.query("UPDATE orders SET orderNumber = CONCAT('ORD-', LPAD(id, 6, '0')) WHERE id = ?", [id]);
  return id;
}

const insertHistory = (pool, extra) => insert(pool, 'order_status_history', { changedBy: 'admin', ...extra });

module.exports = { utc, insert, insertUsers, insertWarehouse, insertVehicle, insertOrder, insertHistory };
