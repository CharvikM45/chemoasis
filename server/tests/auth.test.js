// Account API tests against an in-memory Postgres (pg-mem). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { migrate } = require('../db');
const { createApp } = require('../app');

async function start({ isProd = false, limits } = {}) {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const db = new Pool();
  await migrate(db);
  const app = createApp({ db, isProd, limits });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, cookie, origin, raw } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;
    const res = await fetch(base + path, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json, text, setCookie, cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  return { db, call, base, close: () => new Promise((r) => server.close(r)) };
}

const maya = { email: 'Maya@Example.com', name: 'Maya', password: 'gentle-steps-42' };

test('create an account, stay signed in, sign out', async () => {
  const t = await start();
  try {
    const signup = await t.call('POST', '/api/auth/signup', { body: maya });
    assert.strictEqual(signup.status, 201);
    assert.strictEqual(signup.json.user.email, 'maya@example.com', 'email is lowercased');
    assert.match(signup.setCookie, /HttpOnly/);
    assert.match(signup.setCookie, /SameSite=Lax/);

    const me = await t.call('GET', '/api/auth/me', { cookie: signup.cookie });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.json.user.name, 'Maya');

    const out = await t.call('POST', '/api/auth/logout', { cookie: signup.cookie });
    assert.strictEqual(out.status, 204);
    assert.match(out.setCookie, /Max-Age=0/);
    const after = await t.call('GET', '/api/auth/me', { cookie: signup.cookie });
    assert.strictEqual(after.status, 401, 'the old cookie no longer works');
  } finally { await t.close(); }
});

test('passwords and session tokens are never stored as-is', async () => {
  const t = await start();
  try {
    const signup = await t.call('POST', '/api/auth/signup', { body: maya });
    const { rows: users } = await t.db.query('SELECT password_hash FROM users');
    assert.ok(users[0].password_hash.startsWith('scrypt$'));
    assert.ok(!users[0].password_hash.includes(maya.password));
    const token = decodeURIComponent(signup.cookie.split('=')[1]);
    const { rows: sessions } = await t.db.query('SELECT id FROM sessions');
    assert.strictEqual(sessions.length, 1);
    assert.notStrictEqual(sessions[0].id, token);
  } finally { await t.close(); }
});

test('one account per email, whatever the capitals', async () => {
  const t = await start();
  try {
    await t.call('POST', '/api/auth/signup', { body: maya });
    const again = await t.call('POST', '/api/auth/signup', { body: { ...maya, email: 'MAYA@example.COM' } });
    assert.strictEqual(again.status, 409);
  } finally { await t.close(); }
});

test('checks what people type', async () => {
  const t = await start();
  try {
    const cases = [
      [{ ...maya, email: 'not-an-email' }, /email address/],
      [{ ...maya, name: '   ' }, /name/],
      [{ ...maya, password: 'short' }, /at least 8/],
      [{ ...maya, password: 'x'.repeat(201) }, /200 characters/],
      [{ ...maya, name: 'n'.repeat(41) }, /40 characters/]
    ];
    for (const [body, message] of cases) {
      const res = await t.call('POST', '/api/auth/signup', { body });
      assert.strictEqual(res.status, 400);
      assert.match(res.json.error, message);
    }
  } finally { await t.close(); }
});

test('sign in: right password works, wrong password and unknown email get the same answer', async () => {
  const t = await start();
  try {
    await t.call('POST', '/api/auth/signup', { body: maya });
    const ok = await t.call('POST', '/api/auth/login', { body: { email: 'maya@example.com', password: maya.password } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await t.call('GET', '/api/auth/me', { cookie: ok.cookie })).status, 200);

    const wrong = await t.call('POST', '/api/auth/login', { body: { email: 'maya@example.com', password: 'nope-nope-nope' } });
    const unknown = await t.call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'nope-nope-nope' } });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(unknown.status, 401);
    assert.strictEqual(wrong.json.error, unknown.json.error);
  } finally { await t.close(); }
});

test('too many sign-in attempts are slowed down', async () => {
  const t = await start({ limits: { loginAccount: { limit: 3 } } });
  try {
    await t.call('POST', '/api/auth/signup', { body: maya });
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await t.call('POST', '/api/auth/login', { body: { email: 'maya@example.com', password: 'wrong-password' } })).status);
    }
    assert.deepStrictEqual(statuses, [401, 401, 401, 429, 429]);
  } finally { await t.close(); }
});

test('requests from other websites are blocked', async () => {
  const t = await start();
  try {
    const res = await t.call('POST', '/api/auth/signup', { body: maya, origin: 'https://evil.example' });
    assert.strictEqual(res.status, 403);
    const own = await t.call('POST', '/api/auth/signup', { body: maya, origin: t.base });
    assert.strictEqual(own.status, 201);
  } finally { await t.close(); }
});

test('delete my account removes it and its sessions', async () => {
  const t = await start();
  try {
    const signup = await t.call('POST', '/api/auth/signup', { body: maya });
    assert.strictEqual((await t.call('DELETE', '/api/auth/me')).status, 401, 'needs to be signed in');
    const del = await t.call('DELETE', '/api/auth/me', { cookie: signup.cookie });
    assert.strictEqual(del.status, 204);
    assert.strictEqual((await t.db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0);
    assert.strictEqual((await t.db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 0);
    const login = await t.call('POST', '/api/auth/login', { body: { email: maya.email, password: maya.password } });
    assert.strictEqual(login.status, 401);
  } finally { await t.close(); }
});

test('oversized or broken requests get a clear error', async () => {
  const t = await start();
  try {
    const big = await t.call('POST', '/api/auth/signup', { body: { ...maya, name: 'x'.repeat(20000) } });
    assert.strictEqual(big.status, 413);
    const broken = await t.call('POST', '/api/auth/signup', { raw: '{"email":', body: undefined, cookie: undefined });
    assert.ok([400, 415].includes(broken.status) || broken.status === 400);
  } finally { await t.close(); }
});

test('serves the website but never the server code or secrets', async () => {
  const t = await start();
  try {
    assert.strictEqual((await t.call('GET', '/home/index.html')).status, 200);
    assert.strictEqual((await t.call('GET', '/account/index.html')).status, 200);
    assert.strictEqual((await t.call('GET', '/')).status, 200);
    for (const path of ['/server/app.js', '/node_modules/pg/package.json', '/.env', '/package.json', '/.git/config', '/home/../server/app.js']) {
      assert.strictEqual((await t.call('GET', path)).status, 404, path);
    }
    assert.strictEqual((await t.call('GET', '/api/health')).json.ok, true);
  } finally { await t.close(); }
});

test('in production the cookie is locked to HTTPS and this site', async () => {
  const t = await start({ isProd: true });
  try {
    const signup = await t.call('POST', '/api/auth/signup', { body: maya });
    assert.match(signup.setCookie, /^__Host-chemoasis_session=/);
    assert.match(signup.setCookie, /Secure/);
  } finally { await t.close(); }
});
