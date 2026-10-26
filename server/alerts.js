// Sends alerts to people, not only to the server log. When ALERT_WEBHOOK_URL is set (a Discord or
// Slack incoming webhook), every alert line (many failed sign-ins, someone who may need support,
// a missing DATA_KEY, a failed audit write) is also posted there, so the team hears about it.
//
// A message holds only what happened and where to look: never names, emails, post text or IP
// addresses. Repeats of the same alert are held back for a while so a burst can't flood the
// channel, except "someone may need support", where every post counts (up to an hourly cap).
// Sending never blocks or breaks the request that raised the alert.

const MESSAGES = {
  support_needed: 'A community post may come from someone who needs support. Please check the forum review queue (/forum/moderation.html) soon.',
  many_failed_logins: 'Many failed sign-ins from one address in the last 15 minutes. Someone may be guessing passwords.',
  no_data_key: 'DATA_KEY is not set on the server, so profiles are being stored unencrypted.',
  audit_write_failed: 'The security audit log could not be written. Check the database.'
};
const QUIET_MS = 10 * 60 * 1000; // the same alert at most once per 10 minutes (support_needed excepted)
const HOURLY_CAP = 30; // no more than this many messages an hour, whatever happens

function createAlerts({ url = process.env.ALERT_WEBHOOK_URL, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const target = /^https:\/\//.test(url || '') ? url : null;
  const lastSent = new Map(); // event -> time
  let hour = { since: 0, count: 0 };

  function send(event, extra = {}) {
    if (!target || !fetchImpl) return Promise.resolve(false);
    const t = now();
    if (event !== 'support_needed' && lastSent.has(event) && t - lastSent.get(event) < QUIET_MS) return Promise.resolve(false);
    if (t - hour.since > 60 * 60 * 1000) hour = { since: t, count: 0 };
    if (hour.count >= HOURLY_CAP) return Promise.resolve(false);
    lastSent.set(event, t);
    hour.count += 1;
    const text = `Chemoasis alert (${event}): ${MESSAGES[event] || 'See the server log for details.'}${extra.postId ? ` Post: ${String(extra.postId).slice(0, 40)}.` : ''}`;
    // "content" is what Discord reads, "text" what Slack reads.
    return fetchImpl(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text }),
      signal: AbortSignal.timeout(5000)
    }).then((res) => res.ok, (error) => {
      console.error(JSON.stringify({ type: 'security', level: 'warn', at: new Date().toISOString(), event: 'alert_send_failed', message: error.message }));
      return false;
    });
  }

  return { send, enabled: Boolean(target) };
}

const alerts = createAlerts();

module.exports = { createAlerts, alerts };
