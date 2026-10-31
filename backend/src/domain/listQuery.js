const { AppError }    = require('../errors');
const { checkFields } = require('./validation');

const MAX_LIMIT = 500;

const invalidQuery = (details) => new AppError('INVALID_QUERY', 400, 'Invalid query parameters', details);

// Parses query params declared in `schema`; unknown params are ignored.
function parseQuery(raw = {}, schema) {
  const arrays = Object.keys(schema).filter((key) => Array.isArray(raw[key]));
  if (arrays.length) throw invalidQuery(arrays.map((field) => ({ field, message: `${field} must be a single value` })));
  const { value, details } = checkFields(raw, schema);
  if (details.length) throw invalidQuery(details);
  return value;
}

// Parses list params (page, limit, sort, dir, q + declared filters).
function parseListQuery(raw = {}, spec) {
  const schema = {
    page:  { type: 'int', default: 1 },
    limit: { type: 'int', max: MAX_LIMIT, default: 20 },
    sort:  { type: 'enum', values: spec.sorts, default: spec.defaultSort },
    dir:   { type: 'enum', values: ['asc', 'desc'], default: spec.defaultDir || 'asc' },
    q:     { type: 'string', max: 100 },
    ...spec.filters,
  };
  return parseQuery(raw, schema);
}

module.exports = { parseQuery, parseListQuery, MAX_LIMIT };
