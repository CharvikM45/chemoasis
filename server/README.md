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
| PUT | `/api/profile` | `{ profile }` → replaces them (unknown fields dropped, play history capped at 300, 48 KB max) |
| POST | `/api/profile/play` | `{ game }` → logs a play for the recommender |
| POST | `/api/profile/level` | `{ game, level }` → records a finished level |
| POST | `/api/profile/result` | `{ game, level, score }` → one point on that game's progress chart |
| POST | `/api/forum/:method` | `{ args }` → runs one forum action (see `forum/README.md`) as the signed-in person. Reading needs an account too; signed out, only `currentUser` answers (with `null`) |
| GET | `/api/health` | Checks the database connection (Railway health check) |

## Security built in

- Passwords hashed with scrypt and a per-user salt; plain passwords are never stored or logged.
- Sessions are 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` and `__Host-` in production). Only a SHA-256 hash of the token is stored, so a database leak can't be used to sign in. Sessions last 30 days; expired ones are cleaned up hourly.
- Requests that change things are refused if they come from another website (Origin check).
- Sign-in attempts are limited per account and per IP; sign-ups per IP.
- A wrong email and a wrong password get the same message and take the same time.
- Request bodies are capped at 10 KB. Only the site folders are served, never `server/`, `node_modules/`, `.git/` or `.env`.
- Tables are created by migrations in `migrations/`, which run on startup.

## Run it locally

1. `npm install`
2. Copy `.env.example` to `.env` and paste your Railway Postgres **public** URL as `DATABASE_URL`.
3. `npm start`, then open http://localhost:3000/account/

## Tests

`npm test` runs the account tests (against an in-memory Postgres, no real database needed), the recommender tests and the forum tests.

## Not done yet

- Email verification and "forgot password" (both need an email service).
- The rest of the pre-launch security list (rate limits on every route, monitoring, backups and so on).
- The sign-in limits are kept in memory, which is fine for one Railway instance. With several replicas, move them to Postgres or Redis.
