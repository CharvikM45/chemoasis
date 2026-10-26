// Security audit log and monitoring.
//   audit(db, req, event, { userId, detail }): stores the event and writes one JSON line to the
//   server log (Railway keeps these). Repeated failed sign-ins from one address also log an alert.
// Never logs passwords, tokens or questionnaire answers.

const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_ALERT_AT = 20;
const failures = new Map(); // shortened IP -> { count, since }

// 203.0.113.45 -> 203.0.113.0 ; 2001:db8:1:2::5 -> 2001:db8:1::
function shortIp(ip) {
  if (!ip) return null;
  const v4 = String(ip).replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0');
  return String(ip).split(':').slice(0, 3).join(':') + '::';
}

function log(level, fields) {
  const line = JSON.stringify({ type: 'security', level, at: new Date().toISOString(), ...fields });
  if (level === 'alert') console.error(line); else console.log(line);
}

async function audit(db, req, event, { userId = null, detail = null } = {}) {
  const ip = shortIp(req && req.ip);
  log('info', { event, userId, ip, detail });
  if (event === 'login_failed') {
    const now = Date.now();
    const entry = failures.get(ip);
    const fresh = !entry || now - entry.since > FAIL_WINDOW_MS;
    const next = fresh ? { count: 1, since: now } : { count: entry.count + 1, since: entry.since };
    failures.set(ip, next);
    // Forget addresses whose window has passed, so the count can't grow without end.
    if (fresh && failures.size > 1000) for (const [key, value] of failures) if (now - value.since > FAIL_WINDOW_MS) failures.delete(key);
    if (next.count === FAIL_ALERT_AT) log('alert', { event: 'many_failed_logins', ip, count: next.count, minutes: 15 });
  }
  try {
    await db.query('INSERT INTO audit_log (event, user_id, ip, detail) VALUES ($1, $2, $3, $4::jsonb)', [event, userId, ip, detail ? JSON.stringify(detail) : null]);
  } catch (error) {
    log('alert', { event: 'audit_write_failed', message: error.message }); // never block the request over the log
  }
}

async function removeOldAudit(db) {
  await db.query("DELETE FROM audit_log WHERE at < now() - interval '180 days'");
}

module.exports = { audit, removeOldAudit, shortIp };
