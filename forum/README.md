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
- **Review queue for moderators:** keep, hide or remove a post, with a note and a history of decisions.
- **Profiles and privacy:** a nickname as your display name, a choice to show or hide your bio, posting anonymously (moderators can still see who posted), and a larger text option.
- **Badges:** verified professional, activity creator, moderator. The guidelines page says what each badge does and doesn't mean.
- **"Found this helpful":** labeled as people's opinion, never as proof that something works.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `thread.html`, `new.html`, `profile.html`, `moderation.html`, `guidelines.html` | The pages |
| `forum.css` | Forum styles. It loads `../styles.css` first and reuses its colors and fonts. Every class starts with `f-`. |
| `js/catalog.js` | Categories, labels, training areas, **placeholder game IDs**, report reasons |
| `js/store.js` | All saving and loading. Pages only talk to this file. |
| `js/safety.js` | The safety check before posting |
| `js/seed.js` | The made-up demo data |
| `js/ui.js` | Shared header, badges and the report dialog |
| `js/home.js`, `thread.js`, `new-post.js`, `profile.js`, `moderation.js`, `guidelines.js` | One script per page |
| `supabase/schema.sql` | **Draft** database tables for when Supabase is ready (not run anywhere) |

`store.js`, `safety.js`, `catalog.js` and `seed.js` don't touch the page at all, so they can move into the React Native app later as they are.

## How it connects to the other parts

- **Game library (Charvik):** `js/catalog.js` has placeholder games. Swap in the library's real game IDs and names, and the forum's game tags and filters follow.
- **Recommendations (Sahas):** `Forum.store.topicSignals(days)` returns how often each training area and game comes up in public conversations. It returns counts only: no user IDs and no post text. That matches the brief's rule that forum signals come from clear categories, not from reading people's posts.
- **Accounts (Supabase, Sahas):** today the forum uses demo accounts. When sign-in is ready, replace the function bodies in `js/store.js` with Supabase calls. `supabase/schema.sql` is a starting draft of the tables and access rules.

## Not done yet

- Real sign-in and storage (waiting on Supabase).
- Checking professional credentials for real. Today the badge is demo data.
- An appeals process for moderation decisions.
- Notifications when someone replies.
- The brief says the moderation rules should be checked with qualified people before launch.
