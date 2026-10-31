// Deterministic demo data (SPEC §8). Times are relative to `now`, so the dashboard always looks alive.
// Pure data only; src/seed/sqlSeed.js inserts it into MySQL.
const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

const DEMO_USERS = [ // demo only — never use these credentials in production
  { username: 'admin',      password: 'admin123',      role: 'admin' },
  { username: 'dispatcher', password: 'dispatcher123', role: 'dispatcher' },
  { username: 'viewer',     password: 'viewer123',     role: 'viewer' },
];

const WAREHOUSES = [
  { code: 'WH-01', name: 'Kyiv Central Hub',     address: '14 Industrialna St', city: 'Kyiv',   capacityPallets: 2400, managerName: 'Andrew Melnyk',  phone: '+380 44 201 1001' },
  { code: 'WH-02', name: 'Lviv West Terminal',   address: '7 Horodotska St',    city: 'Lviv',   capacityPallets: 1600, managerName: 'Sophia Hrytsak', phone: '+380 32 202 2002' },
  { code: 'WH-03', name: 'Odesa Port Warehouse', address: '21 Portova St',      city: 'Odesa',  capacityPallets: 3200, managerName: 'Mark Bondar',    phone: '+380 48 203 3003' },
  { code: 'WH-04', name: 'Dnipro East Depot',    address: '42 Metalurhiv Ave',  city: 'Dnipro', capacityPallets: 1800, managerName: 'Irene Tkachuk',  phone: '+380 56 204 4004' },
];

const MAINTENANCE = [3, 7];   // vehicle indexes
const IN_TRANSIT  = { 53: 1, 55: 5, 57: 9 }; // order index → vehicle index (these vehicles are on_trip)

const VEHICLES = [
  ['MAN TGX 18.480',          'AA 1234 KB', 'Ivan Kovalenko',   20000],
  ['Volvo FH 500',            'BC 5678 KA', 'Oleg Melnychuk',   24000],
  ['Scania R 450',            'AX 9012 AA', 'Taras Shevchuk',   22000],
  ['DAF XF 480',              'KA 3456 BB', 'Serhiy Bondarenko', 20000],
  ['Mercedes-Benz Actros 1851', 'AE 7890 CC', 'Andriy Tkachenko', 24000],
  ['Renault T 480',           'BH 1122 HH', 'Mykola Kravets',   21000],
  ['Iveco S-Way 490',         'AI 3344 KA', 'Vasyl Savchuk',    22000],
  ['Volvo FM 420',            'BI 5566 MA', 'Oleksiy Honchar',  18000],
  ['MAN TGS 26.440',          'CA 7788 HA', 'Petro Lytvyn',     26000],
  ['Scania S 500',            'AP 9900 OA', 'Dmytro Marchuk',   24000],
].map(([model, licensePlate, driverName, capacityKg], i) => ({
  model, licensePlate, driverName, capacityKg,
  status: MAINTENANCE.includes(i) ? 'maintenance' : Object.values(IN_TRANSIT).includes(i) ? 'on_trip' : 'available',
}));

const CLIENTS = ['Northwind Traders', 'Blue Ridge Foods', 'Summit Steel Works', 'Greenfield Agro',
  'Harbor Line Logistics', 'Silverleaf Pharma', 'Brightstone Materials', 'Oakwood Furniture Co.',
  'Riverbend Dairy', 'Crestview Electronics', 'Maple & Pine Packaging', 'Redwood Textiles'];

const EXTERNAL_ADDRESSES = ['18 Sumska St, Kharkiv', '3 Zavodska St, Zaporizhzhia', '55 Soborna St, Rivne',
  '9 Kyivska St, Vinnytsia', '27 Naberezhna St, Poltava', '11 Korabelna St, Mykolaiv'];

const CARGO = ['Packaged food products', 'Steel coils', 'Building materials', 'Office furniture',
  'Pharmaceutical supplies', 'Consumer electronics', 'Agricultural seeds', 'Paper and cardboard',
  'Dairy products (refrigerated)', 'Textile rolls'];

const RECIPIENTS = ['Helen Carter', 'James Wilson', 'Anna Koval', 'Peter Novak', 'Maria Lopez', 'Victor Hale'];

const ORDER_COUNT       = 60;
const ROTATION          = [0, 1, 2, 4, 5, 6, 8, 9]; // vehicles used for past trips
const FREE_VEHICLES     = [0, 2, 4, 6, 8];          // vehicles assignable to new orders
const TYPES             = ['outbound', 'inbound', 'transfer'];

const dateOnly = (d) => d.toISOString().slice(0, 10);
const atHour   = (d, hour) => new Date(`${dateOnly(d)}T${String(hour).padStart(2, '0')}:00:00Z`);
const minDate  = (a, b) => (a < b ? a : b);
const whAddress = (w) => `${WAREHOUSES[w].address}, ${WAREHOUSES[w].city}`;

function statusFor(i, daysAgo) {
  if (IN_TRANSIT[i] !== undefined) return 'in_transit';
  if (daysAgo <= 5) return 'new';
  return i % 7 === 3 ? 'cancelled' : 'delivered';
}

function routeFor(i) {
  const type = TYPES[i % 3];
  const a = i % 4;
  const b = (i + 1) % 4;
  const external = EXTERNAL_ADDRESSES[i % EXTERNAL_ADDRESSES.length];
  if (type === 'outbound') return { type, origin: a, destination: null, pickupAddress: whAddress(a), deliveryAddress: external };
  if (type === 'inbound') return { type, origin: null, destination: a, pickupAddress: external, deliveryAddress: whAddress(a) };
  return { type, origin: a, destination: b, pickupAddress: whAddress(a), deliveryAddress: whAddress(b) };
}

function vehicleFor(i, status) {
  if (status === 'in_transit') return IN_TRANSIT[i];
  if (status === 'new') return i % 2 === 0 ? FREE_VEHICLES[i % FREE_VEHICLES.length] : null;
  return ROTATION[i % ROTATION.length];
}

function buildOrder(i, now) {
  const daysAgo   = 29 - Math.floor(i / 2);
  const createdAt = new Date(now.getTime() - daysAgo * DAY - (i % 2 ? 2 : 6) * HOUR - (i % 3) * 30 * 60 * 1000);
  const status    = statusFor(i, daysAgo);
  const route     = routeFor(i);
  const pickupDay = status === 'new' ? new Date(now.getTime() + (i % 3) * DAY) : new Date(createdAt.getTime() + DAY);
  const pickupWindowStart = atHour(pickupDay, 8 + (i % 4) * 2);
  const plannedDeliveryDate = dateOnly(new Date(pickupWindowStart.getTime() + (1 + (i % 3)) * DAY));

  const changedBy = i % 2 ? 'admin' : 'dispatcher';
  const history   = [{ fromStatus: null, toStatus: 'new', changedAt: createdAt, changedBy: 'dispatcher', note: null }];
  const dispatchedAt = minDate(new Date(pickupWindowStart.getTime() + 30 * 60 * 1000), new Date(now.getTime() - HOUR));
  const cancelledFromTransit = status === 'cancelled' && i === 24;
  let deliveredAt = null;

  if (status === 'in_transit' || status === 'delivered' || cancelledFromTransit) {
    history.push({ fromStatus: 'new', toStatus: 'in_transit', changedAt: dispatchedAt, changedBy, note: null });
  }
  if (status === 'delivered') {
    deliveredAt = new Date(dispatchedAt.getTime() + (20 + (i % 5) * 12) * HOUR);
    history.push({ fromStatus: 'in_transit', toStatus: 'delivered', changedAt: deliveredAt, changedBy, note: null });
  }
  if (status === 'cancelled') {
    history.push(cancelledFromTransit
      ? { fromStatus: 'in_transit', toStatus: 'cancelled', changedAt: new Date(dispatchedAt.getTime() + 5 * HOUR), changedBy, note: 'Vehicle breakdown on route' }
      : { fromStatus: 'new', toStatus: 'cancelled', changedAt: new Date(createdAt.getTime() + 3 * HOUR), changedBy, note: 'Cancelled by client' });
  }

  return {
    type:                route.type,
    clientName:          CLIENTS[i % CLIENTS.length],
    pickupAddress:       route.pickupAddress,
    deliveryAddress:     route.deliveryAddress,
    cargoDescription:    CARGO[i % CARGO.length],
    cargoWeight:         500 + Math.round(((i * 733) % 19500) / 10) * 10,
    status,
    vehicleIndex:        vehicleFor(i, status),
    originIndex:         route.origin,
    destinationIndex:    route.destination,
    plannedDeliveryDate,
    pickupWindowStart,
    pickupWindowEnd:     new Date(pickupWindowStart.getTime() + 2 * HOUR),
    dockNumber:          `D-0${(i % 6) + 1}`,
    podRecipientName:    status === 'delivered' ? RECIPIENTS[i % RECIPIENTS.length] : null,
    podSignature:        null,
    podNote:             status === 'delivered' && i % 4 === 0 ? 'Received in good condition' : null,
    createdAt,
    deliveredAt,
    history,
  };
}

function buildDemoData(now = new Date()) {
  return {
    warehouses: WAREHOUSES.map((w) => ({ ...w, isActive: true, createdAt: new Date(now.getTime() - 90 * DAY) })),
    vehicles:   VEHICLES.map((v) => ({ ...v })),
    orders:     Array.from({ length: ORDER_COUNT }, (_, i) => buildOrder(i, now)),
  };
}

module.exports = { buildDemoData, DEMO_USERS };
