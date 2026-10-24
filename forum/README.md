# Chemoasis community forum

The moderated community forum. Plain HTML, CSS and JavaScript like the rest of the site.

It is **live and shared**: everyone signed in to Chemoasis uses the same forum, and posts are saved in Postgres. Anyone can read; posting needs an account. The starter conversations come from accounts marked "(example)", written by the team to show how the community works.

## How it works

- `assets/js/store.js` holds all the forum's rules (below). The server runs this same file against the shared forum, acting as the signed-in person (`server/forum.js`, `/api/forum`), so only what a person is allowed to see ever leaves the server.
- Pages call `Forum.store` from `assets/js/api-store.js`, which forwards each call to the server.
- Moderators are the accounts whose emails are listed in the `MODERATOR_EMAILS` environment variable (comma-separated). They see the review queue.
- Deleting a Chemoasis account takes that person's posts down.

## What it does

- **Categories:** introductions, sharing experiences, games and activities, ask a professional, using Chemoasis, ideas and feedback.
- **Conversations and replies,** with search, filters by game and training area, and sorting.
- **Post labels:** every post is a personal experience, general information (with a source link), or professional guidance (verified professionals only).
- **Safety check before posting:**
  - Possible unsafe medical claims (like "cures" or "stop your medication") are held for a moderator.
  - Crisis language shows the 988 Suicide & Crisis Lifeline.
  - Urgent symptoms point people to their care team or 911.
  - Phone numbers, emails or addresses get a privacy warning.
- **Reports:** anyone can report a post. If 3 different people report the same post, it's hidden until a moderator reviews it.
- **Review queue for moderators:** keep, hide or remove a post, with a note and a history of decisions. Hidden posts stay listed so a moderator can come back to them.
- **Profiles and privacy:** a nickname as your display name, a choice to show or hide your bio, posting anonymously (moderators can still see who posted), and a larger text option.
- **Badges:** verified professional, activity creator, moderator. The guidelines page says what each badge does and doesn't mean.
- **"Found this helpful":** labeled as people's opinion, never as proof that something works.
- **Edits:** authors can fix their own visible or held posts. Edits go through the same safety check, show "(edited)", and can't change the category or whether a post is anonymous.
- **Ask for another review:** an author can appeal a hidden or removed post once. It goes to the review queue, where a moderator can make it visible again.
- **Mute:** hides one person's named posts and replies from you only. Moderators and anonymous posts can't be muted (muting an anonymous post would give away who wrote it).
- **Saved drafts:** an unsent post or reply is kept in the browser per account, until it's posted or discarded.
- **Listen:** reads a post aloud with the browser's built-in voice, for people who'd rather hear than read.
- **Search** covers replies as well as titles and first posts.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `thread.html`, `new.html`, `profile.html`, `moderation.html`, `guidelines.html` | The pages |
| `assets/css/forum.css` | Forum styles. It loads `../../styles.css` first and reuses its colors and fonts. Every class starts with `f-`. |
| `assets/js/catalog.js` | Categories, labels, training areas, the six games, report reasons |
| `assets/js/store.js` | The forum's rules; run on the server against the shared forum, and by the tests |
| `assets/js/api-store.js` | What the pages use: forwards each `Forum.store` call to `/api/forum` |
| `assets/js/safety.js` | The safety check before posting |
| `assets/js/seed.js` | The example conversations the forum starts with |
| `assets/js/ui.js` | Shared header, badges and the report dialog |
| `assets/js/home.js`, `thread.js`, `new-post.js`, `profile.js`, `moderation.js`, `guidelines.js` | One script per page |
| `database/schema.sql` | **Draft** of separate Postgres tables with the same rules enforced in the database (a `forum_app` role and a per-request `forum.current_account` setting). Not used yet: the live forum is stored by `server/forum.js` |
| `tests/forum.test.js` | Checks the forum's rules (safety, privacy, moderation, edits, appeals, muting). Run `node forum/tests/forum.test.js` from the repo root. Needs only Node. |

## How it connects to the other parts

- **Games:** `assets/js/catalog.js` lists the six games with the same ids as the games and the recommender, so posts can be tagged and filtered by game.
- **Recommendations (Sahas):** `Forum.store.topicSignals(days)` returns how often each training area and game comes up in public conversations. It returns counts only: no user IDs and no post text. That matches the brief's rule that forum signals come from clear categories, not from reading people's posts.
- **Accounts:** the forum uses Chemoasis accounts (`server/`). Your forum name starts as your account name and can be changed on your profile.
- **Moving to `database/schema.sql` later:** the server would swap its one shared document for those tables; pages and `api-store.js` wouldn't change.

## Testing

- `node forum/tests/forum.test.js` runs 31 checks of the forum's rules in a few seconds, with no installs.
- The pages were also tested in a real browser (Chromium) on desktop and phone sizes, including the edit, appeal, mute and draft flows.
- `server/tests/forum.test.js` checks the live API: reading signed out, posting with an account, anonymous posts staying anonymous to others, moderators by email, saving to Postgres, and deleting an account.
- `database/schema.sql` was loaded into a scratch PostgreSQL 16 database and its rules were tested there (for example: anonymous authors stay hidden, held posts can't be released by their author, members can't post professional guidance, a post is auto-hidden after 3 different reporters, people can only appeal their own hidden posts once, reporters can't read moderator notes, and moderators can't be muted). `forum_needs_review` in `database/schema.sql` copies the hold patterns from `assets/js/safety.js`, so change both together.

## Not done yet

- Checking professional credentials. Only the example nurse account has the badge today; there's no way yet to verify a real professional.
- Notifications when someone replies.
- The brief says the moderation rules should be checked with qualified people before launch.
