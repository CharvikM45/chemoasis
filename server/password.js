// Password hashing with scrypt (built into Node): slow on purpose, salted per user.
// Stored as "scrypt$N$r$p$salt$hash" so the cost can be raised later without breaking old hashes.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const COST = { N: 16384, r: 8, p: 1 };
const MAXMEM = 64 * 1024 * 1024;
const KEY_LENGTH = 64;

const prepare = (password) => String(password).normalize('NFKC');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(prepare(password), salt, KEY_LENGTH, { ...COST, maxmem: MAXMEM });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(prepare(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return crypto.timingSafeEqual(key, expected);
}

// Checked against when an email doesn't exist, so a wrong email takes as long as a wrong password.
const dummyHash = hashPassword('not-a-real-password-' + crypto.randomBytes(8).toString('hex'));

module.exports = { hashPassword, verifyPassword, dummyHash };
