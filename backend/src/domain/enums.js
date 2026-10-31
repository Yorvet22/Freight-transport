const ORDER_STATUS = Object.freeze({
  NEW:        'new',
  IN_TRANSIT: 'in_transit',
  DELIVERED:  'delivered',
  CANCELLED:  'cancelled',
});

const ORDER_TYPE = Object.freeze({
  INBOUND:  'inbound',
  OUTBOUND: 'outbound',
  TRANSFER: 'transfer',
});

const VEHICLE_STATUS = Object.freeze({
  AVAILABLE:   'available',
  ON_TRIP:     'on_trip',
  MAINTENANCE: 'maintenance',
});

const USER_ROLES = ['viewer', 'dispatcher', 'admin'];

const ORDER_STATUSES   = Object.values(ORDER_STATUS);
const ORDER_TYPES      = Object.values(ORDER_TYPE);
const VEHICLE_STATUSES = Object.values(VEHICLE_STATUS);

const TRANSITIONS = {
  new:        ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered:  [],
  cancelled:  [],
};

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

module.exports = {
  ORDER_STATUS, ORDER_TYPE, VEHICLE_STATUS, USER_ROLES,
  ORDER_STATUSES, ORDER_TYPES, VEHICLE_STATUSES, canTransition,
};
