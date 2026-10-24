-- Security audit log: sign-ins, failed sign-ins, sign-ups, account deletions, moderation
-- decisions and blocked requests. IPs are shortened (last part removed) before they're stored.
-- Rows older than 180 days are removed by the hourly cleanup.

CREATE TABLE IF NOT EXISTS audit_log (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,
  user_id uuid,
  ip text,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at);
CREATE INDEX IF NOT EXISTS audit_log_event_idx ON audit_log (event);
