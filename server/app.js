// The Express app: the account API under /api, and the website's folders as static files.
const path = require('path');
const express = require('express');
const { authRouter } = require('./auth');

const ROOT = path.join(__dirname, '..');
const SITE_FOLDERS = ['home', 'account', 'forum', 'games']; // never serve server/, node_modules/, .git/, .env

function createApp({ db, isProd = false, allowedOrigins = [], limits } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway sits in front, so use its X-Forwarded-For / -Proto

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

  app.use('/api', express.json({ limit: '10kb' }));

  app.get('/api/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false });
    }
  });
  app.use('/api/auth', authRouter({ db, isProd, limits }));
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
