const VehicleService = require('../../src/services/vehicleService');
const { fakeRepos, fakeAudit, rejection } = require('./fakes');

const USER = { id: 2, username: 'dispatcher', role: 'dispatcher' };
const payload = (o = {}) => ({ model: 'Volvo FH 500', licensePlate: 'AA1234BB', driverName: 'John Smith', capacityKg: 20000, ...o });

describe('VehicleService', () => {
  let repos;
  let audit;
  let service;
  beforeEach(() => {
    repos   = fakeRepos();
    audit   = fakeAudit();
    service = new VehicleService(repos, { audit });
  });

  it('creates a vehicle with status available by default, trims fields and audits it', async () => {
    const v = await service.create(payload({ model: '  Scania R  ' }), USER);
    expect(v).toMatchObject({ id: 1, model: 'Scania R', status: 'available', capacityKg: 20000 });
    expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'create', entity: 'vehicle', entityId: 1,
      details: { licensePlate: 'AA1234BB' } });
  });

  it('allows maintenance on create but never on_trip', async () => {
    expect((await service.create(payload({ status: 'maintenance' }), USER)).status).toBe('maintenance');
    expect((await rejection(service.create(payload({ licensePlate: 'X2', status: 'on_trip' }), USER))).code).toBe('VALIDATION_ERROR');
  });

  it('validates required fields and lengths', async () => {
    const err = await rejection(service.create({ licensePlate: 'x'.repeat(21), capacityKg: -5 }, USER));
    expect(err.details.map((d) => d.field).sort()).toEqual(['capacityKg', 'driverName', 'licensePlate', 'model']);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects duplicate plates (case-insensitive) on create and update', async () => {
    await service.create(payload(), USER);
    const other = await service.create(payload({ licensePlate: 'BB0000CC' }), USER);
    expect((await rejection(service.create(payload({ licensePlate: 'aa1234bb' }), USER))).code).toBe('DUPLICATE_PLATE');
    expect((await rejection(service.update(other.id, payload(), USER))).code).toBe('DUPLICATE_PLATE');
    expect((await service.update(other.id, payload({ licensePlate: 'BB0000CC', model: 'MAN' }), USER)).model).toBe('MAN');
  });

  it('audits updates', async () => {
    const v = await service.create(payload(), USER);
    audit.record.mockClear();
    await service.update(v.id, payload({ driverName: 'Ann Lee' }), USER);
    expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'update', entity: 'vehicle', entityId: v.id,
      details: { licensePlate: 'AA1234BB' } });
  });

  it('BR5: on_trip vehicles cannot change status or be deleted', async () => {
    const v = await service.create(payload(), USER);
    repos.vehicleRepo.rows[v.id].status = 'on_trip';
    expect((await rejection(service.update(v.id, payload({ status: 'available' }), USER))).code).toBe('VEHICLE_IN_USE');
    expect((await rejection(service.delete(v.id, USER))).code).toBe('VEHICLE_IN_USE');
    const renamed = await service.update(v.id, payload({ driverName: 'New Driver' }), USER);
    expect(renamed).toMatchObject({ driverName: 'New Driver', status: 'on_trip' });
  });

  it('manual status via PUT may only be available or maintenance', async () => {
    const v = await service.create(payload(), USER);
    expect((await service.update(v.id, payload({ status: 'maintenance' }), USER)).status).toBe('maintenance');
    expect((await rejection(service.update(v.id, payload({ status: 'on_trip' }), USER))).code).toBe('VALIDATION_ERROR');
    expect((await service.update(v.id, payload(), USER)).status).toBe('maintenance');
  });

  it('getById / update / delete throw NOT_FOUND for unknown ids', async () => {
    expect((await rejection(service.getById(9))).code).toBe('NOT_FOUND');
    expect((await rejection(service.update(9, payload(), USER))).code).toBe('NOT_FOUND');
    expect((await rejection(service.delete(9, USER))).code).toBe('NOT_FOUND');
  });

  it('deletes available vehicles and audits it', async () => {
    const v = await service.create(payload(), USER);
    audit.record.mockClear();
    await service.delete(v.id, USER);
    expect(repos.vehicleRepo.deleteById).toHaveBeenCalledWith(v.id);
    expect(audit.record).toHaveBeenCalledWith({ user: USER, action: 'delete', entity: 'vehicle', entityId: v.id,
      details: { licensePlate: 'AA1234BB' } });
  });

  it('lists with the parsed query and validates it', async () => {
    expect(await service.list({ status: 'maintenance' })).toMatchObject({ total: 0, page: 1, limit: 20 });
    expect(repos.vehicleRepo.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'maintenance',
      sort: 'licensePlate', dir: 'asc' }));
    expect((await rejection(service.list({ sort: 'capacityKg' }))).code).toBe('INVALID_QUERY');
  });
});
