-- Research Studio: activities submitted by clinicians and researchers. Each one is a draft until
-- it's sent for review; automatic checks can send it back, but only a reviewer can publish it.
-- Deleting an account deletes that person's submissions, published ones included.

CREATE TABLE IF NOT EXISTS studio_submissions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft', -- draft, review, changes, published, rejected, withdrawn
  data jsonb NOT NULL,                  -- the activity, research, creator details and agreement
  prototype text NOT NULL DEFAULT '',   -- the playable HTML, if there is one
  checks jsonb,                         -- results of the automatic checks at the last submit
  decision jsonb,                       -- the reviewer's last decision and note
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS studio_submissions_user_idx ON studio_submissions (user_id);
CREATE INDEX IF NOT EXISTS studio_submissions_status_idx ON studio_submissions (status);
