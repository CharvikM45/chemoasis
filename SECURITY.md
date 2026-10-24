# Security

How Chemoasis handles each item on the security checklist (37–53), where the code is, and what still needs a person to do.

| # | Risk | What Chemoasis does | Where |
| --- | --- | --- | --- |
| 37 | Vulnerable dependencies | Two runtime packages (express, pg). CI runs `npm audit` on every push and pull request; Dependabot opens weekly update PRs. | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| 38 | Malicious packages | Exact versions locked in `package-lock.json` and installed with `npm ci`. three.js is self-hosted (copied unmodified from the official npm package, checksum in its README) instead of loaded from a CDN, so no third-party server can change the code the site runs. | `games/assets/vendor/three/` |
| 39 | Prompt injection | Not applicable: Chemoasis has no AI or chatbot features. The recommender is a small, explainable model with fixed inputs. | `account/assets/js/recommender.js` |
| 40 | Unpermissioned AI access | Not applicable: no AI services, keys or agents. | |
| 41 | Excessive DB permissions | The app only runs fixed, parameterised queries on its own tables. **To do (needs Railway access):** connect as a dedicated role that owns only these tables instead of the default `postgres` superuser. | `server/` |
| 42 | Missing audit logs | Sign-ups, sign-ins, failed sign-ins, rate limits, sign-outs, account deletions, moderation decisions and blocked cross-site requests are stored in `audit_log` with shortened IPs, and kept 180 days. | `server/audit.js`, `server/migrations/004_audit_log.sql` |
| 43 | No security monitoring | Every security event is also one JSON line in the server log (`"type":"security"`). 20 failed sign-ins from one address in 15 minutes logs an `"level":"alert"` line. Health check at `/api/health`. **To do:** set up a Railway log alert on `"level":"alert"`. | `server/audit.js` |
| 44 | No backups/restore | **To do (Railway dashboard):** Postgres service → Backups → turn on scheduled backups. Restoring: Backups → choose a backup → Restore. Note that profiles are encrypted, so keep `DATA_KEY` safe too (a backup can't be read without it). | |
| 45 | Exposed internal dashboards | There are no admin pages. The moderation queue page is public HTML, but its data comes only from the server, which checks the person is a moderator (`MODERATOR_EMAILS`). Only the site folders are served, never `server/`, `.env` or `node_modules/`. | `server/forum.js`, `server/app.js` |
| 46 | Missing security headers | Content Security Policy (scripts only from this site, inline scripts allowed by hash, no framing, no plugins), HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `no-store` on API responses. | `server/security.js` |
| 47 | Insecure cookie settings | The session cookie is `HttpOnly`, `SameSite=Lax`, and in production `Secure` with the `__Host-` prefix. It holds a random 32-byte token; only its SHA-256 hash is stored. | `server/sessions.js` |
| 48 | Unencrypted data | HTTPS everywhere (HSTS). Passwords are hashed with scrypt. Each person's profile (questionnaire answers, scores) is encrypted with AES-256-GCM before it's stored, using `DATA_KEY`. | `server/crypto-box.js`, `server/password.js` |
| 49 | Poor tenant isolation | Every profile query is scoped to the signed-in person's id from the session, never from the request. The forum runs each action as the signed-in person and returns only what they may see (anonymous authors stay hidden). Tests check one account can't read another's data. | `server/profile.js`, `server/forum.js`, `server/tests/` |
| 50 | Unreviewed code | CI runs all tests on every push and pull request. **To do (GitHub settings):** protect `main` so changes need a pull request with a passing CI run and one approving review. | `.github/workflows/ci.yml` |
| 51 | Mass assignment | Sign-up reads only email, name, password and consent. Profiles keep only known fields, with size limits. Forum changes go through the forum's rules, which pick fields one by one. | `server/auth.js`, `server/profile.js` |
| 52 | Command injection | No shell commands anywhere. All database queries use parameters, never string building. | `server/` |
| 53 | Insecure deserialization | Only JSON is accepted (size-limited), and `__proto__` / `constructor` / `prototype` keys are dropped while parsing, so request data can't change object prototypes. | `server/security.js` |

## Also in place

- Rate limits: sign-up and sign-in (per IP and per account), forum posting (per account), and an overall API limit per IP.
- Requests that change data are refused if they come from another website (Origin check).
- Wrong email and wrong password get the same message and take the same time.
- Deleting an account deletes its profile, sessions and settings, and takes its forum posts down.

## Environment variables

| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection (on Railway: `${{Postgres.DATABASE_URL}}`) |
| `DATA_KEY` | 32 random bytes, base64, for encrypting profiles. **If it's lost, encrypted profiles can't be read.** Keep a copy somewhere safe, like a password manager. |
| `MODERATOR_EMAILS` | Comma-separated emails of community moderators |
| `NODE_ENV` | `production` on Railway |

## Reporting a problem

Please don't post security problems in the community. Tell the team directly.
