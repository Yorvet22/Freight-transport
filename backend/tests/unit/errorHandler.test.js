const errorHandler = require('../../src/middleware/errorHandler');
const { createErrorHandler } = require('../../src/middleware/errorHandler');
const { AppError, notFound, conflict, tooManyRequests } = require('../../src/errors');

function run(err, handler = errorHandler) {
  const res = { statusCode: null, body: null, headersSent: false };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json   = jest.fn((body) => { res.body = body; return res; });
  handler(err, {}, res, jest.fn());
  return res;
}

describe('errorHandler', () => {
  let spy;
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => spy.mockRestore());

  it('maps any AppError to its status and body without logging', () => {
    const details = [{ field: 'x', message: 'bad' }];
    const res = run(new AppError('VALIDATION_ERROR', 400, 'Validation failed', details));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'VALIDATION_ERROR', message: 'Validation failed', details });
    expect(run(notFound('Order')).body).toEqual({ error: 'NOT_FOUND', message: 'Order not found' });
    expect(run(conflict('ORDER_LOCKED', 'Locked')).statusCode).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps 429 TOO_MANY_REQUESTS', () => {
    const res = run(tooManyRequests());
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'TOO_MANY_REQUESTS', message: expect.any(String) });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps an unknown-key duplicate to 409 CONFLICT', () => {
    const sqlMessage = "Duplicate entry 'x' for key 'orders.uq_orders_orderNumber'";
    const res = run(Object.assign(new Error(sqlMessage), { code: 'ER_DUP_ENTRY', sqlMessage }));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('CONFLICT');
  });

  it('createErrorHandler logs unexpected errors to the injected logger', () => {
    const logger = { error: jest.fn() };
    const res = run(new Error('boom'), createErrorHandler(logger));
    expect(res.statusCode).toBe(500);
    expect(logger.error).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps malformed JSON to 400 INVALID_JSON', () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 });
    const res = run(err);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('INVALID_JSON');
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps a too-large body to 400 VALIDATION_ERROR', () => {
    const res = run(Object.assign(new Error('too large'), { type: 'entity.too.large', status: 413 }));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it.each([
    ["Duplicate entry 'AA1' for key 'vehicles.uq_vehicles_licensePlate'", 'DUPLICATE_PLATE'],
    ["Duplicate entry 'WH-01' for key 'warehouses.uq_warehouses_code'", 'DUPLICATE_CODE'],
    ["Duplicate entry 'bob' for key 'users.uq_users_username'", 'DUPLICATE_USERNAME'],
  ])('maps ER_DUP_ENTRY %s to 409 %s', (sqlMessage, code) => {
    const res = run(Object.assign(new Error(sqlMessage), { code: 'ER_DUP_ENTRY', sqlMessage }));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe(code);
  });

  it('maps a foreign key violation to 400 VALIDATION_ERROR', () => {
    const res = run(Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2' }));
    expect(res.statusCode).toBe(400);
  });

  it('hides unexpected errors behind 500 and logs them', () => {
    const res = run(new Error('boom'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
    expect(spy).toHaveBeenCalled();
  });

  it('delegates to next() when headers were already sent', () => {
    const next = jest.fn();
    const err  = new Error('late');
    errorHandler(err, {}, { headersSent: true }, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
