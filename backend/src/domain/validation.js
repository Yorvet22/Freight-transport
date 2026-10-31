const { AppError, validation } = require('../errors');

const MAX_INT     = 2147483647;
const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function parseId(raw, field = 'id') {
  const str = typeof raw === 'number' ? String(raw) : raw;
  if (typeof str === 'string' && /^[1-9]\d{0,9}$/.test(str) && Number(str) <= MAX_INT) return Number(str);
  throw new AppError('INVALID_ID', 400, `${field} must be a positive integer`);
}

// Each converter returns { value } or { error }.
const converters = {
  string(v, rule) {
    if (typeof v !== 'string') return { error: 'must be a string' };
    const value = v.trim();
    if (rule.max && value.length > rule.max) return { error: `must be at most ${rule.max} characters` };
    return { value };
  },
  enum(v, rule) {
    return rule.values.includes(v) ? { value: v } : { error: `must be one of: ${rule.values.join(', ')}` };
  },
  int(v, rule) {
    const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
    const min = rule.min === undefined ? 1 : rule.min;
    const max = rule.max === undefined ? MAX_INT : rule.max;
    if (!Number.isInteger(n) || n < min || n > max) return { error: `must be an integer between ${min} and ${max}` };
    return { value: n };
  },
  number(v, rule) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'must be a number' };
    if (rule.gt !== undefined && n <= rule.gt) return { error: `must be greater than ${rule.gt}` };
    if (rule.max !== undefined && n > rule.max) return { error: `must be at most ${rule.max}` };
    return { value: n };
  },
  boolean(v) {
    if (v === true || v === 'true') return { value: true };
    if (v === false || v === 'false') return { value: false };
    return { error: 'must be true or false' };
  },
  date(v) {
    return isValidDate(v) ? { value: v } : { error: 'must be a date in YYYY-MM-DD format' };
  },
  datetime(v) {
    const ok = typeof v === 'string' && DATETIME_RE.test(v) && isValidDate(v.slice(0, 10));
    const d  = ok ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? { value: d } : { error: 'must be an ISO 8601 date-time' };
  },
};

// Validates fields described by `schema`; returns { value, details }.
function checkFields(source, schema) {
  const value   = {};
  const details = [];
  for (const [field, rule] of Object.entries(schema)) {
    const raw = source[field];
    if (isBlank(raw)) {
      if (rule.required) details.push({ field, message: `${field} is required` });
      value[field] = rule.default === undefined ? null : rule.default;
      continue;
    }
    const result = converters[rule.type](raw, rule);
    if (result.error) details.push({ field, message: `${field} ${result.error}` });
    else value[field] = result.value;
  }
  return { value, details };
}

function validateBody(body, schema) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validation([], 'Request body must be a JSON object');
  }
  const { value, details } = checkFields(body, schema);
  if (details.length) throw validation(details);
  return value;
}

module.exports = { parseId, validateBody, checkFields, isValidDate, MAX_INT };
