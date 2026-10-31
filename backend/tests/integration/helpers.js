// Domain API integration helpers: apps run against the test database (DB_NAME_TEST) via tests/helpers/db.js.
const request = require('supertest');
const { createApp } = require('../../src/app');
const { getTestPool, resetDatabase, seedDemo, closeTestPool } = require('../helpers/db');

const silentLogger = { log() {}, info() {}, warn() {}, error() {} };

// Auth-disabled app (acts as admin "system") on the shared test pool.
const testApp = (options = {}) => createApp({ pool: getTestPool(), authDisabled: true, logger: silentLogger, ...options });

const warehousePayload = (o = {}) => ({ code: 'WH-01', name: 'Kyiv Central Hub', address: '14 Industrialna St',
  city: 'Kyiv', capacityPallets: 2400, ...o });

const vehiclePayload = (o = {}) => ({ model: 'Volvo FH 500', licensePlate: 'AA1234BB', driverName: 'John Smith',
  capacityKg: 20000, ...o });

const orderPayload = (o = {}) => ({ type: 'outbound', clientName: 'Northwind Traders', pickupAddress: '14 Industrialna St, Kyiv',
  deliveryAddress: '18 Sumska St, Kharkiv', cargoDescription: 'Office furniture', cargoWeight: 1500, ...o });

async function create(app, path, body) {
  const res = await request(app).post(path).send(body);
  if (res.status !== 201) throw new Error(`POST ${path} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

module.exports = { request, testApp, create, warehousePayload, vehiclePayload, orderPayload, silentLogger,
  getTestPool, resetDatabase, seedDemo, closeTestPool };
