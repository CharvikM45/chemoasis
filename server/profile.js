// /api/profile: the signed-in person's questionnaire answers, recommender model, levels and game results.
const express = require('express');
const sessions = require('./sessions');
const { InputError } = require('./auth');
const { makeBox } = require('./crypto-box');

const GAMES = ['lumen', 'starling', 'cloudpath', 'echo', 'rhythm', 'signal'];
const FIELDS = ['answers', 'completedAt', 'skippedAt', 'useOwnPosts', 'model', 'levels', 'results'];
const MAX_EVENTS = 300;
const MAX_RESULTS = 300;
// Room for a full play history (300 results + 300 events is about 50 KB) with space to spare,
// so a long-time player never reaches the limit and has their saves refused.
const MAX_BYTES = 96 * 1024;
const MODES = ['gentle', 'challenge'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// One finished session: { game, level, score, mode, at }. score is null for Gentle sessions,
// which keep no speed scores. Anything else in an entry is dropped.
function cleanResult(r) {
  if (!isObject(r) || !GAMES.includes(r.game)) return null;
  const level = Number(r.level);
  if (!Number.isInteger(level) || level < 0 || level > 20) return null;
  const score = r.score === null || r.score === undefined ? null : Number(r.score);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100000)) return null;
  const out = { game: r.game, level, score: score === null ? null : Math.round(score * 10) / 10, at: String(r.at || '').slice(0, 30) };
  if (MODES.includes(r.mode)) out.mode = r.mode;
  return out;
}

// Keeps only known fields, caps the play history, and refuses anything oversized.
function cleanProfile(input) {
  if (!isObject(input)) throw new InputError('That profile could not be read.');
  const out = {};
  for (const key of FIELDS) if (input[key] !== undefined) out[key] = input[key];
  if (out.answers !== undefined && !isObject(out.answers)) throw new InputError('Answers must be an object.');
  if (out.levels !== undefined && !isObject(out.levels)) throw new InputError('Levels must be an object.');
  if (out.results !== undefined && !Array.isArray(out.results)) throw new InputError('Results must be a list.');
  if (Array.isArray(out.results)) out.results = out.results.slice(-MAX_RESULTS).map(cleanResult).filter(Boolean);
  if (out.model !== undefined && out.model !== null) {
    if (!isObject(out.model)) throw new InputError('The model must be an object.');
    if (Array.isArray(out.model.events) && out.model.events.length > MAX_EVENTS) {
      out.model = { ...out.model, events: out.model.events.slice(-MAX_EVENTS) };
    }
  }
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_BYTES) throw new InputError('That profile is too large.', 413);
  return out;
}

function profileRouter({ db, isProd, dataKey }) {
  const router = express.Router();
  const box = makeBox(dataKey); // encrypts each profile before it's stored, when a key is set

  async function signedIn(req, res) {
    const user = await sessions.findUser(db, sessions.readToken(req, isProd));
    if (!user) res.status(401).json({ error: 'Not signed in.' });
    return user;
  }
  async function load(userId) {
    const { rows } = await db.query('SELECT data, updated_at FROM profiles WHERE user_id = $1', [userId]);
    if (!rows[0]) return null;
    return { data: box ? box.open(rows[0].data) : rows[0].data, updated_at: rows[0].updated_at };
  }
  async function store(userId, data) {
    await db.query(
      `INSERT INTO profiles (user_id, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [userId, JSON.stringify(box ? box.seal(data) : data)]
    );
  }
  // Changes for one person run one at a time, so a play and a finished level arriving together
  // can't overwrite each other. (In memory: fine for one server instance, like the rate limits.)
  const queues = new Map();
  function oneAtATime(userId, fn) {
    const run = (queues.get(userId) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(userId, tail);
    tail.then(() => { if (queues.get(userId) === tail) queues.delete(userId); });
    return run;
  }

  const handle = (fn) => async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const user = await signedIn(req, res);
      if (user) await oneAtATime(user.id, () => fn(req, res, user));
    } catch (error) {
      next(error);
    }
  };

  router.get('/', handle(async (req, res, user) => {
    const row = await load(user.id);
    res.json({ profile: row ? row.data : null, updatedAt: row ? row.updated_at : null });
  }));

  router.put('/', handle(async (req, res, user) => {
    const profile = cleanProfile(req.body && req.body.profile);
    await store(user.id, profile);
    res.json({ profile });
  }));

  // A game was opened from the home page: one more positive example for the recommender.
  router.post('/play', handle(async (req, res, user) => {
    const game = String((req.body && req.body.game) || '');
    if (!GAMES.includes(game)) throw new InputError('Unknown game.');
    const row = await load(user.id);
    const data = (row && row.data) || {};
    const model = isObject(data.model) ? data.model : { version: 1, delta: {}, events: [], dismissed: {} };
    model.events = Array.isArray(model.events) ? model.events : [];
    model.events.push({ game, kind: 'play', at: Date.now(), applied: false });
    if (isObject(model.dismissed)) delete model.dismissed[game];
    await store(user.id, cleanProfile({ ...data, model }));
    res.status(204).end();
  }));

  // A level was finished in a game.
  router.post('/level', handle(async (req, res, user) => {
    const game = String((req.body && req.body.game) || '');
    const level = Number(req.body && req.body.level);
    if (!GAMES.includes(game) || !Number.isInteger(level) || level < 0 || level > 20) throw new InputError('Unknown level.');
    const row = await load(user.id);
    const data = (row && row.data) || {};
    const levels = isObject(data.levels) ? data.levels : {};
    levels[game] = [...new Set([...(Array.isArray(levels[game]) ? levels[game] : []), level])].sort((a, b) => a - b);
    await store(user.id, cleanProfile({ ...data, levels }));
    res.status(204).end();
  }));

  // A finished game session: one more session on the progress card, and a point on that game's
  // chart when it has a score. Gentle sessions send no score (null).
  router.post('/result', handle(async (req, res, user) => {
    const b = req.body || {};
    if (b.mode !== undefined && !MODES.includes(b.mode)) throw new InputError('That result could not be read.');
    const result = cleanResult({ game: b.game, level: b.level, score: b.score, mode: b.mode, at: new Date().toISOString() });
    if (!result) throw new InputError('That result could not be read.');
    const row = await load(user.id);
    const data = (row && row.data) || {};
    const results = Array.isArray(data.results) ? data.results : [];
    results.push(result);
    await store(user.id, cleanProfile({ ...data, results }));
    res.status(204).end();
  }));

  return router;
}

module.exports = { profileRouter, cleanProfile };
