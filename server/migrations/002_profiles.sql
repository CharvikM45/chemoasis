-- Each person's questionnaire answers, personal recommender model and game level progress.
-- One JSON document per account; deleting the account deletes it (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
