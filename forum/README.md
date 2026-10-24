# Chemoasis community forum

The moderated community forum from section 5 of the concept brief. It's plain HTML, CSS and JavaScript like the rest of the site, and it lives in its own folder so it doesn't touch the landing page.

Everything in it is **made-up demo data** saved in your own browser. No real accounts, posts or health information.

## Try it

Open `forum/index.html` in a browser, or visit `/forum/` once the site is on Vercel. No build step.

Use the **Demo account** menu (top right) to switch between made-up people:

| Account | Shows |
| --- | --- |
| River, Alex, June (demo) | Regular members |
| Sam (demo creator) | Activity creator badge |
| Demo Oncology Nurse | Verified professional badge and the "Professional guidance" label |
| Moderator (demo) | The review queue |

"Reset demo data" on your own profile page puts the original posts back.

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
| `assets/js/catalog.js` | Categories, labels, training areas, **placeholder game IDs**, report reasons |
| `assets/js/store.js` | All saving and loading. Pages only talk to this file. |
| `assets/js/safety.js` | The safety check before posting |
| `assets/js/seed.js` | The made-up demo data |
| `assets/js/ui.js` | Shared header, badges and the report dialog |
| `assets/js/home.js`, `thread.js`, `new-post.js`, `profile.js`, `moderation.js`, `guidelines.js` | One script per page |
| `database/schema.sql` | **Draft** database tables and access rules for the Railway (Postgres) backend (not run anywhere yet) |
| `tests/forum.test.js` | Checks the forum's rules (safety, privacy, moderation, edits, appeals, muting). Run `node forum/tests/forum.test.js` from the repo root. Needs only Node. |

`store.js`, `safety.js`, `catalog.js` and `seed.js` (under `assets/js/`) don't touch the page at all, so they can move into the React Native app later as they are.

## How it connects to the other parts

- **Game library (Charvik):** `assets/js/catalog.js` has placeholder games. Real game IDs aren't needed (decided 2026-10-24), so these placeholder tags stay.
- **Recommendations (Sahas):** `Forum.store.topicSignals(days)` returns how often each training area and game comes up in public conversations. It returns counts only: no user IDs and no post text. That matches the brief's rule that forum signals come from clear categories, not from reading people's posts.
- **Accounts (Railway, Sahas):** today the forum uses demo accounts. When sign-in is ready, replace the function bodies in `assets/js/store.js` with calls to the Railway backend. `database/schema.sql` is a starting draft of the Postgres tables and access rules, written for plain Postgres (no Supabase): it uses a `forum_app` role and a per-request `forum.current_account` setting instead of Supabase Auth. Its header explains how the API server wires that up.

## Testing

- `node forum/tests/forum.test.js` runs 31 checks of the forum's rules in a few seconds, with no installs.
- The pages were also tested in a real browser (Chromium) on desktop and phone sizes, including the edit, appeal, mute and draft flows.
- `database/schema.sql` was loaded into a scratch PostgreSQL 16 database and its rules were tested there (for example: anonymous authors stay hidden, held posts can't be released by their author, members can't post professional guidance, a post is auto-hidden after 3 different reporters, people can only appeal their own hidden posts once, reporters can't read moderator notes, and moderators can't be muted).
- The database repeats the app's key rules itself, so a modified app can't skip them: the unsafe-claim hold, "professional guidance" for verified professionals only, auto-hide after 3 reports, and only moderators changing whether a post is visible. `forum_needs_review` in `database/schema.sql` copies the hold patterns from `assets/js/safety.js`, so change both together.

## Not done yet

- Real sign-in and storage (waiting on the Railway backend from Sahas).
- Checking professional credentials for real. Today the badge is demo data.
- Notifications when someone replies.
- The brief says the moderation rules should be checked with qualified people before launch.
