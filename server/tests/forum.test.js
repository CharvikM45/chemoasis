// Forum API tests: the shared forum, run as real accounts, against pg-mem. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { migrate } = require('../db');
const { createApp } = require('../app');

async function start() {
  const { Pool } = newDb().adapters.createPg();
  const db = new Pool();
  await migrate(db);
  const app = createApp({ db, isProd: false, moderators: ['mod@example.com'] });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, cookie } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  const forum = (method, args, cookie) => call('POST', '/api/forum/' + method, { body: { args }, cookie });
  const signUp = async (email, name) => (await call('POST', '/api/auth/signup', { body: { email, name, password: 'gentle-steps-42', consent: true } })).cookie;
  return { db, call, forum, signUp, close: () => new Promise((r) => server.close(r)) };
}

test('anyone can read; posting needs an account', async () => {
  const t = await start();
  try {
    const list = await t.forum('listThreads', [{}]);
    assert.strictEqual(list.status, 200);
    assert.ok(list.json.result.length > 0, 'the example posts are there');
    assert.strictEqual((await t.forum('currentUser', [])).json.result, null);
    const post = await t.forum('createThread', [{ categoryId: 'welcome', title: 'Hello there', body: 'Hi all' }]);
    assert.strictEqual(post.status, 401);
    assert.strictEqual((await t.forum('resetDemo', [])).status, 404, 'demo-only methods are not reachable');
    assert.strictEqual((await t.forum('switchDemoUser', ['u-river'])).status, 404);
  } finally { await t.close(); }
});

test('a post by one account is seen by another, and anonymous stays anonymous', async () => {
  const t = await start();
  try {
    const maya = await t.signUp('maya@example.com', 'Maya');
    const sam = await t.signUp('sam@example.com', 'Sam');
    const me = (await t.forum('currentUser', [], maya)).json.result;
    assert.strictEqual(me.displayName, 'Maya');
    const made = await t.forum('createThread', [{ categoryId: 'welcome', title: 'First week back', body: 'Small steps today.', anonymous: true }], maya);
    assert.strictEqual(made.status, 200);
    const seen = (await t.forum('getThread', [made.json.result.id], sam)).json.result;
    assert.strictEqual(seen.thread.title, 'First week back');
    assert.strictEqual(seen.thread.author.displayName, 'Anonymous member');
    assert.strictEqual(seen.thread.author.id, null, "Sam can't tell who wrote it");
    const own = (await t.forum('getThread', [made.json.result.id], maya)).json.result;
    assert.strictEqual(own.thread.isOwn, true);
  } finally { await t.close(); }
});

test('the forum is saved in the database', async () => {
  const t = await start();
  try {
    const maya = await t.signUp('maya@example.com', 'Maya');
    await t.forum('createThread', [{ categoryId: 'welcome', title: 'Saved post', body: 'Still here?' }], maya);
    const { rows } = await t.db.query('SELECT data FROM forum_state WHERE id = 1');
    assert.ok(rows[0].data.threads.some((x) => x.title === 'Saved post'));
    assert.strictEqual(rows[0].data.currentUserId, null);
  } finally { await t.close(); }
});

test('moderators are set by email, and only they see the review queue', async () => {
  const t = await start();
  try {
    const member = await t.signUp('maya@example.com', 'Maya');
    const mod = await t.signUp('mod@example.com', 'Riley');
    assert.strictEqual((await t.forum('moderationQueue', [], member)).status, 400);
    const queue = await t.forum('moderationQueue', [], mod);
    assert.strictEqual(queue.status, 200);
    assert.ok(Array.isArray(queue.json.result));
  } finally { await t.close(); }
});

test('deleting an account takes its posts down', async () => {
  const t = await start();
  try {
    const maya = await t.signUp('maya@example.com', 'Maya');
    const sam = await t.signUp('sam@example.com', 'Sam');
    const made = await t.forum('createThread', [{ categoryId: 'welcome', title: 'Goodbye post', body: 'Testing deletion' }], maya);
    await t.call('DELETE', '/api/auth/me', { cookie: maya });
    const after = await t.forum('getThread', [made.json.result.id], sam);
    assert.strictEqual(after.status, 400, 'the post is gone');
  } finally { await t.close(); }
});
