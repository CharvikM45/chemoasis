// Profile API tests (questionnaire answers, recommender model, levels) against pg-mem. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { migrate } = require('../db');
const { createApp } = require('../app');

async function start({ dataKey } = {}) {
  const { Pool } = newDb().adapters.createPg();
  const db = new Pool();
  await migrate(db);
  const app = createApp({ db, isProd: false, dataKey });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, cookie } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  const signUp = async (email) => (await call('POST', '/api/auth/signup', { body: { email, name: 'Sam', password: 'gentle-steps-42', consent: true } })).cookie;
  return { db, call, signUp, close: () => new Promise((r) => server.close(r)) };
}

test('the profile needs a signed-in person', async () => {
  const t = await start();
  try {
    assert.strictEqual((await t.call('GET', '/api/profile')).status, 401);
    assert.strictEqual((await t.call('PUT', '/api/profile', { body: { profile: {} } })).status, 401);
    assert.strictEqual((await t.call('POST', '/api/profile/play', { body: { game: 'lumen' } })).status, 401);
  } finally { await t.close(); }
});

test('answers and the model are saved per account and come back after signing in again', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    const empty = await t.call('GET', '/api/profile', { cookie });
    assert.strictEqual(empty.status, 200);
    assert.strictEqual(empty.json.profile, null);

    const profile = { answers: { age: '45to64', symptoms: ['memory', 'focus'] }, completedAt: '2026-10-23T00:00:00.000Z', model: { version: 1, delta: {}, events: [], dismissed: {} }, extra: 'dropped' };
    const put = await t.call('PUT', '/api/profile', { cookie, body: { profile } });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.json.profile.extra, undefined, 'unknown fields are dropped');

    await t.call('POST', '/api/auth/logout', { cookie });
    const again = await t.call('POST', '/api/auth/login', { body: { email: 'sam@example.com', password: 'gentle-steps-42', consent: true } });
    const got = await t.call('GET', '/api/profile', { cookie: again.cookie });
    assert.deepStrictEqual(got.json.profile.answers, profile.answers);
    assert.strictEqual(got.json.profile.completedAt, profile.completedAt);

    const other = await t.signUp('ana@example.com');
    assert.strictEqual((await t.call('GET', '/api/profile', { cookie: other })).json.profile, null, "one person can't see another's answers");
  } finally { await t.close(); }
});

test('plays and finished levels are recorded on the account', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    await t.call('PUT', '/api/profile', { cookie, body: { profile: { model: { version: 1, delta: {}, events: [], dismissed: { rhythm: 1 } } } } });
    assert.strictEqual((await t.call('POST', '/api/profile/play', { cookie, body: { game: 'rhythm' } })).status, 204);
    assert.strictEqual((await t.call('POST', '/api/profile/play', { cookie, body: { game: 'chess' } })).status, 400);
    assert.strictEqual((await t.call('POST', '/api/profile/level', { cookie, body: { game: 'signal', level: 2 } })).status, 204);
    await t.call('POST', '/api/profile/level', { cookie, body: { game: 'signal', level: 0 } });
    await t.call('POST', '/api/profile/level', { cookie, body: { game: 'signal', level: 2 } });

    const { profile } = (await t.call('GET', '/api/profile', { cookie })).json;
    assert.strictEqual(profile.model.events.length, 1);
    assert.strictEqual(profile.model.events[0].game, 'rhythm');
    assert.strictEqual(profile.model.dismissed.rhythm, undefined, 'playing a game un-hides it');
    assert.deepStrictEqual(profile.levels.signal, [0, 2]);
  } finally { await t.close(); }
});

test('plays and levels sent at the same moment are all kept', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    await Promise.all([
      ...['lumen', 'echo', 'signal', 'rhythm'].map((game) => t.call('POST', '/api/profile/play', { cookie, body: { game } })),
      ...[0, 1, 2].map((level) => t.call('POST', '/api/profile/level', { cookie, body: { game: 'lumen', level } }))
    ]);
    const { profile } = (await t.call('GET', '/api/profile', { cookie })).json;
    assert.strictEqual(profile.model.events.length, 4);
    assert.deepStrictEqual(profile.levels.lumen, [0, 1, 2]);
  } finally { await t.close(); }
});

test('game results are saved for the progress chart', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'lumen', level: 1, score: 6 } })).status, 204);
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'starling', level: 0, score: 233.4 } })).status, 204);
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'lumen', level: 1, score: 'lots' } })).status, 400);
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'chess', level: 1, score: 3 } })).status, 400);
    const { results } = (await t.call('GET', '/api/profile', { cookie })).json.profile;
    assert.deepStrictEqual(results.map((r) => [r.game, r.score]), [['lumen', 6], ['starling', 233.4]]);
    assert.ok(results[0].at);
  } finally { await t.close(); }
});

test('Gentle sessions are saved without a score, and odd modes are refused', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'rhythm', level: 0, score: null, mode: 'gentle' } })).status, 204);
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'signal', level: 2, score: 812, mode: 'challenge' } })).status, 204);
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'signal', level: 2, score: 812, mode: 'turbo' } })).status, 400);
    const { results } = (await t.call('GET', '/api/profile', { cookie })).json.profile;
    assert.deepStrictEqual(results.map((r) => [r.game, r.score, r.mode]), [['rhythm', null, 'gentle'], ['signal', 812, 'challenge']]);
  } finally { await t.close(); }
});

test('a long-time player can keep saving: a full history stays under the size limit', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    const at = new Date().toISOString();
    const results = Array.from({ length: 500 }, (_, i) => ({ game: 'cloudpath', level: 12, score: 1234.5, mode: 'challenge', at, extra: 'dropped' }));
    const events = Array.from({ length: 300 }, () => ({ game: 'cloudpath', kind: 'play', at: Date.now(), applied: false }));
    const put = await t.call('PUT', '/api/profile', { cookie, body: { profile: { answers: { age: '45-59' }, model: { version: 1, delta: {}, events, dismissed: {} }, results } } });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.json.profile.results.length, 300, 'keeps the newest 300');
    assert.strictEqual(put.json.profile.results[0].extra, undefined, 'unknown fields in a result are dropped');
    assert.strictEqual((await t.call('POST', '/api/profile/result', { cookie, body: { game: 'lumen', level: 1, score: 6 } })).status, 204, 'and the next save still works');
  } finally { await t.close(); }
});

test('the play history is capped and oversized profiles are refused', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    const events = Array.from({ length: 400 }, (_, i) => ({ game: 'lumen', kind: 'play', at: i, applied: true }));
    const put = await t.call('PUT', '/api/profile', { cookie, body: { profile: { model: { version: 1, delta: {}, events, dismissed: {} } } } });
    assert.strictEqual(put.json.profile.model.events.length, 300);
    assert.strictEqual(put.json.profile.model.events[0].at, 100, 'keeps the newest');

    const huge = await t.call('PUT', '/api/profile', { cookie, body: { profile: { answers: { note: 'x'.repeat(100000) } } } });
    assert.strictEqual(huge.status, 413);
  } finally { await t.close(); }
});

test('deleting the account deletes its profile', async () => {
  const t = await start();
  try {
    const cookie = await t.signUp('sam@example.com');
    await t.call('PUT', '/api/profile', { cookie, body: { profile: { answers: { age: '18to44' } } } });
    await t.call('DELETE', '/api/auth/me', { cookie });
    const { rows } = await t.db.query('SELECT count(*)::int AS n FROM profiles');
    assert.strictEqual(rows[0].n, 0);
  } finally { await t.close(); }
});

test('with a data key, answers are encrypted in the database and still come back', async () => {
  const t = await start({ dataKey: require('crypto').randomBytes(32).toString('base64') });
  try {
    const cookie = await t.signUp('sam@example.com');
    await t.call('PUT', '/api/profile', { cookie, body: { profile: { answers: { cancer: 'breast-cancer-secret' } } } });
    const { rows } = await t.db.query('SELECT data FROM profiles');
    const stored = JSON.stringify(rows[0].data);
    assert.ok(!stored.includes('breast-cancer-secret'), 'the database never sees the answer in plain text');
    assert.ok(rows[0].data.enc && rows[0].data.enc.tag);
    const back = await t.call('GET', '/api/profile', { cookie });
    assert.strictEqual(back.json.profile.answers.cancer, 'breast-cancer-secret');
  } finally { await t.close(); }
});
