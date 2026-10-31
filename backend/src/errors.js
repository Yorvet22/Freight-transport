class AppError extends Error {
  constructor(code, status, message, details) {
    super(message || code);
    this.name    = 'AppError';
    this.code    = code;
    this.status  = status;
    this.details = details;
  }
}

const notFound   = (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found`);
const validation = (details, message = 'Validation failed') =>
  new AppError('VALIDATION_ERROR', 400, message, details);
const conflict   = (code, message) => new AppError(code, 409, message);
const tooManyRequests = (message = 'Too many requests. Please try again later.') =>
  new AppError('TOO_MANY_REQUESTS', 429, message);

module.exports = { AppError, notFound, validation, conflict, tooManyRequests };
