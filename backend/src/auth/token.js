const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest();

// Stateless token: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload part)).
function signToken({ uid, username, role }, secret, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ uid, username, role, exp })).toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  const expected = sign(payload, secret);
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  if (sig !== actual.toString('base64url')) return null; // reject non-canonical encodings
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== 'number' || data.exp * 1000 <= now) return null;
  return data;
}

module.exports = { signToken, verifyToken, TOKEN_TTL_SECONDS };
