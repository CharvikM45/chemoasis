// The Express app: the account API under /api, and the website's folders as static files.
const path = require('path');
const express = require('express');
const { authRouter } = require('./auth');
const { profileRouter } = require('./profile');
const { forumRouter } = require('./forum');

const ROOT = path.join(__dirname, '..');
const SITE_FOLDERS = ['home', 'account', 'forum', 'games']; // never serve server/, node_modules/, .git/, .env

function createApp({ db, isProd = false, allowedOrigins = [], moderators = [], limits } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway sits in front, so use its X-Forwarded-For / -Proto

  // Security headers on every response. The policy lists only what the pages really load: this
  // site, Google Fonts, and inline scripts and styles (the pages and games use some). Other sites
  // can't show these pages in a frame, so nobody can hide a "Delete my account" button under a
  // fake page (clickjacking).
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': policy,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    if (isProd) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });

  // Reject state-changing API calls sent from other websites (cross-site request forgery).
  // Browsers always send Origin on these requests; tools like curl don't, and can't ride on a user's cookie.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    if (!origin) return next();
    const own = `${req.protocol}://${req.get('host')}`;
    if (origin === own || allowedOrigins.includes(origin)) return next();
    res.status(403).json({ error: 'This request came from another website and was blocked.' });
  });

  app.use('/api/profile', express.json({ limit: '64kb' })); // answers + play history are bigger than a sign-in
  app.use('/api/forum', express.json({ limit: '32kb' })); // a 5,000-character post in another script can pass 10 KB
  app.use('/api', express.json({ limit: '10kb' }));

  app.get('/api/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false });
    }
  });
  const forum = forumRouter({ db, isProd, moderators, limits });
  app.use('/api/auth', authRouter({ db, isProd, limits, onDelete: forum.forgetUser }));
  app.use('/api/profile', profileRouter({ db, isProd }));
  app.use('/api/forum', forum.router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  for (const folder of SITE_FOLDERS) {
    app.use(`/${folder}`, express.static(path.join(ROOT, folder), { dotfiles: 'ignore' }));
  }
  app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

  // Errors: friendly message for expected ones, nothing internal leaked for the rest.
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request could not be read.' });
    if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
