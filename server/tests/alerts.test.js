// Alerts to the team's chat (alerts.js), with the webhook replaced by a stand-in. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { createAlerts } = require('../alerts');

function fakeWebhook({ fail = false } = {}) {
  const sent = [];
  const impl = async (url, options) => {
    if (fail) throw new Error('webhook down');
    sent.push({ url, body: JSON.parse(options.body) });
    return { ok: true };
  };
  return { sent, impl };
}

test('nothing is sent unless a https webhook is set', async () => {
  const hook = fakeWebhook();
  assert.strictEqual(createAlerts({ url: '', fetchImpl: hook.impl }).enabled, false);
  assert.strictEqual(await createAlerts({ url: 'http://example.com/hook', fetchImpl: hook.impl }).send('many_failed_logins'), false);
  assert.strictEqual(hook.sent.length, 0);
});

test('an alert reaches the webhook with what happened and nothing personal', async () => {
  const hook = fakeWebhook();
  const alerts = createAlerts({ url: 'https://example.com/hook', fetchImpl: hook.impl });
  assert.strictEqual(await alerts.send('support_needed', { postId: 't-abc123' }), true);
  const { body } = hook.sent[0];
  assert.match(body.content, /support/i);
  assert.match(body.content, /t-abc123/);
  assert.strictEqual(body.text, body.content, 'readable by both Discord and Slack');
  assert.doesNotMatch(body.content, /@|\d+\.\d+\.\d+\.\d+/, 'no emails or IP addresses');
});

test('repeats of the same alert are held back, but every support alert goes through', async () => {
  let t = 0;
  const hook = fakeWebhook();
  const alerts = createAlerts({ url: 'https://example.com/hook', fetchImpl: hook.impl, now: () => t });
  await alerts.send('many_failed_logins');
  await alerts.send('many_failed_logins');
  assert.strictEqual(hook.sent.length, 1, 'the second is within 10 minutes');
  t += 11 * 60 * 1000;
  await alerts.send('many_failed_logins');
  assert.strictEqual(hook.sent.length, 2);
  await alerts.send('support_needed', { postId: 'a' });
  await alerts.send('support_needed', { postId: 'b' });
  assert.strictEqual(hook.sent.length, 4, 'each post that may need support is its own message');
});

test('no more than 30 messages an hour', async () => {
  const hook = fakeWebhook();
  const alerts = createAlerts({ url: 'https://example.com/hook', fetchImpl: hook.impl, now: () => 0 });
  for (let i = 0; i < 40; i++) await alerts.send('support_needed', { postId: 'p' + i });
  assert.strictEqual(hook.sent.length, 30);
});

test('a webhook that is down never throws', async () => {
  const alerts = createAlerts({ url: 'https://example.com/hook', fetchImpl: fakeWebhook({ fail: true }).impl });
  assert.strictEqual(await alerts.send('audit_write_failed'), false);
});
