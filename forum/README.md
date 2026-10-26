# Chemoasis community forum

The moderated community forum. Plain HTML, CSS and JavaScript like the rest of the site.

It is **live, shared and members-only**: everyone signed in to Chemoasis uses the same forum, and posts are saved in Postgres. People share health experiences here, so reading and posting both need an account. Signed out, the pages show a sign-in card instead of posts; only the community guidelines are public. The live forum holds real members only. The made-up "(example)" accounts and posts appear only in the demo.

## How it works

- `assets/js/store.js` holds all the forum's rules (below). The server runs this same file against the shared forum, acting as the signed-in person (`server/forum.js`, `/api/forum`), so only what a person is allowed to see ever leaves the server.
- Pages call `Forum.store` from `assets/js/api-store.js`. It picks one of three modes when a page loads:
  - **Live:** on the Chemoasis server, each call goes to `/api/forum`.
  - **Demo:** opened as plain files, or on a host without the server. The forum runs in the browser with the example posts, saved only in that browser, plus a demo account switcher and a reset button. A banner says it's a demo.
  - **Offline:** the server is there but not answering. Pages say the community can't be reached, instead of quietly showing demo posts on the real site.
- Moderators are the accounts whose emails are listed in the `MODERATOR_EMAILS` environment variable (comma-separated). They see the review queue.
- A new forum profile starts with a neutral name like "Member 4821", never the account's own name. People choose the name others see on their profile.
- Deleting a Chemoasis account erases what that person wrote, not just hides it: post text, titles, links, report notes, helpful marks and mutes. Open reports on their posts are closed. The profile stays as "Former member" with nothing personal in it, so the moderation history still makes sense.

## What it does

- **Categories:** introductions, sharing experiences, games and activities, questions for the community, using Chemoasis, ideas and feedback, and anything else.
- **Conversations and replies,** with search, filters by game and training area, and sorting.
- **Post labels:** every post is a personal experience, general information (with a source link), or professional guidance (verified professionals only; no account has it, and the guidelines don't offer it until there's a way to check credentials).
- **Safety check before posting** (`assets/js/safety.js`):
  - Possible unsafe medical claims (like "cures" or "stop your medication") are held for a moderator.
  - Crisis language (like "I want to die" or "I can't go on") shows the 988 Suicide & Crisis Lifeline. The post stays up, and it goes to the top of the review queue marked "This person may need support".
  - A fever during chemo (100.4°F / 38°C or higher) points people to their doctor right away, following the [CDC's advice](https://www.cdc.gov/cancer/features/preventing-infections.html).
  - Other urgent symptoms point people to their care team or 911.
  - Phone numbers, emails or addresses get a privacy warning.
- **Reports:** anyone can report a post. If 3 different people report it as breaking the guidelines, it's hidden until a moderator reviews it. Only accounts at least 2 days old count toward hiding, so one person can't make a few new accounts to hide a post; every report still reaches the moderators. "Someone may need support" reports and the automatic safety reports never count toward hiding a post, so asking for help for someone can't take their post down.
- **Review queue for moderators:** keep, hide or remove a post, with a note and a history of decisions. Posts where someone may need support come first. Moderators see how many posts are waiting next to "Review queue" on every forum page (blue when someone may need support), and the server writes a `support_needed` line to its log for each such post (the post's id only, never its words or author). Hidden posts stay listed so a moderator can come back to them.
- **Profiles and privacy:** a nickname as your display name, a choice to show or hide your bio, posting anonymously (moderators can still see who posted), and a larger text option.
- **Badges:** verified professional, activity creator, moderator. The guidelines page says what each badge does and doesn't mean.
- **"Found this helpful":** labeled as people's opinion, never as proof that something works.
- **Edits:** authors can fix their own visible or held posts. Edits go through the same safety check, show "(edited)", and can't change the category or whether a post is anonymous.
- **Ask for another review:** an author can appeal a hidden or removed post once. It goes to the review queue, where a moderator can make it visible again.
- **Mute:** hides one person's named posts and replies from you only. Moderators and anonymous posts can't be muted (muting an anonymous post would give away who wrote it).
- **Saved drafts:** an unsent post or reply is kept in the browser per account, until it's posted or discarded.
- **Listen:** reads a post aloud with the browser's built-in voice, for people who'd rather hear than read.
- **Search** covers replies as well as titles and first posts.

## If someone may be in danger (for moderators)

The review queue marks these posts "This person may need support". Moderators aren't a crisis service, and you don't have to handle this alone.

1. Keep the post up unless it breaks the guidelines. Taking it down can feel like being shut out.
2. Reply kindly, and share the 988 Suicide & Crisis Lifeline: call or text 988 in the US, or chat at [988lifeline.org](https://988lifeline.org/).
3. If the post says they are in danger right now, tell them to call 911.
4. Tell a parent or teacher who helps with Chemoasis straight away.
5. You can call or text 988 yourself for advice on how to help someone else.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `thread.html`, `new.html`, `profile.html`, `moderation.html`, `guidelines.html` | The pages |
| `assets/css/forum.css` | Forum styles, matching the dark home page. Self-contained: it doesn't load the home page's stylesheets. Every class starts with `f-`. |
| `assets/js/catalog.js` | Categories, labels, training areas, the six games, report reasons. The game tags must match `account/assets/js/recommender.js`; a test checks this. |
| `assets/js/store.js` | The forum's rules; run on the server against the shared forum, in the browser in demo mode, and by the tests |
| `assets/js/api-store.js` | What the pages use: live, demo or offline, as above |
| `assets/js/safety.js` | The safety check before posting |
| `assets/js/seed.js` | The example conversations the demo starts with (the live forum starts empty). There's no example professional on purpose: a made-up "verified" nurse giving guidance would mislead people. |
| `assets/js/ui.js` | Shared header, sign-in card, badges and the report dialog |
| `assets/js/home.js`, `thread.js`, `new-post.js`, `profile.js`, `moderation.js`, `guidelines.js` | One script per page |
| `database/schema.sql` | **Draft, not used yet.** Separate Postgres tables with the same rules enforced by the database itself, tied to the real `users` table. It fails closed: a connection that doesn't name a signed-in person (or say it's a trusted admin script) can't change anything. |
| `tests/forum.test.js` | Checks the forum's rules (safety, privacy, moderation, edits, appeals, muting). Run `node forum/tests/forum.test.js` from the repo root. Needs only Node. |

## How it connects to the other parts

- **Games:** `assets/js/catalog.js` lists the six games with the same ids and training areas as the games and the recommender, so posts can be tagged and filtered by game.
- **Recommendations (Sahas):** `Forum.store.topicSignals(days)` returns how often each training area and game comes up in public conversations by real members. It returns counts only: no user IDs and no post text. Example posts are left out, so they can't skew anyone's suggestions.
- **Accounts:** the forum uses Chemoasis accounts (`server/`). Deleting an account erases the person's forum posts too.
- **Moving to `database/schema.sql` later:** the server would swap its one shared document for those tables; pages and `api-store.js` wouldn't change.

## Running it

- **Run one server instance.** The server keeps the forum in memory and saves the whole thing after each change, so two copies running at once would overwrite each other's posts.
- Set `MODERATOR_EMAILS` before launch, or nobody can see the review queue.
- Example posts saved by an earlier version are removed from the live forum when the server starts. An example conversation that real members replied to stays, so nobody's reply disappears.

## Testing

- `npm test` runs everything. `node forum/tests/forum.test.js` runs 48 checks of the forum's rules in a few seconds, with no installs.
- `server/tests/forum.test.js` checks the live API: signed-out visitors can't read, posting with an account, anonymous posts staying anonymous to others, neutral starting names, moderators by email, saving to Postgres, deleting an account erasing its words, example posts staying off the live forum, and the log alert when a post may need support.
- The pages were checked in a real browser (Chromium) in demo and live mode, on desktop and phone sizes.
- `database/schema.sql` was loaded into PostgreSQL 16 on top of the accounts tables, and its rules were checked there (for example: writes with no signed-in person are refused, anonymous authors stay hidden, held posts can't be released by their author, and members can't post professional guidance). `forum_needs_review` and `forum_needs_support` copy the phrase lists in `assets/js/safety.js`, so change both together.

## Before launch

- Have qualified people check the moderation rules and the safety wording, as the brief says.
- Agree who moderates and when, and add their emails to `MODERATOR_EMAILS`.
- Set up an alert in Railway on log lines with `"event":"support_needed"`, so a moderator hears about a post from someone who may need support quickly.
- Decide how to check a real professional's credentials before giving the badge. No account has it today.
- Notifications when someone replies aren't built yet.
