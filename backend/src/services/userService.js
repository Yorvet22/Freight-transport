const { AppError, notFound, validation } = require('../errors');
const { hashPassword } = require('../auth/password');
const { ROLE_RANK }    = require('../auth/middleware');

const USERNAME_RE  = /^[A-Za-z0-9._-]+$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;

const toPublicUser = u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt });

function validateNewUser(body) {
  const { username, password, role } = body || {};
  const name = typeof username === 'string' ? username.trim() : '';
  const details = [];
  if (!name) details.push({ field: 'username', message: 'Username is required.' });
  else if (name.length > 50) details.push({ field: 'username', message: 'Username must be at most 50 characters.' });
  else if (!USERNAME_RE.test(name)) {
    details.push({ field: 'username', message: 'Username may contain only letters, digits, dots, dashes and underscores.' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    details.push({ field: 'password', message: `Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters long.` });
  }
  if (!Object.prototype.hasOwnProperty.call(ROLE_RANK, role)) {
    details.push({ field: 'role', message: 'Role must be one of: admin, dispatcher, viewer.' });
  }
  if (details.length) throw validation(details);
  return { username: name, password, role };
}

class UserService {
  // audit: optional AuditService-like { record(entry) }; user create/delete are audited (SPEC §11).
  // An audit failure is logged but never fails the request (same policy as the domain services).
  constructor(userRepo, { audit = null, logger = console } = {}) {
    this.userRepo = userRepo;
    this.audit    = audit;
    this.logger   = logger;
  }

  async record(user, action, entityId, details) {
    if (!this.audit) return;
    try {
      await this.audit.record({ user, action, entity: 'user', entityId, details });
    } catch (err) {
      this.logger.error(`Audit record failed (${action} user #${entityId}):`, err);
    }
  }

  async list() {
    return (await this.userRepo.listAll()).map(toPublicUser);
  }

  async create(body, currentUser) {
    const { username, password, role } = validateNewUser(body);
    if (await this.userRepo.findByUsername(username)) {
      throw new AppError('DUPLICATE_USERNAME', 409, 'A user with this username already exists.');
    }
    const id = await this.userRepo.create({ username, passwordHash: hashPassword(password), role });
    await this.record(currentUser, 'create', id, { username, role });
    return toPublicUser(await this.userRepo.findById(id));
  }

  async delete(rawId, currentUser) {
    const id = Number(rawId);
    if (!/^\d+$/.test(String(rawId)) || !Number.isSafeInteger(id) || id < 1) {
      throw new AppError('INVALID_ID', 400, 'Id must be a positive integer.');
    }
    if (currentUser && currentUser.id === id) {
      throw validation([{ field: 'id', message: 'You cannot delete your own account.' }], 'You cannot delete your own account.');
    }
    const existing = await this.userRepo.findById(id);
    if (!existing || !(await this.userRepo.deleteById(id))) throw notFound('User');
    await this.record(currentUser, 'delete', id, { username: existing.username, role: existing.role });
  }
}

module.exports = UserService;
