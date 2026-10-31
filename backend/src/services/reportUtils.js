// Shared helpers for the analytics layer (dashboard + reports). All calendar days are UTC (SPEC §10).

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS       = 24 * 60 * 60 * 1000;

const utcDateKey = d => d.toISOString().slice(0, 10);
const dayStart   = key => new Date(`${key}T00:00:00Z`);
const nextDay    = key => new Date(dayStart(key).getTime() + DAY_MS);

// The last `days` UTC calendar days ending with now's day, oldest first.
function lastUtcDays(now, days) {
  const result = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    result.push(utcDateKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))));
  }
  return result;
}

const round = (n, digits) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const ratio = (num, den) => (den > 0 ? round(num / den, 4) : null);

// SQL aggregates may come back as null (empty set) or strings; normalise to numbers.
const num = v => Number(v) || 0;

// List shape: never include the (large) POD signature.
function toListShape(order) {
  const { podSignature, ...rest } = order;
  return rest;
}

module.exports = { DATE_ONLY_RE, utcDateKey, dayStart, nextDay, lastUtcDays, round, ratio, num, toListShape };
