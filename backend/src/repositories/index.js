// Domain repository factory (SPEC §7). MySQL is the only storage engine.
const OrderRepository     = require('./orderRepository');
const VehicleRepository   = require('./vehicleRepository');
const WarehouseRepository = require('./warehouseRepository');
const HistoryRepository   = require('./historyRepository');

function createRepositories(pool) {
  if (!pool) throw new Error('createRepositories: a MySQL pool is required');
  return {
    orderRepo:     new OrderRepository(pool),
    vehicleRepo:   new VehicleRepository(pool),
    warehouseRepo: new WarehouseRepository(pool),
    historyRepo:   new HistoryRepository(pool),
  };
}

module.exports = { createRepositories };
