// Shared fixtures for repository integration tests (DB_NAME_TEST only).
const { getTestPool }        = require('../../helpers/db');
const { createRepositories } = require('../../../src/repositories');

const repos = () => createRepositories(getTestPool());

const warehouse = (overrides = {}) => ({
  code: 'WH-01', name: 'Kyiv Central Hub', address: '1 Industrial Ave', city: 'Kyiv',
  capacityPallets: 1000, managerName: 'Anna Green', phone: '+380 44 000 0001', isActive: true, ...overrides,
});

const vehicle = (overrides = {}) => ({
  model: 'Volvo FH 500', licensePlate: 'AA 1001 AA', driverName: 'John Smith', capacityKg: 20000, status: 'available', ...overrides,
});

const order = (overrides = {}) => ({
  type: 'outbound', clientName: 'Northwind Traders', pickupAddress: '1 Industrial Ave, Kyiv',
  deliveryAddress: '5 Market St, Lviv', cargoDescription: 'Office furniture', cargoWeight: 1250.5,
  status: 'new', createdAt: new Date('2026-10-01T08:00:00Z'), ...overrides,
});

const created = (toStatus = 'new', overrides = {}) => ({
  fromStatus: null, toStatus, changedBy: 'admin', note: null, changedAt: new Date('2026-10-01T08:00:00Z'), ...overrides,
});

module.exports = { repos, warehouse, vehicle, order, created };
