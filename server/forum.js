// /api/forum: the community forum, shared by everyone and tied to real accounts.
// Reading and posting need an account (people share health experiences here, so posts aren't
// public); signed out, the pages only learn that nobody is signed in.
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
const { alerts } = require('./alerts');

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

// The live forum is for real members only. The made-up example accounts and their posts (seed.js)
// belong to the demo, so they're taken out of a forum saved by an earlier version. Example
// accounts have ids like "u-river"; real accounts have UUIDs and are never touched. An example
// conversation that real members have replied to stays, so nobody's reply disappears.
// Returns true if anything changed.
function removeExamples(state) {
  const isExample = (id) => String(id).startsWith('u-');
  const before = JSON.stringify([state.profiles.length, state.threads.length, state.replies.length, state.reports.length]);
  state.replies = state.replies.filter((r) => !isExample(r.authorId));
  const realReplies = new Set(state.replies.map((r) => r.threadId));
  state.threads = state.threads.filter((t) => !isExample(t.authorId) || realReplies.has(t.id));
  const kept = new Set([...state.threads, ...state.replies].map((item) => item.id));
  state.replies = state.replies.filter((r) => kept.has(r.threadId));
  state.reports = state.reports.filter((r) => !isExample(r.reporterId) && kept.has(r.targetId));
  for (const id of Object.keys(state.helpful)) {
    if (!kept.has(id)) delete state.helpful[id];
    else state.helpful[id] = state.helpful[id].filter((who) => !isExample(who));
  }
  for (const id of Object.keys(state.settings)) {
    if (isExample(id)) delete state.settings[id];
    else if (state.settings[id].muted) state.settings[id].muted = state.settings[id].muted.filter((who) => !isExample(who));
  }
  const authors = new Set([...state.threads, ...state.replies].map((item) => item.authorId));
  state.profiles = state.profiles.filter((p) => !isExample(p.id) || authors.has(p.id));
  return JSON.stringify([state.profiles.length, state.threads.length, state.replies.length, state.reports.length]) !== before;
}

// A new live forum starts empty: no example accounts, posts or reports.
function emptyForum(Forum) {
  return { ...Forum.seed(), currentUserId: null, profiles: [], threads: [], replies: [], reports: [], helpful: {}, settings: {} };
}

// One line in the server log (Railway keeps these) when a post may come from someone who needs
// support, and a message to the team's chat if ALERT_WEBHOOK_URL is set (alerts.js). It names the
// post only, never its words or author.
function supportAlert(postId) {
  console.error(JSON.stringify({ type: 'safety', level: 'alert', at: new Date().toISOString(), event: 'support_needed', postId: String(postId).slice(0, 40) }));
  alerts.send('support_needed', { postId });
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
        if (removeExamples(state)) await persist();
      } else {
        state = emptyForum(Forum);
        await persist();
      }
    })().catch((error) => { loading = null; throw error; }); // a failed first load is retried next time
    await loading;
  }

  // Saves are queued so they reach the database in order. A failed save doesn't block the ones
  // after it (each save writes the whole forum, so the next one catches up).
  let saving = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify({ ...state, currentUserId: null });
    dirty = false;
    saving = saving.catch(() => {}).then(() => db.query(
      `INSERT INTO forum_state (id, data, updated_at) VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [snapshot]
    ));
    return saving;
  }

  // Posts with an open "may need support" report, from the safety check or from a person.
  function openSupportReports() {
    return new Set(state.reports.filter((r) => r.reason === 'support' && r.status === 'open').map((r) => r.targetId));
  }

  // Every account gets a forum profile the first time it uses the forum. It starts with a neutral
  // name like "Member 4821", never the account's own name, so nobody's first name appears on a
  // health forum unless they choose it on their profile.
  function ensureProfile(user) {
    const type = moderatorEmails.has(user.email) ? 'moderator' : 'member';
    let profile = state.profiles.find((p) => p.id === user.id);
    if (!profile) {
      // The number comes from the account id. If another member already has it, take the next free one,
      // so two people never share a starting name.
      const taken = new Set(state.profiles.map((p) => String(p.displayName || '').toLowerCase()));
      let n = parseInt(user.id.replace(/-/g, '').slice(-6), 16) % 10000;
      for (let tries = 0; tries < 10000 && taken.has('member ' + String(n).padStart(4, '0')); tries++) n = (n + 1) % 10000;
      profile = { id: user.id, displayName: 'Member ' + String(n).padStart(4, '0'), type, bio: '', showBio: false, createdAt: new Date().toISOString() };
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
      res.set('Cache-Control', 'no-store');
      if (!user) {
        // The one thing a signed-out page may ask: "is anyone signed in?" (no).
        if (method === 'currentUser') return res.json({ result: null });
        return res.status(401).json({ error: 'Please sign in to read and join the community.' });
      }
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
      const supportBefore = openSupportReports();
      try { result = await Forum.store[method](...args); } catch (e) { error = e; }
      state.currentUserId = null;
      if (!error) for (const postId of openSupportReports()) if (!supportBefore.has(postId)) supportAlert(postId);
      if (dirty) await persist();

      // Moderation decisions are recorded, so there's a history of who hid or removed what.
      if (!error && method === 'resolve') await audit(db, req, 'moderation', { userId: user.id, detail: { targetId: String(args[0]).slice(0, 40), action: String(args[1]).slice(0, 10) } });
      if (error) return res.status(400).json({ error: error.message });
      res.json({ result: result === undefined ? null : result });
    } catch (error) {
      next(error);
    }
  });

  // When an account is deleted, everything the person wrote is erased, not just hidden: post text,
  // titles, links, report notes, helpful marks and mutes. The profile stays as "Former member" with
  // nothing personal in it, so old reports and the moderation history still make sense.
  async function forgetUser(userId) {
    await ready();
    const profile = state.profiles.find((p) => p.id === userId);
    if (profile) {
      Object.assign(profile, { displayName: 'Former member', bio: '', showBio: false, type: 'member' });
      delete profile.professional;
    }
    delete state.settings[userId];
    for (const settings of Object.values(state.settings)) {
      if (settings.muted) settings.muted = settings.muted.filter((id) => id !== userId);
    }
    for (const list of [state.threads, state.replies]) {
      for (const item of list) {
        if (item.authorId !== userId) continue;
        item.status = 'removed-by-author';
        if (item.title !== undefined) item.title = '';
        item.body = '';
        delete item.sourceUrl;
        if (item.gameIds) item.gameIds = [];
      }
    }
    const erased = new Set([...state.threads, ...state.replies].filter((item) => item.authorId === userId).map((item) => item.id));
    for (const report of state.reports) {
      if (report.reporterId === userId) report.note = '';
      // Nobody can see those posts any more, so their open reports are closed.
      if (erased.has(report.targetId) && report.status === 'open') {
        Object.assign(report, { status: 'dismissed', resolution: 'author-deleted', resolvedAt: new Date().toISOString() });
      }
    }
    for (const marks of Object.values(state.helpful)) {
      const at = marks.indexOf(userId);
      if (at >= 0) marks.splice(at, 1);
    }
    await persist();
  }

  return { router, forgetUser };
}

module.exports = { forumRouter, removeExamples };
