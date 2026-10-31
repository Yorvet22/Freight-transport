const { AppError }                     = require('../../src/errors');
const { parseId, validateBody }        = require('../../src/domain/validation');
const { parseListQuery }               = require('../../src/domain/listQuery');
const { canTransition, ORDER_STATUSES } = require('../../src/domain/enums');

function catchError(fn) {
  try { fn(); } catch (err) { return err; }
  throw new Error('expected function to throw');
}

describe('enums', () => {
  it('lists the four order statuses', () => {
    expect(ORDER_STATUSES).toEqual(['new', 'in_transit', 'delivered', 'cancelled']);
  });

  it.each([
    ['new', 'in_transit', true], ['new', 'cancelled', true],
    ['in_transit', 'delivered', true], ['in_transit', 'cancelled', true],
    ['new', 'delivered', false], ['delivered', 'cancelled', false],
    ['cancelled', 'new', false], ['in_transit', 'new', false],
  ])('canTransition(%s → %s) = %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});

describe('parseId()', () => {
  it.each(['1', '42', 7])('accepts %p', (raw) => {
    expect(parseId(raw)).toBe(Number(raw));
  });

  it.each(['0', '-1', 'abc', '1.5', '', '01', '1e3', '99999999999', undefined])('rejects %p with 400 INVALID_ID', (raw) => {
    const err = catchError(() => parseId(raw));
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_ID');
  });
});

describe('validateBody()', () => {
  const schema = {
    name:   { type: 'string', required: true, max: 5 },
    note:   { type: 'string', max: 10 },
    count:  { type: 'int', min: 0 },
    weight: { type: 'number', gt: 0, max: 100 },
    kind:   { type: 'enum', values: ['a', 'b'], required: true },
    day:    { type: 'date' },
    at:     { type: 'datetime' },
    flag:   { type: 'boolean' },
  };

  it('returns trimmed, coerced values and nulls for missing optional fields', () => {
    const value = validateBody({ name: '  abc ', kind: 'a', count: '3', weight: 1.5, day: '2026-01-31',
      at: '2026-01-31T10:00:00Z', flag: false }, schema);
    expect(value).toEqual({ name: 'abc', note: null, count: 3, weight: 1.5, kind: 'a', day: '2026-01-31',
      at: new Date('2026-01-31T10:00:00Z'), flag: false });
  });

  it('collects one detail per invalid field', () => {
    const err = catchError(() => validateBody({ name: '   ', note: 'x'.repeat(11), count: -1, weight: 0,
      kind: 'z', day: '2026-02-30', at: 'yesterday', flag: 'yes' }, schema));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
    expect(err.details.map((d) => d.field).sort())
      .toEqual(['at', 'count', 'day', 'flag', 'kind', 'name', 'note', 'weight']);
    err.details.forEach((d) => expect(typeof d.message).toBe('string'));
  });

  it('rejects weight above the maximum and non-numeric strings', () => {
    expect(catchError(() => validateBody({ name: 'a', kind: 'a', weight: 101 }, schema)).details[0].field).toBe('weight');
    expect(catchError(() => validateBody({ name: 'a', kind: 'a', weight: 'abc' }, schema)).details[0].field).toBe('weight');
  });

  it('rejects a non-object body', () => {
    expect(catchError(() => validateBody(null, schema)).code).toBe('VALIDATION_ERROR');
    expect(catchError(() => validateBody([1], schema)).code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-string values for string fields', () => {
    const err = catchError(() => validateBody({ name: 123, kind: 'a' }, schema));
    expect(err.details[0].field).toBe('name');
  });
});

describe('parseListQuery()', () => {
  const spec = {
    sorts: ['createdAt', 'clientName'], defaultSort: 'createdAt', defaultDir: 'desc',
    filters: { status: { type: 'enum', values: ['new', 'delivered'] }, vehicleId: { type: 'int' },
      active: { type: 'boolean' }, from: { type: 'date' } },
  };

  it('applies defaults', () => {
    expect(parseListQuery({}, spec)).toEqual({ page: 1, limit: 20, sort: 'createdAt', dir: 'desc', q: null,
      status: null, vehicleId: null, active: null, from: null });
  });

  it('parses valid values and ignores unknown params', () => {
    const q = parseListQuery({ page: '2', limit: '500', sort: 'clientName', dir: 'asc', q: ' acme ',
      status: 'new', vehicleId: '3', active: 'false', from: '2026-01-01', _: '123' }, spec);
    expect(q).toEqual({ page: 2, limit: 500, sort: 'clientName', dir: 'asc', q: 'acme',
      status: 'new', vehicleId: 3, active: false, from: '2026-01-01' });
  });

  it.each([
    { page: '0' }, { page: 'x' }, { limit: '501' }, { limit: '0' }, { sort: 'password' },
    { dir: 'up' }, { status: 'lost' }, { vehicleId: '-2' }, { active: 'maybe' }, { from: '2026-13-01' },
    { status: ['new', 'delivered'] }, { q: 'x'.repeat(101) },
  ])('rejects %p with 400 INVALID_QUERY', (raw) => {
    const err = catchError(() => parseListQuery(raw, spec));
    expect(err.code).toBe('INVALID_QUERY');
    expect(err.status).toBe(400);
  });
});
