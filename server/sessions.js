// Sign-in sessions: a random token in an HttpOnly cookie; only its SHA-256 hash is stored.
const crypto = require('crypto');

const SESSION_DAYS = 30;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function cookieName(isProd) {
  // "__Host-" makes the browser refuse the cookie unless it's Secure, on this exact host, for the whole site.
  return isProd ? '__Host-chemoasis_session' : 'chemoasis_session';
}

function readToken(req, isProd) {
  const header = req.headers.cookie || '';
  const name = cookieName(isProd) + '=';
  for (const part of header.split(';')) {
    const item = part.trim();
    if (item.startsWith(name)) return decodeURIComponent(item.slice(name.length));
  }
  return null;
}

function setCookie(res, token, isProd) {
  const parts = [
    `${cookieName(isProd)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly', // page scripts can't read it, so injected scripts can't steal it
    'SameSite=Lax', // not sent on cross-site form posts
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  ];
  if (isProd) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, isProd) {
  res.append('Set-Cookie', `${cookieName(isProd)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? '; Secure' : ''}`);
}

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expires]);
  return token;
}

async function findUser(db, token) {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.name, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

async function endSession(db, token) {
  if (token) await db.query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
}

async function removeExpired(db) {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}

module.exports = { readToken, setCookie, clearCookie, createSession, findUser, endSession, removeExpired, SESSION_DAYS };
