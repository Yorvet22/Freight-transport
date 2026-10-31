const { AppError } = require('../errors');

const ACTIONS  = ['create', 'update', 'delete', 'status_change'];
const ENTITIES = ['order', 'vehicle', 'warehouse', 'user'];
const MAX_LIMIT = 500;

const invalidQuery = (field, message) =>
  new AppError('INVALID_QUERY', 400, 'Invalid query parameters.', [{ field, message }]);

function parsePositiveInt(query, field, fallback) {
  const v = query[field];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (typeof v !== 'string' || !/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < 1) {
    throw invalidQuery(field, 'Must be a positive integer.');
  }
  return n;
}

function parseQuery(query = {}) {
  const entity = query.entity === undefined || query.entity === '' ? null : query.entity;
  if (entity !== null && !ENTITIES.includes(entity)) {
    throw invalidQuery('entity', `Entity must be one of: ${ENTITIES.join(', ')}.`);
  }
  const page  = parsePositiveInt(query, 'page', 1);
  const limit = parsePositiveInt(query, 'limit', 20);
  if (limit > MAX_LIMIT) throw invalidQuery('limit', `Limit must be at most ${MAX_LIMIT}.`);
  return { entity, entityId: parsePositiveInt(query, 'entityId', null), page, limit };
}

class AuditService {
  constructor(auditRepo, { logger = console } = {}) {
    this.auditRepo = auditRepo;
    this.logger    = logger;
  }

  /**
   * Records one audit entry. `user` is req.user ({id, username}); the system user (id 0) is stored with userId NULL.
   * Pass `conn` (a transaction connection) to make the entry part of the caller's transaction.
   */
  async record({ user, action, entity, entityId, details = null }, conn) {
    if (!ACTIONS.includes(action))  throw new Error(`audit.record: unknown action "${action}"`);
    if (!ENTITIES.includes(entity)) throw new Error(`audit.record: unknown entity "${entity}"`);
    const id = Number(entityId);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('audit.record: entityId must be a positive integer');
    const userId   = user && Number.isSafeInteger(user.id) && user.id > 0 ? user.id : null;
    const username = (user && user.username) || 'system';
    return this.auditRepo.add({ userId, username, action, entity, entityId: id, details }, conn);
  }

  async list(query) {
    const { entity, entityId, page, limit } = parseQuery(query);
    const { items, total } = await this.auditRepo.list({ entity, entityId, offset: (page - 1) * limit, limit });
    return { items, total, page, limit };
  }
}

module.exports = AuditService;
module.exports.ACTIONS  = ACTIONS;
module.exports.ENTITIES = ENTITIES;
