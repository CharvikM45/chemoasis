// The Express app: the account API under /api, and the website's folders as static files.
const path = require('path');
const express = require('express');
const { authRouter } = require('./auth');
const { profileRouter } = require('./profile');
const { forumRouter } = require('./forum');
const { securityHeaders, safeJsonReviver } = require('./security');
const { createLimiter } = require('./rate-limit');
const { audit } = require('./audit');

const ROOT = path.join(__dirname, '..');
const SITE_FOLDERS = ['home', 'account', 'forum', 'games']; // never serve server/, node_modules/, .git/, .env

function createApp({ db, isProd = false, allowedOrigins = [], moderators = [], dataKey, limits } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('env', isProd ? 'production' : 'development'); // no debug output from Express in production
  app.set('trust proxy', 1); // Railway sits in front, so use its X-Forwarded-For / -Proto
  // HTTPS only. Railway already redirects at its edge; this covers any other way in. The health
  // check is exempt: Railway calls it directly over its private network, without HTTPS.
  if (isProd) app.use((req, res, next) => (req.secure || req.path === '/api/health' ? next() : res.redirect(301, `https://${req.get('host')}${req.originalUrl}`)));
  app.use(securityHeaders({ root: ROOT, folders: SITE_FOLDERS, isProd }));

  // An overall limit on API calls per IP, on top of the stricter sign-in and posting limits.
  const apiLimit = createLimiter({ limit: 600, windowMs: 5 * 60 * 1000, ...(limits && limits.api) });
  app.use('/api', (req, res, next) => {
    const wait = apiLimit.hit(req.ip);
    if (!wait) return next();
    if (apiLimit.hit(req.ip + ':logged') === 0) audit(db, req, 'api_rate_limited'); // once per window per IP
    res.set('Retry-After', String(wait));
    res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
  });

  // Reject state-changing API calls sent from other websites (cross-site request forgery).
  // Browsers always send Origin on these requests, and modern ones also say "cross-site" in
  // Sec-Fetch-Site; tools like curl send neither, and can't ride on a user's cookie.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    if (!origin && req.get('sec-fetch-site') === 'cross-site') {
      audit(db, req, 'cross_site_blocked', { detail: { path: req.path, origin: null } });
      return res.status(403).json({ error: 'This request came from another website and was blocked.' });
    }
    if (!origin) return next();
    // Compare the host, not the scheme: behind Railway's proxy the scheme the app sees can differ
    // from the browser's, but a page on another site can never send this site's host as its Origin.
    let originHost = null;
    try { originHost = new URL(origin).host; } catch (_) { /* not a URL: treated as another site */ }
    if (originHost === req.get('host') || allowedOrigins.includes(origin)) return next();
    audit(db, req, 'cross_site_blocked', { detail: { path: req.path, origin: origin.slice(0, 100) } });
    res.status(403).json({ error: 'This request came from another website and was blocked.' });
  });

  app.use('/api/profile', express.json({ limit: '64kb', reviver: safeJsonReviver })); // answers + play history are bigger than a sign-in
  app.use('/api/forum', express.json({ limit: '32kb', reviver: safeJsonReviver })); // a 5,000-character post in another script can pass 10 KB
  app.use('/api', express.json({ limit: '10kb', reviver: safeJsonReviver }));

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
  app.use('/api/profile', profileRouter({ db, isProd, dataKey }));
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
    // Details go to the server log only; the browser never sees stack traces or internals.
    console.error(JSON.stringify({ type: 'error', level: 'error', at: new Date().toISOString(), path: req.path, message: error.message, stack: error.stack }));
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
