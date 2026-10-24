// /api/forum: the community forum, shared by everyone and tied to real accounts.
//
// The forum's rules live in forum/assets/js/store.js (posting, privacy, reports, moderation,
// edits, appeals, muting), the same file the forum tests check. The server runs that file
// against one shared copy of the forum kept in Postgres, acting as the signed-in person, and
// the pages call it through forum/assets/js/api-store.js. Only what the store chooses to
// return ever leaves the server, so anonymous authors and other people's settings stay private.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const sessions = require('./sessions');
const { createLimiter } = require('./rate-limit');
const { audit } = require('./audit');

const FORUM_JS = path.join(__dirname, '..', 'forum', 'assets', 'js');

// Methods pages may call. The demo-only ones (switching accounts, resetting) aren't here.
const READS = ['currentUser', 'getProfile', 'listThreads', 'categoryCounts', 'getThread', 'previewDraft', 'listMuted', 'moderationQueue', 'hiddenPosts', 'moderationHistory', 'topicSignals'];
const WRITES = ['updateMyProfile', 'updateMySettings', 'createThread', 'createReply', 'editMyPost', 'requestAnotherReview', 'setMuted', 'deleteMyPost', 'toggleHelpful', 'report', 'resolve'];
const POSTING = ['createThread', 'createReply', 'editMyPost', 'report', 'requestAnotherReview'];

function loadForum(storage) {
  const window = { localStorage: storage };
  window.window = window;
  const context = vm.createContext(Object.assign(window, { console, Date, JSON, Math, Promise, Set, Error, URL }));
  for (const file of ['catalog', 'seed', 'safety', 'store']) {
    vm.runInContext(fs.readFileSync(path.join(FORUM_JS, file + '.js'), 'utf8'), context, { filename: file + '.js' });
  }
  return context.Forum;
}

function forumRouter({ db, isProd, moderators = [], limits = {} }) {
  const router = express.Router();
  const postLimit = createLimiter({ limit: 20, windowMs: 10 * 60 * 1000, ...limits.post });
  const moderatorEmails = new Set(moderators.map((e) => e.trim().toLowerCase()).filter(Boolean));

  // The store reads and writes through localStorage; here that's the shared state in memory.
  let state = null;
  let dirty = false;
  const storage = {
    getItem: () => (state ? JSON.stringify(state) : null),
    setItem: (key, value) => { state = JSON.parse(value); dirty = true; },
    removeItem: () => {}
  };
  const Forum = loadForum(storage);

  let loading = null;
  async function ready() {
    if (state) return;
    loading = loading || (async () => {
      const { rows } = await db.query('SELECT data FROM forum_state WHERE id = 1');
      if (rows[0]) {
        state = rows[0].data;
        // The app is called Chemoasis: fix example posts saved under its earlier working name.
        // Example accounts have ids like "u-river"; real accounts have UUIDs and are never touched.
        for (const item of [...state.threads, ...state.replies]) {
          if (String(item.authorId).startsWith('u-') && /Reframe/.test(item.body)) { item.body = item.body.replace(/Reframe/g, 'Chemoasis'); dirty = true; }
        }
        if (dirty) await persist();
      } else {
        state = Forum.seed();
        state.currentUserId = null;
        await persist();
      }
    })();
    await loading;
  }

  // Saves are queued so they reach the database in order.
  let saving = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify({ ...state, currentUserId: null });
    dirty = false;
    saving = saving.then(() => db.query(
      `INSERT INTO forum_state (id, data, updated_at) VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [snapshot]
    ));
    return saving;
  }

  // Every account gets a forum profile the first time it uses the forum.
  function ensureProfile(user) {
    const type = moderatorEmails.has(user.email) ? 'moderator' : 'member';
    let profile = state.profiles.find((p) => p.id === user.id);
    if (!profile) {
      profile = { id: user.id, displayName: user.name, type, bio: '', showBio: false, createdAt: new Date().toISOString() };
      state.profiles.push(profile);
      dirty = true;
    } else if (profile.type !== type && (profile.type === 'member' || profile.type === 'moderator')) {
      profile.type = type;
      dirty = true;
    }
  }

  router.post('/:method', async (req, res, next) => {
    try {
      const method = req.params.method;
      const isWrite = WRITES.includes(method);
      if (!isWrite && !READS.includes(method)) return res.status(404).json({ error: 'Not found.' });
      const args = Array.isArray(req.body && req.body.args) ? req.body.args.slice(0, 4) : [];
      await ready();

      const user = await sessions.findUser(db, sessions.readToken(req, isProd));
      if (isWrite && !user) return res.status(401).json({ error: 'Please sign in to post or change settings.' });
      if (user && POSTING.includes(method)) {
        const wait = postLimit.hit(user.id);
        if (wait) {
          res.set('Retry-After', String(wait));
          return res.status(429).json({ error: "You're posting very quickly. Please wait a few minutes and try again." });
        }
      }
      if (user) ensureProfile(user);

      // The store works out what this person may see and do. Its methods finish synchronously,
      // so no other request can change who "currentUserId" is in the middle of one.
      state.currentUserId = user ? user.id : null;
      let result, error;
      try { result = await Forum.store[method](...args); } catch (e) { error = e; }
      state.currentUserId = null;
      if (dirty) await persist();

      res.set('Cache-Control', 'no-store');
      // Moderation decisions are recorded, so there's a history of who hid or removed what.
      if (!error && method === 'resolve') await audit(db, req, 'moderation', { userId: user.id, detail: { targetId: String(args[0]).slice(0, 40), action: String(args[1]).slice(0, 10) } });
      if (error) return res.status(400).json({ error: error.message });
      res.json({ result: result === undefined ? null : result });
    } catch (error) {
      next(error);
    }
  });

  // When an account is deleted: its posts are taken down and its profile keeps nothing personal
  // (it stays as "Former member" so old reports and the moderation history still make sense).
  async function forgetUser(userId) {
    await ready();
    const profile = state.profiles.find((p) => p.id === userId);
    if (profile) Object.assign(profile, { displayName: 'Former member', bio: '', showBio: false, type: 'member' });
    delete state.settings[userId];
    for (const list of [state.threads, state.replies]) {
      for (const item of list) if (item.authorId === userId && item.status !== 'removed-by-author') item.status = 'removed-by-author';
    }
    await persist();
  }

  return { router, forgetUser };
}

module.exports = { forumRouter };
