// Security measures: headers and content policy, safe JSON parsing, audit log. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { newDb } = require('pg-mem');
const { migrate } = require('../db');
const { createApp } = require('../app');
const { inlineScriptHashes } = require('../security');
const { shortIp } = require('../audit');

async function start({ isProd = false } = {}) {
  const { Pool } = newDb().adapters.createPg();
  const db = new Pool();
  await migrate(db);
  const app = createApp({ db, isProd });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, raw, cookie, extra } = {}) => {
    const headers = { 'X-Forwarded-Proto': 'https', ...extra }; // as Railway's proxy sends
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + p, { method, headers, redirect: 'manual', body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json, headers: res.headers, cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  return { db, call, close: () => new Promise((r) => server.close(r)) };
}

test('pages get security headers and a strict script policy', async () => {
  const t = await start({ isProd: true });
  try {
    const page = await t.call('GET', '/home/index.html');
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'inline scripts are allowed only by hash');
    assert.ok(!/unpkg|jsdelivr/.test(csp), 'no third-party script hosts');
    for (const hash of inlineScriptHashes([path.join(__dirname, '..', '..', 'home', 'index.html')])) assert.ok(csp.includes(hash), 'every inline script on the home page is allowed by its hash');
    assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(page.headers.get('x-frame-options'), 'DENY');
    assert.match(page.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.ok(page.headers.get('referrer-policy'));
    const api = await t.call('GET', '/api/auth/me');
    assert.strictEqual(api.headers.get('cache-control'), 'no-store');
  } finally { await t.close(); }
});

test('__proto__ and constructor keys are dropped from request bodies', async () => {
  const t = await start();
  try {
    const signup = await t.call('POST', '/api/auth/signup', { body: { email: 'sam@example.com', name: 'Sam', password: 'gentle-steps-42', consent: true } });
    const raw = '{"profile":{"answers":{"__proto__":{"polluted":true},"age":"18to44"},"constructor":{"prototype":{"x":1}}}}';
    const put = await t.call('PUT', '/api/profile', { raw, cookie: signup.cookie });
    assert.strictEqual(put.status, 200);
    assert.strictEqual({}.polluted, undefined, 'nothing reached Object.prototype');
    const got = await t.call('GET', '/api/profile', { cookie: signup.cookie });
    assert.deepStrictEqual(Object.keys(got.json.profile.answers), ['age']);
  } finally { await t.close(); }
});

test('sign-ins, failures and deletions go to the audit log, with shortened IPs', async () => {
  const t = await start();
  try {
    const signup = await t.call('POST', '/api/auth/signup', { body: { email: 'sam@example.com', name: 'Sam', password: 'gentle-steps-42', consent: true } });
    await t.call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: 'wrong-password-1' } });
    await t.call('DELETE', '/api/auth/me', { cookie: signup.cookie });
    const { rows } = await t.db.query('SELECT event, ip FROM audit_log ORDER BY id');
    assert.deepStrictEqual(rows.map((r) => r.event), ['signup', 'login_failed', 'account_deleted']);
    assert.ok(rows.every((r) => !r.ip || /\.0$|::$/.test(r.ip)), 'IPs are shortened');
    assert.strictEqual(shortIp('203.0.113.45'), '203.0.113.0');
    assert.strictEqual(shortIp('2001:db8:1:2::5'), '2001:db8:1::');
  } finally { await t.close(); }
});

test('a cross-site request without an Origin header is still blocked', async () => {
  const t = await start();
  try {
    const blocked = await t.call('POST', '/api/auth/signup', { body: { email: 'sam@example.com', name: 'Sam', password: 'gentle-steps-42', consent: true }, extra: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.strictEqual(blocked.status, 403);
    const sameSite = await t.call('POST', '/api/auth/signup', { body: { email: 'sam@example.com', name: 'Sam', password: 'gentle-steps-42', consent: true }, extra: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.strictEqual(sameSite.status, 201);
  } finally { await t.close(); }
});

test('server errors never show internals to the browser', async () => {
  const t = await start();
  try {
    await t.db.query('DROP TABLE profiles CASCADE');
    const signup = await t.call('POST', '/api/auth/signup', { body: { email: 'sam@example.com', name: 'Sam', password: 'gentle-steps-42', consent: true } });
    const res = await t.call('GET', '/api/profile', { cookie: signup.cookie });
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(Object.keys(res.json), ['error']);
    assert.ok(!/profiles|relation|stack|at /i.test(res.json.error), 'no database or stack details');
  } finally { await t.close(); }
});

test('in production, plain HTTP is redirected to HTTPS, except the health check', async () => {
  const t = await start({ isProd: true });
  try {
    const page = await t.call('GET', '/home/index.html', { extra: { 'X-Forwarded-Proto': 'http' } });
    assert.strictEqual(page.status, 301);
    const health = await t.call('GET', '/api/health', { extra: { 'X-Forwarded-Proto': 'http' } });
    assert.strictEqual(health.status, 200);
  } finally { await t.close(); }
});
