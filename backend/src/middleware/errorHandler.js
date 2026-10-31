const { AppError } = require('../errors');

const DUPLICATE_CODES = [
  ['licensePlate', 'DUPLICATE_PLATE', 'A vehicle with this licence plate already exists'],
  ['code',         'DUPLICATE_CODE', 'A warehouse with this code already exists'],
  ['username',     'DUPLICATE_USERNAME', 'A user with this username already exists'],
];

function duplicateError(err) {
  const msg   = err.sqlMessage || err.message || '';
  const match = DUPLICATE_CODES.find(([key]) => msg.includes(`_${key}'`) || msg.includes(`.${key}'`));
  return match
    ? new AppError(match[1], 409, match[2])
    : new AppError('CONFLICT', 409, 'The record conflicts with an existing one');
}

// Translates known error kinds to AppError; returns null for unexpected errors.
function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err.type === 'entity.parse.failed') return new AppError('INVALID_JSON', 400, 'Request body is not valid JSON');
  if (err.type === 'entity.too.large') return new AppError('VALIDATION_ERROR', 400, 'Request body is too large');
  if (err.code === 'ER_DUP_ENTRY') return duplicateError(err);
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
    return new AppError('VALIDATION_ERROR', 400, 'A referenced record does not exist');
  }
  return null;
}

// Express error middleware; any AppError (incl. 429 TOO_MANY_REQUESTS) maps to its own status.
// Only unexpected errors are logged (SPEC §4).
function createErrorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const appError = toAppError(err);
    if (!appError) {
      logger.error(err);
      return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
    }
    const body = { error: appError.code, message: appError.message };
    if (appError.details) body.details = appError.details;
    return res.status(appError.status).json(body);
  };
}

// Default handler logs via console (resolved at call time so tests can spy on it).
const errorHandler = createErrorHandler({ error: (...args) => console.error(...args) });

module.exports = errorHandler;
module.exports.createErrorHandler = createErrorHandler;
module.exports.toAppError = toAppError;
