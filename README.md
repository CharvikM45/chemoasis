# Chemoasis

Chemoasis is a website for people in the months after chemotherapy. It has calm, adaptive brain games, a short questionnaire that suggests where to start, and a moderated community forum. It's built by a student team, and it's supportive and educational: it doesn't diagnose anything and doesn't replace anyone's care team.

## What's where

| Folder | What it is |
| --- | --- |
| `home/` | The home page, with the 3D brain (`home/assets/js/brain/`) |
| `games/` | The six games and the games library |
| `account/` | Sign-in, the questionnaire, suggested games and progress (see `account/README.md`) |
| `forum/` | The community forum (see `forum/README.md`) |
| `server/` | The Node server: serves the site and the account, profile and forum API (see `server/README.md`) |
| `index.html` | Sends visitors to `home/` |

It's plain HTML, CSS and JavaScript with no build step. The server is Express with Postgres.

## Run it on your computer

You need Node 22 or newer (the test command needs it) and a Postgres database (the team uses Railway's).

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your Postgres URL. Add `MODERATOR_EMAILS` (comma-separated) to choose who can moderate the forum.
3. `npm start`, then open http://localhost:3000/

## Tests

`npm test` runs every test suite: the account server (against an in-memory Postgres, so no real database is needed), the recommender and the forum. GitHub runs them automatically on every pull request (`.github/workflows/test.yml`).

## How we work

- Every change goes through a branch and a pull request. Nothing is pushed straight to `main`.
- Each person owns their part: Max the forum, Sahas the questionnaire, recommendations and server, and Charvik the games library and the repo. Ask the owner before changing someone else's part.
- No real health data in the code or the example content. Example posts and accounts are made up and marked "(example)".
- Health claims need a real source, and should say only what the source supports.

## Hosting

The whole site and the server run as one Railway service next to the Postgres database (`railway.json`). Run one instance: the forum and the sign-in limits are kept in the server's memory.
