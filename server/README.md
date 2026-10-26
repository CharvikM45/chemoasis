# Account server

A small Node server that serves the Chemoasis website and the account API, deployed as one Railway service next to the Postgres database. Same address for both, so the sign-in cookie is a normal first-party cookie.

## API

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/auth/signup` | `{ email, name, password }` → creates the account and signs in |
| POST | `/api/auth/login` | `{ email, password }` → signs in |
| POST | `/api/auth/logout` | Ends this session |
| GET | `/api/auth/me` | The signed-in person, or 401 |
| DELETE | `/api/auth/me` | Deletes the account, its sessions and its profile |
| GET | `/api/profile` | The signed-in person's questionnaire answers, recommender model and level progress |
| PUT | `/api/profile` | `{ profile }` → replaces them (unknown fields dropped, play history capped at 300, 96 KB max) |
| POST | `/api/profile/play` | `{ game }` → logs a play for the recommender |
| POST | `/api/profile/level` | `{ game, level }` → records a finished level |
| POST | `/api/profile/result` | `{ game, level, score }` → one point on that game's progress chart |
| POST | `/api/forum/:method` | `{ args }` → runs one forum action (see `forum/README.md`) as the signed-in person. Reading needs an account too; signed out, only `currentUser` answers (with `null`) |
| GET | `/api/studio/published` | Open Research Studio activities a reviewer has published, with the creator's credit (public) |
| GET | `/api/studio/play/:id` | A published activity's game, in a sandbox: its own origin, no internet, no storage, framed only by this site |
| GET/POST | `/api/studio/mine` | The signed-in creator's submissions / start a new draft `{ data, code }` (a prototype over 300 KB gets a 413, never cut short) |
| GET/PUT/DELETE | `/api/studio/mine/:id` | Read, save or delete a draft |
| POST | `/api/studio/mine/:id/submit` | Runs the automatic checks (ORCID, NPI, Crossref, PubMed, wording, prototype). A record that doesn't exist sends it back; otherwise it waits for a reviewer |
| POST | `/api/studio/mine/:id/withdraw` | Takes a submission back, and a published activity down |
| POST | `/api/studio/sketch` | `{ description }` → the design assistant's SVG mock-up (needs `ANTHROPIC_API_KEY`) |
| GET | `/api/studio/review` | Reviewers only (`MODERATOR_EMAILS`): everything waiting (oldest first), then what's published (newest first), with checks and the advisory read. Prototypes open from `/api/studio/review/:id/prototype` |
| POST | `/api/studio/review/:id` | Reviewers only: `{ decision: publish \| changes \| reject \| unpublish, note, submittedAt }`. `submittedAt` is the version the reviewer read; if the creator has sent a newer one, the answer is 409. Recorded in the audit log; nobody reviews their own |
| GET | `/api/health` | Checks the database connection (Railway health check) |

## Security built in

- Passwords hashed with scrypt and a per-user salt; plain passwords are never stored or logged.
- Sessions are 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` and `__Host-` in production). Only a SHA-256 hash of the token is stored, so a database leak can't be used to sign in. Sessions last 30 days; expired ones are cleaned up hourly.
- Requests that change things are refused if they come from another website (Origin check).
- Sign-in attempts are limited per account and per IP; sign-ups per IP.
- A wrong email and a wrong password get the same message and take the same time.
- Every response has security headers (`security.js`): a content security policy that runs only this site's scripts (inline ones by hash) and allows Google Fonts, no framing by other sites (stops clickjacking), `nosniff`, a referrer policy, and HTTPS-only (HSTS) in production. The 3D library (three.js) is served from `games/assets/vendor/`, not from an outside server. `SECURITY.md` lists every security check and what's left.
- Request bodies are capped per route: 10 KB for sign-in, 32 KB for the forum, 128 KB for profiles and 1 MB for the Studio (a prototype and a mock-up). Only the site folders are served, never `server/`, `node_modules/`, `.git/` or `.env`.
- Tables are created by migrations in `migrations/`, which run on startup.

## Open Research Studio and Claude

The Studio's design assistant and its advisory review of submissions use Claude (`studio-ai.js`), and only run when `ANTHROPIC_API_KEY` is set. Without it, everything else works and the pages say the assistant isn't on yet. The advisory review never decides anything: only a reviewer can publish. Calls are capped per person and at 200 a day for the whole site, so the bill can't run away.

## Run it locally

1. `npm install`
2. Copy `.env.example` to `.env` and paste your Railway Postgres **public** URL as `DATABASE_URL`.
3. `npm start`, then open http://localhost:3000/account/

## Tests

`npm test` runs the account tests (against an in-memory Postgres, no real database needed), the recommender tests and the forum tests.

## Not done yet

- Email verification and "forgot password" (both need an email service).
- The steps in `SECURITY.md` that need a person: Railway backups and a log alert, a database role of its own, branch protection on `main` and a spend cap.
- The sign-in limits are kept in memory, which is fine for one Railway instance. With several replicas, move them to Postgres or Redis.
