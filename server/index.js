// Starts the server: connects to Postgres, runs migrations, then serves the site and the account API.
const fs = require('fs');
const path = require('path');
const { createPool, migrate } = require('./db');
const { createApp } = require('./app');
const { removeExpired } = require('./sessions');
const { removeOldAudit } = require('./audit');

// Local development: read KEY=value lines from .env (Railway sets real environment variables).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const db = createPool();
  await migrate(db);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const moderators = (process.env.MODERATOR_EMAILS || '').split(',');
  const dataKey = process.env.DATA_KEY || '';
  if (isProd && !dataKey) console.error(JSON.stringify({ type: 'security', level: 'alert', event: 'no_data_key', message: 'DATA_KEY is not set: profiles are stored unencrypted.' }));
  const app = createApp({ db, isProd, allowedOrigins, moderators, dataKey });
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => console.log(`Chemoasis running on http://localhost:${port}`));

  const cleanup = setInterval(() => {
    removeExpired(db).catch((e) => console.error('Session cleanup failed', e));
    removeOldAudit(db).catch((e) => console.error('Audit cleanup failed', e));
  }, 60 * 60 * 1000);
  cleanup.unref();

  const stop = () => {
    server.close(() => db.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error) => {
  console.error('Could not start:', error.message);
  process.exit(1);
});
