const { resetDatabase, closeTestPool } = require('../../helpers/db');
const { repos, vehicle } = require('./fixtures');

describe('VehicleRepository (MySQL)', () => {
  let vehicleRepo;
  beforeAll(() => { ({ vehicleRepo } = repos()); });
  beforeEach(() => resetDatabase());
  afterAll(() => closeTestPool());

  it('creates, finds, updates and deletes', async () => {
    const id = await vehicleRepo.create(vehicle({ id: 77, bogus: 'x' }));
    expect(id).not.toBe(77);
    expect(await vehicleRepo.findById(id)).toEqual({
      id, model: 'Volvo FH 500', licensePlate: 'AA 1001 AA', driverName: 'John Smith', capacityKg: 20000, status: 'available',
    });
    await vehicleRepo.update(id, { status: 'maintenance', driverName: 'Jane Doe', unknown: 1 });
    expect(await vehicleRepo.findById(id)).toMatchObject({ status: 'maintenance', driverName: 'Jane Doe' });
    await vehicleRepo.update(id, {});
    expect(await vehicleRepo.deleteById(id)).toBe(true);
    expect(await vehicleRepo.findById(id)).toBeNull();
    expect(await vehicleRepo.deleteById(id)).toBe(false);
  });

  it('defaults status to available and capacityKg to null', async () => {
    const id = await vehicleRepo.create({ model: 'DAF XF', licensePlate: 'KA 0001 KA', driverName: 'Tom Hardy' });
    expect(await vehicleRepo.findById(id)).toMatchObject({ status: 'available', capacityKg: null });
  });

  it('findByPlate is exact but case-insensitive', async () => {
    const id = await vehicleRepo.create(vehicle());
    expect((await vehicleRepo.findByPlate('aa 1001 aa')).id).toBe(id);
    expect(await vehicleRepo.findByPlate('AA 1001')).toBeNull();
  });

  it('surfaces ER_DUP_ENTRY on a duplicate plate (create and update)', async () => {
    await vehicleRepo.create(vehicle());
    await expect(vehicleRepo.create(vehicle())).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    const other = await vehicleRepo.create(vehicle({ licensePlate: 'BC 2002 BC' }));
    await expect(vehicleRepo.update(other, { licensePlate: 'aa 1001 aa' })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  describe('list / listAll', () => {
    let ids;
    beforeEach(async () => {
      ids = {
        a: await vehicleRepo.create(vehicle({ licensePlate: 'CC 3003 CC', model: 'Scania R450', driverName: 'Alice Wong' })),
        b: await vehicleRepo.create(vehicle({ licensePlate: 'AA 1001 AA', model: 'Volvo FH 500', driverName: 'Bob_Stone', status: 'on_trip' })),
        c: await vehicleRepo.create(vehicle({ licensePlate: 'BB 2002 BB', model: 'MAN TGX', driverName: 'Carl Diaz', status: 'maintenance' })),
      };
    });
    const listIds = async (query) => (await vehicleRepo.list({ page: 1, limit: 20, ...query })).items.map((v) => v.id);

    it('defaults to licensePlate asc and returns total', async () => {
      expect(await vehicleRepo.list({ page: 1, limit: 2 })).toMatchObject({ total: 3 });
      expect(await listIds({})).toEqual([ids.b, ids.c, ids.a]);
      expect((await vehicleRepo.list({ page: 2, limit: 2 })).items.map((v) => v.id)).toEqual([ids.a]);
      expect((await vehicleRepo.list()).items).toHaveLength(3);
    });

    it('filters by status and searches model, plate and driver literally', async () => {
      expect(await listIds({ status: 'maintenance' })).toEqual([ids.c]);
      expect(await listIds({ q: 'scania' })).toEqual([ids.a]);
      expect(await listIds({ q: 'bb 20' })).toEqual([ids.c]);
      expect(await listIds({ q: 'diaz' })).toEqual([ids.c]);
      expect(await listIds({ q: '_' })).toEqual([ids.b]);
      expect(await listIds({ q: '%' })).toEqual([]);
      expect((await vehicleRepo.list({ page: 1, limit: 20, status: 'on_trip', q: 'volvo' })).total).toBe(1);
    });

    it('sorts by whitelisted fields only', async () => {
      expect(await listIds({ sort: 'model', dir: 'asc' })).toEqual([ids.c, ids.a, ids.b]);
      expect(await listIds({ sort: 'driverName', dir: 'desc' })).toEqual([ids.c, ids.b, ids.a]);
      expect(await listIds({ sort: 'status', dir: 'asc' })).toEqual([ids.a, ids.c, ids.b]);
      expect(await listIds({ sort: 'capacityKg; DROP TABLE vehicles', dir: 'asc' })).toEqual([ids.b, ids.c, ids.a]);
    });

    it('listAll returns every vehicle ordered by plate', async () => {
      expect((await vehicleRepo.listAll()).map((v) => v.id)).toEqual([ids.b, ids.c, ids.a]);
    });
  });
});
