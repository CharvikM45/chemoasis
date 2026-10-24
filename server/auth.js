// /api/auth: create an account, sign in, sign out, who am I, delete my account.
const crypto = require('crypto');
const express = require('express');
const { hashPassword, verifyPassword, dummyHash } = require('./password');
const sessions = require('./sessions');
const { createLimiter } = require('./rate-limit');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at });

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function readSignup(body) {
  const email = String((body && body.email) || '').trim().toLowerCase();
  const name = String((body && body.name) || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const password = String((body && body.password) || '');
  if (!EMAIL.test(email) || email.length > 254) throw new InputError('Please enter an email address like name@example.com.');
  if (!name) throw new InputError('Please enter a first name or nickname.');
  if (name.length > 40) throw new InputError('Please keep your name to 40 characters or fewer.');
  if (password.length < 8) throw new InputError('Please use a password with at least 8 characters.');
  if (password.length > 200) throw new InputError('Please use a password with 200 characters or fewer.');
  if (!(body && body.consent === true)) throw new InputError('Please read the privacy notice and tick the box to agree.');
  return { email, name, password };
}

function authRouter({ db, isProd, limits = {}, onDelete }) {
  const router = express.Router();
  const signupLimit = createLimiter({ limit: 5, windowMs: 60 * 60 * 1000, ...limits.signup });
  const loginPerAccount = createLimiter({ limit: 8, windowMs: 15 * 60 * 1000, ...limits.loginAccount });
  const loginPerIp = createLimiter({ limit: 40, windowMs: 15 * 60 * 1000, ...limits.loginIp });

  const tooMany = (res, wait) => {
    res.set('Retry-After', String(wait));
    res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  };

  async function startSession(res, user) {
    const token = await sessions.createSession(db, user.id);
    sessions.setCookie(res, token, isProd);
  }

  router.post('/signup', async (req, res, next) => {
    try {
      const wait = signupLimit.hit(req.ip);
      if (wait) return tooMany(res, wait);
      const { email, name, password } = readSignup(req.body);
      const id = crypto.randomUUID();
      const hash = await hashPassword(password);
      let user;
      try {
        const { rows } = await db.query(
          'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, created_at',
          [id, email, name, hash]
        );
        user = rows[0];
      } catch (error) {
        if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
          throw new InputError("There's already an account with that email. Try signing in.", 409);
        }
        throw error;
      }
      await startSession(res, user);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      const password = String((req.body && req.body.password) || '');
      const wait = loginPerIp.hit(req.ip) || loginPerAccount.hit(email);
      if (wait) return tooMany(res, wait);

      const { rows } = await db.query('SELECT id, email, name, created_at, password_hash FROM users WHERE email = $1', [email]);
      const user = rows[0];
      // Same work either way, so response time doesn't reveal whether the email has an account.
      const ok = await verifyPassword(password, user ? user.password_hash : await dummyHash);
      if (!user || !ok) throw new InputError("That email and password don't match an account.", 401);

      loginPerAccount.reset(email);
      await startSession(res, user);
      res.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      await sessions.endSession(db, sessions.readToken(req, isProd));
      sessions.clearCookie(res, isProd);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const user = await sessions.findUser(db, sessions.readToken(req, isProd));
      if (!user) return res.status(401).json({ error: 'Not signed in.' });
      res.set('Cache-Control', 'no-store');
      res.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  // Deletes the account and all its sessions (ON DELETE CASCADE).
  router.delete('/me', async (req, res, next) => {
    try {
      const user = await sessions.findUser(db, sessions.readToken(req, isProd));
      if (!user) return res.status(401).json({ error: 'Not signed in.' });
      if (onDelete) await onDelete(user.id);
      await db.query('DELETE FROM users WHERE id = $1', [user.id]);
      sessions.clearCookie(res, isProd);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { authRouter, InputError };
