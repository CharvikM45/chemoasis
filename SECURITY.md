# Security

How Chemoasis handles each item on the security checklist (37–53), where the code is, and what still needs a person to do.

| # | Risk | What Chemoasis does | Where |
| --- | --- | --- | --- |
| 37 | Vulnerable dependencies | Four runtime packages (express, compression, pg, @anthropic-ai/sdk). CI runs `npm audit` on every push and pull request; Dependabot opens weekly update PRs. | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| 38 | Malicious packages | Exact versions locked in `package-lock.json` and installed with `npm ci`. three.js is self-hosted (copied unmodified from the official npm package, checksum in its README) instead of loaded from a CDN, so no third-party server can change the code the site runs. | `games/assets/vendor/three/` |
| 39 | Prompt injection | Only the Open Research Studio uses AI (Claude): the design assistant and the advisory read of a submission. What a creator typed is passed inside tags as data, and the instructions say never to follow it; the advisory read lists any instructions aimed at it as a concern for the reviewer. Answers must match a fixed JSON schema and are trimmed to set lengths. The advisory read is only advice: a person decides, and software can never publish. Sketches are kept only if they pass a strict SVG check, and are shown as images, where SVG can't run scripts. The recommender is a small, explainable model with fixed inputs, not AI. | `server/studio-ai.js`, `server/studio.js` |
| 40 | Unpermissioned AI access | Claude has no tools and no access to the database, accounts or site: it gets one submission's text and returns text. It's never sent emails, ORCID iDs, NPI numbers or anything from questionnaires, games or the community. `ANTHROPIC_API_KEY` is a Railway variable used only by the server. Calls are capped at 8 sketches an hour per person, 10 submissions a day per person, and 200 AI calls a day for the whole site. | `server/studio-ai.js`, `server/studio.js` |
| 41 | Excessive DB permissions | The app only runs fixed, parameterized queries on its own tables. **To do (needs Railway access):** connect as a dedicated role that owns only these tables instead of the default `postgres` superuser. | `server/` |
| 42 | Missing audit logs | Sign-ups, sign-ins, failed sign-ins, rate limits (once per address per window), sign-outs, account deletions, moderation decisions, Open Research Studio submissions, withdrawals and review decisions, and blocked cross-site requests are stored in `audit_log` with shortened IPs, and kept 180 days. | `server/audit.js`, `server/migrations/004_audit_log.sql` |
| 43 | No security monitoring | Every security event is also one JSON line in the server log (`"type":"security"`). 20 failed sign-ins from one address in 15 minutes logs an `"level":"alert"` line. Health check at `/api/health`. **To do:** set up a Railway log alert on `"level":"alert"`. | `server/audit.js` |
| 44 | No backups/restore | **To do (Railway dashboard):** Postgres service → Backups → turn on scheduled backups. Restoring: Backups → choose a backup → Restore. Note that profiles are encrypted, so keep `DATA_KEY` safe too (a backup can't be read without it). | |
| 45 | Exposed internal dashboards | There are no admin pages. The moderation and Studio review pages are public HTML, but their data comes only from the server, which checks the person is a moderator or reviewer (`MODERATOR_EMAILS`). Only the site folders are served, never `server/`, `.env` or `node_modules/`. | `server/forum.js`, `server/studio.js`, `server/app.js` |
| 46 | Missing security headers | Content Security Policy (scripts only from this site, inline scripts allowed by hash, no framing, no plugins), HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `no-store` on API responses. | `server/security.js` |
| 47 | Insecure cookie settings | The session cookie is `HttpOnly`, `SameSite=Lax`, and in production `Secure` with the `__Host-` prefix. It holds a random 32-byte token; only its SHA-256 hash is stored. | `server/sessions.js` |
| 48 | Unencrypted data | HTTPS everywhere (HSTS). Passwords are hashed with scrypt. Each person's profile (questionnaire answers, scores) is encrypted with AES-256-GCM before it's stored, using `DATA_KEY`. | `server/crypto-box.js`, `server/password.js` |
| 49 | Poor tenant isolation | Every profile query is scoped to the signed-in person's id from the session, never from the request. The forum runs each action as the signed-in person and returns only what they may see (anonymous authors stay hidden). Studio drafts can only be opened by their creator; reviewers see only what's been sent for review or published. Tests check one account can't read another's data. | `server/profile.js`, `server/forum.js`, `server/studio.js`, `server/tests/` |
| 50 | Unreviewed code | CI runs all tests on every push and pull request. **To do (GitHub settings):** protect `main` so changes need a pull request with a passing CI run and one approving review. | `.github/workflows/ci.yml` |
| 51 | Mass assignment | Sign-up reads only email, name, password and consent. Profiles keep only known fields, with size limits. Forum changes go through the forum's rules, which pick fields one by one. | `server/auth.js`, `server/profile.js` |
| 52 | Command injection | No shell commands anywhere. All database queries use parameters, never string building. | `server/` |
| 53 | Insecure deserialization | Only JSON is accepted (size-limited per route), and `__proto__` / `constructor` / `prototype` keys are dropped while parsing, so request data can't change object prototypes. | `server/security.js` |

## The 20 essential website checks

| # | Check | Status |
| --- | --- | --- |
| 1 | Hide API keys | The only third-party key, `ANTHROPIC_API_KEY`, is a Railway variable used only by the server. Nothing secret is sent to the browser. |
| 2 | Check env variables | Secrets live only in Railway variables. `.env` is in `.gitignore`; `.env.example` has placeholders only. |
| 3 | Check keys in git | The whole git history was scanned for database URLs with passwords, private keys and access tokens: none found. |
| 4 | Protect admin routes | No admin routes. Moderator actions are checked on the server (`MODERATOR_EMAILS`). |
| 5 | Add auth | Accounts with scrypt-hashed passwords and server-side sessions. |
| 6 | Check user perms | Every profile request is scoped to the signed-in person; forum actions run as that person; moderation needs the moderator role. |
| 7 | Sanitize user inputs | Server-side checks on every field: email format, name length and control characters, password length, questionnaire answers must be short text or numbers, forum posts go through the forum's length and safety checks. |
| 8 | Protect against XSS | User text is always escaped or set as text, never as HTML, and the Content Security Policy blocks inline and outside scripts. Tested by posting `<script>`, `<img onerror>` and `<svg onload>`: none ran. |
| 9 | SQL injection protection | Every query uses parameters; no SQL is built from user input. |
| 10 | Check DB rules | Unique emails, foreign keys that delete a person's sessions and profile with their account. `forum/database/schema.sql` drafts row-level rules for the forum. |
| 11 | Add rate limiting | Sign-up, sign-in, posting and an overall per-IP API limit. |
| 12 | Set spend cap | **To do (Railway dashboard):** Workspace → Usage → set a usage limit. |
| 13 | Secure file uploads | The Open Research Studio takes one HTML prototype (up to 300 KB, a bigger one is turned away) as text inside a JSON request; nothing is written to disk. It's served only by the API, with a sandbox policy: an origin of its own with no cookies or access to the site, no internet, no storage, no forms or pop-ups, and only this site can frame it. Mock-ups must pass a strict SVG check and are shown only as images. |
| 14 | CSRF protection | `SameSite=Lax` cookies, and state-changing requests are refused if their Origin is another site or the browser marks them `Sec-Fetch-Site: cross-site`. |
| 15 | Check CORS settings | No CORS headers at all, so other websites can't read API responses. |
| 16 | Enable HTTPS | HTTPS on Railway, HTTP redirected to HTTPS (by Railway and by the app), HSTS for a year. |
| 17 | Add security headers | See #46 above. |
| 18 | Secure cookies | See #47 above. |
| 19 | Disable debug mode | Express runs in production mode on Railway; errors return a generic message and details go only to the server log (tested). |
| 20 | Check prod settings | `NODE_ENV=production`, `DATA_KEY` set, database on Railway's private network. `PGSSL` is only for local development over Railway's public proxy, so leave it unset on Railway. |

## Also in place

- Rate limits: sign-up and sign-in (per IP and per account), forum posting (per account), and an overall API limit per IP.
- Requests that change data are refused if they come from another website (Origin check).
- Wrong email and wrong password get the same message and take the same time.
- Deleting an account deletes its profile, sessions, settings and Open Research Studio submissions (published ones too), and takes its forum posts down with their words erased.

## Environment variables

| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection (on Railway: `${{Postgres.DATABASE_URL}}`) |
| `DATA_KEY` | 32 random bytes, base64, for encrypting profiles. **If it's lost, encrypted profiles can't be read.** Keep a copy somewhere safe, like a password manager. |
| `MODERATOR_EMAILS` | Comma-separated emails of community moderators, who are also the Open Research Studio's reviewers |
| `ALLOWED_ORIGINS` | Optional. Other websites (comma-separated) allowed to send requests that change data, for example a preview deploy. Leave empty when the site and server share one address. |
| `ANTHROPIC_API_KEY` | Optional. Turns on the Studio's design assistant and advisory read. Paid, so an adult's account. Without it, the rest of the Studio still works. |
| `NODE_ENV` | `production` on Railway |

## Reporting a problem

Please don't post security problems in the community. Tell the team directly.
