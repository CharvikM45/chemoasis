-- The community forum: one shared document with every profile, post, reply, report and setting.
-- server/forum.js runs the forum's rules (forum/assets/js/store.js) against it.

CREATE TABLE IF NOT EXISTS forum_state (
  id integer PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
