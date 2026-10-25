// /api/studio: the Research Studio, where clinicians and researchers submit activities built on
// published research, and reviewers decide which ones are published with the creator's credit.
//
//   Public:     the published activities, and each one's game in a sandbox.
//   Creators:   drafts, the design assistant, submitting (which runs the automatic checks), and
//               withdrawing, which takes a published activity down.
//   Reviewers:  the people in MODERATOR_EMAILS. They see the queue and decide. Only a person can
//               publish: automatic checks can send a submission back, never approve it.
//
// Submitted games are untrusted code. They're served with a sandbox policy that gives them an
// origin of their own (no cookies, no access to the site or its API), no internet and no storage.
const crypto = require('crypto');
const express = require('express');
const sessions = require('./sessions');
const { createLimiter } = require('./rate-limit');
const { audit } = require('./audit');
const { runChecks, hasFail, normalizeOrcid, orcidChecksumOk, npiChecksumOk, parseResearchLink } = require('./studio-checks');
const { safeSvg } = require('./studio-ai');

// The same skill areas the games and forum use (forum/assets/js/catalog.js).
const AREAS = ['memory', 'words', 'focus', 'speed', 'planning', 'hand'];
const EDITABLE = ['draft', 'changes', 'rejected', 'withdrawn'];
const PROTOTYPE_MAX = 300 * 1024;

const SANDBOX_CSP = [
  'sandbox allow-scripts', // scripts run, but in an origin of their own: no cookies, no site, no pop-ups, no navigating the page
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'"
].join('; ');

const text = (value, max) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '');

// Keeps only the fields the Studio knows, trimmed to their limits. Drafts can be incomplete;
// completeness is checked on submit (missingFields).
function cleanData(input) {
  const src = input && typeof input === 'object' ? input : {};
  const a = src.activity && typeof src.activity === 'object' ? src.activity : {};
  const c = src.creator && typeof src.creator === 'object' ? src.creator : {};
  const website = text(c.website, 200);
  return {
    activity: {
      title: text(a.title, 80),
      area: AREAS.includes(a.area) ? a.area : '',
      summary: text(a.summary, 300),
      howToPlay: text(a.howToPlay, 1500),
      audience: text(a.audience, 300),
      claim: text(a.claim, 800),
      limitations: text(a.limitations, 800)
    },
    research: (Array.isArray(src.research) ? src.research : []).slice(0, 5)
      .map((r) => ({ link: text(r && r.link, 300), note: text(r && r.note, 500) }))
      .filter((r) => r.link || r.note),
    creator: {
      name: text(c.name, 80),
      credentials: text(c.credentials, 80),
      specialty: text(c.specialty, 80),
      institution: text(c.institution, 120),
      location: text(c.location, 80),
      orcid: text(c.orcid, 60),
      npi: text(c.npi, 10).replace(/\D/g, ''),
      website: /^https:\/\/[^\s<>"]+$/i.test(website) ? website : '',
      showInstitution: c.showInstitution === true,
      showLocation: c.showLocation === true
    },
    sketch: safeSvg(src.sketch) || '',
    prototypeKind: src.prototypeKind === 'html' ? 'html' : 'spec',
    spec: text(src.spec, 5000),
    agreed: src.agreed === true
  };
}

// What still has to be filled in (or fixed) before a submission can be sent for review.
function missingFields(data, prototype) {
  const { activity: a, creator: c } = data;
  const missing = [];
  if (!a.title) missing.push('The activity needs a name.');
  if (!a.area) missing.push('Choose the skill area the activity practices.');
  if (a.summary.length < 20) missing.push('Add a short description (at least a sentence).');
  if (a.howToPlay.length < 20) missing.push('Say how the activity is played.');
  if (a.claim.length < 20) missing.push('Say what the research supports.');
  if (a.limitations.length < 10) missing.push("Say what the research doesn't show, or its limits.");
  if (!data.research.length) missing.push('Add at least one published study.');
  data.research.forEach((r, i) => { if (!parseResearchLink(r.link)) missing.push(`Study ${i + 1}: use a DOI or a PubMed link.`); });
  if (!c.name) missing.push('Add your name as it should appear.');
  if (!c.credentials) missing.push('Add your credentials (for example PhD, MD, RN, OTR/L).');
  if (!c.orcid && !c.npi) missing.push('Add an ORCID iD or, for US clinicians, an NPI number.');
  if (c.orcid && !(normalizeOrcid(c.orcid) && orcidChecksumOk(normalizeOrcid(c.orcid)))) missing.push("That ORCID iD isn't valid. It looks like 0000-0002-1825-0097.");
  if (c.npi && !npiChecksumOk(c.npi)) missing.push("That NPI number isn't valid. It has 10 digits.");
  if (data.prototypeKind === 'html' && !prototype) missing.push('Add the prototype file, or switch to a written plan.');
  if (data.prototypeKind === 'spec' && data.spec.length < 50) missing.push('Describe the activity in more detail in the written plan.');
  if (!data.agreed) missing.push('Confirm the submission agreement.');
  return missing;
}

// The creator card and listing a player sees. Only what the creator chose to show.
function publicView(row) {
  const { activity, creator } = row.data;
  const checks = row.checks || { items: [], research: [] };
  const passed = (key) => checks.items.some((i) => i.key === key && i.status === 'pass');
  const orcid = normalizeOrcid(creator.orcid);
  return {
    id: row.id,
    title: activity.title,
    area: activity.area,
    summary: activity.summary,
    howToPlay: activity.howToPlay,
    audience: activity.audience,
    claim: activity.claim,
    limitations: activity.limitations,
    playable: row.data.prototypeKind === 'html' && !!row.prototype,
    research: checks.research.filter((r) => r.url).map(({ title, journal, year, url }) => ({ title, journal, year, url })),
    creator: {
      name: creator.name,
      credentials: creator.credentials,
      specialty: creator.specialty,
      institution: creator.showInstitution ? creator.institution : '',
      location: creator.showLocation ? creator.location : '',
      orcidUrl: orcid ? `https://orcid.org/${orcid}` : '',
      website: creator.website,
      verified: passed('orcid') || passed('npi')
    },
    publishedAt: row.published_at
  };
}

// A creator's own view: everything they entered, plus the checks and the reviewer's note.
function ownView(row) {
  return {
    id: row.id, status: row.status, data: row.data, code: row.prototype,
    checks: row.checks && { ...row.checks, research: row.checks.research.map(({ abstract, ...rest }) => rest) },
    decision: row.decision && { decision: row.decision.decision, note: row.decision.note, at: row.decision.at },
    createdAt: row.created_at, updatedAt: row.updated_at, submittedAt: row.submitted_at, publishedAt: row.published_at
  };
}

function sendSandboxed(res, html) {
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': SANDBOX_CSP,
    'X-Frame-Options': 'SAMEORIGIN',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store'
  });
  res.send(html);
}

function studioRouter({ db, isProd, moderators = [], limits = {}, fetchImpl = fetch, ai = null }) {
  const router = express.Router();
  const reviewerEmails = new Set(moderators.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const DAY = 24 * 60 * 60 * 1000;
  const createLimit = createLimiter({ limit: 10, windowMs: DAY, ...limits.studioCreate });
  const submitLimit = createLimiter({ limit: 10, windowMs: DAY, ...limits.studioSubmit });
  const sketchLimit = createLimiter({ limit: 8, windowMs: 60 * 60 * 1000, ...limits.studioSketch });
  // A ceiling on design-assistant and advisory-review calls for the whole site, so the API bill
  // can't run away whatever happens.
  const aiBudget = createLimiter({ limit: 200, windowMs: DAY, ...limits.studioAi });

  const user = (req) => sessions.findUser(db, sessions.readToken(req, isProd));
  const isReviewer = (u) => !!u && reviewerEmails.has(String(u.email).toLowerCase());
  const tooMany = (res, wait, message) => { res.set('Retry-After', String(wait)); res.status(429).json({ error: message }); };
  const validId = (id) => /^[0-9a-f-]{36}$/i.test(id);

  async function signedIn(req, res) {
    const u = await user(req);
    if (!u) res.status(401).json({ error: 'Please sign in to use the Research Studio.' });
    return u;
  }
  async function own(req, res, u) {
    if (!validId(req.params.id)) { res.status(404).json({ error: 'Not found.' }); return null; }
    const { rows } = await db.query('SELECT * FROM studio_submissions WHERE id = $1 AND user_id = $2', [req.params.id, u.id]);
    if (!rows[0]) res.status(404).json({ error: 'Not found.' });
    return rows[0] || null;
  }
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

  // ---------- public ----------

  router.get('/status', wrap(async (req, res) => {
    const u = await user(req);
    res.json({ signedIn: !!u, reviewer: isReviewer(u), assistant: !!ai });
  }));

  router.get('/published', wrap(async (req, res) => {
    const { rows } = await db.query("SELECT * FROM studio_submissions WHERE status = 'published' ORDER BY published_at DESC LIMIT 200");
    res.json({ activities: rows.map(publicView) });
  }));

  router.get('/published/:id', wrap(async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const { rows } = await db.query("SELECT * FROM studio_submissions WHERE id = $1 AND status = 'published'", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "This activity isn't published." });
    res.json({ activity: publicView(rows[0]) });
  }));

  router.get('/play/:id', wrap(async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).type('text/plain').send('Not found.');
    const { rows } = await db.query("SELECT prototype FROM studio_submissions WHERE id = $1 AND status = 'published'", [req.params.id]);
    if (!rows[0] || !rows[0].prototype) return res.status(404).type('text/plain').send('Not found.');
    sendSandboxed(res, rows[0].prototype);
  }));

  // ---------- creators ----------

  router.get('/mine', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    const { rows } = await db.query('SELECT * FROM studio_submissions WHERE user_id = $1 ORDER BY updated_at DESC', [u.id]);
    res.json({ submissions: rows.map((row) => ({ id: row.id, status: row.status, title: row.data.activity.title, updatedAt: row.updated_at, decision: row.decision && { decision: row.decision.decision, note: row.decision.note } })) });
  }));

  router.post('/mine', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    const wait = createLimit.hit(u.id);
    if (wait) return tooMany(res, wait, "You've started a lot of activities today. Please continue one of your drafts.");
    const prototype = text(req.body && req.body.code, PROTOTYPE_MAX); // sent as "code": the JSON reader drops a "prototype" key (security.js)
    const id = crypto.randomUUID();
    await db.query('INSERT INTO studio_submissions (id, user_id, data, prototype) VALUES ($1, $2, $3::jsonb, $4)', [id, u.id, JSON.stringify(cleanData(req.body && req.body.data)), prototype]);
    const { rows } = await db.query('SELECT * FROM studio_submissions WHERE id = $1', [id]);
    res.status(201).json({ submission: ownView(rows[0]) });
  }));

  router.get('/mine/:id', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    const row = await own(req, res, u);
    if (row) res.json({ submission: ownView(row) });
  }));

  router.put('/mine/:id', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    const row = await own(req, res, u);
    if (!row) return;
    if (!EDITABLE.includes(row.status)) return res.status(409).json({ error: row.status === 'published' ? 'Withdraw the activity before changing it. It will be reviewed again.' : "It's being reviewed, so it can't be changed right now." });
    const prototype = text(req.body && req.body.code, PROTOTYPE_MAX);
    await db.query('UPDATE studio_submissions SET data = $1::jsonb, prototype = $2, updated_at = now() WHERE id = $3', [JSON.stringify(cleanData(req.body && req.body.data)), prototype, row.id]);
    const { rows } = await db.query('SELECT * FROM studio_submissions WHERE id = $1', [row.id]);
    res.json({ submission: ownView(rows[0]) });
  }));

  router.post('/mine/:id/submit', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    const row = await own(req, res, u);
    if (!row) return;
    if (!EDITABLE.includes(row.status)) return res.status(409).json({ error: 'This activity has already been sent for review.' });
    const missing = missingFields(row.data, row.prototype);
    if (missing.length) return res.status(400).json({ error: 'A few things need finishing first.', missing });
    const wait = submitLimit.hit(u.id);
    if (wait) return tooMany(res, wait, "You've submitted a lot today. Please try again tomorrow.");

    const checks = await runChecks(fetchImpl, row.data, row.prototype);
    const failed = hasFail(checks);
    // The advisory read only runs when the registries found everything, so it isn't spent on a
    // submission that is going straight back.
    if (!failed) checks.ai = await advisoryReview(row.data, row.prototype, checks);
    const status = failed ? 'changes' : 'review';
    const decision = failed ? { decision: 'changes', note: 'The automatic checks found something to fix. See the checks below.', at: new Date().toISOString(), by: 'checks' } : row.decision;
    await db.query('UPDATE studio_submissions SET status = $1, checks = $2::jsonb, decision = $3::jsonb, submitted_at = now(), updated_at = now() WHERE id = $4', [status, JSON.stringify(checks), decision ? JSON.stringify(decision) : null, row.id]);
    await audit(db, req, 'studio_submitted', { userId: u.id, detail: { id: row.id, status } });
    const { rows } = await db.query('SELECT * FROM studio_submissions WHERE id = $1', [row.id]);
    res.json({ submission: ownView(rows[0]) });
  }));

  async function advisoryReview(data, prototype, checks) {
    if (!ai) return { status: 'off' };
    if (aiBudget.hit('all')) return { status: 'skipped' };
    try {
      const result = await ai.review(data, prototype, checks);
      if (result.refused) return { status: 'declined' };
      const v = result.value || {};
      return {
        status: 'done',
        summary: text(v.summary, 1200),
        researchSupportsClaim: ['yes', 'partly', 'no', 'unclear'].includes(v.researchSupportsClaim) ? v.researchSupportsClaim : 'unclear',
        concerns: (Array.isArray(v.concerns) ? v.concerns : []).slice(0, 12).map((c) => ({ topic: text(c && c.topic, 20), detail: text(c && c.detail, 600) }))
      };
    } catch (error) {
      console.error(JSON.stringify({ type: 'studio', level: 'warn', at: new Date().toISOString(), event: 'advisory_review_failed', message: String(error.message).slice(0, 200) }));
      return { status: 'error' };
    }
  }

  router.post('/mine/:id/withdraw', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    const row = await own(req, res, u);
    if (!row) return;
    await db.query("UPDATE studio_submissions SET status = 'withdrawn', published_at = NULL, updated_at = now() WHERE id = $1", [row.id]);
    if (row.status === 'published') await audit(db, req, 'studio_withdrawn', { userId: u.id, detail: { id: row.id } });
    res.json({ ok: true });
  }));

  router.delete('/mine/:id', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    const row = await own(req, res, u);
    if (!row) return;
    await db.query('DELETE FROM studio_submissions WHERE id = $1', [row.id]);
    res.json({ ok: true });
  }));

  // The creator's own prototype, in the same sandbox players get.
  router.get('/mine/:id/prototype', wrap(async (req, res) => {
    const u = await user(req);
    if (!u || !validId(req.params.id)) return res.status(404).type('text/plain').send('Not found.');
    const { rows } = await db.query('SELECT prototype FROM studio_submissions WHERE id = $1 AND user_id = $2', [req.params.id, u.id]);
    if (!rows[0] || !rows[0].prototype) return res.status(404).type('text/plain').send('Not found.');
    sendSandboxed(res, rows[0].prototype);
  }));

  // The design assistant: a written idea in, an SVG mock-up out.
  router.post('/sketch', wrap(async (req, res) => {
    const u = await signedIn(req, res);
    if (!u) return;
    if (!ai) return res.status(503).json({ error: "The design assistant isn't switched on yet. You can still upload your own mock-up or describe the activity in words." });
    const description = text(req.body && req.body.description, 2000);
    if (description.length < 20) return res.status(400).json({ error: 'Describe the activity in a sentence or two first.' });
    const wait = sketchLimit.hit(u.id);
    if (wait) return tooMany(res, wait, "You've asked for a lot of sketches this hour. Please try again a little later.");
    if (aiBudget.hit('all')) return res.status(503).json({ error: 'The design assistant is resting for today. Please try again tomorrow.' });
    try {
      const result = await ai.sketch(description);
      if (result.refused) return res.status(422).json({ error: "The assistant couldn't draw this one. Try describing the activity differently." });
      const svg = safeSvg(result.value && result.value.svg);
      if (!svg) return res.status(502).json({ error: "The sketch didn't come out right. Please try again." });
      res.json({ svg, notes: text(result.value.notes, 600) });
    } catch (error) {
      console.error(JSON.stringify({ type: 'studio', level: 'warn', at: new Date().toISOString(), event: 'sketch_failed', message: String(error.message).slice(0, 200) }));
      res.status(502).json({ error: "The design assistant didn't answer. Please try again in a minute." });
    }
  }));

  // ---------- reviewers ----------

  async function reviewer(req, res) {
    const u = await user(req);
    if (!isReviewer(u)) { res.status(u ? 403 : 401).json({ error: 'Only reviewers can see this.' }); return null; }
    return u;
  }

  router.get('/review', wrap(async (req, res) => {
    const u = await reviewer(req, res);
    if (!u) return;
    const { rows } = await db.query(
      `SELECT s.*, u.email AS account_email FROM studio_submissions s JOIN users u ON u.id = s.user_id
        WHERE s.status IN ('review', 'published') ORDER BY s.submitted_at ASC LIMIT 200`
    );
    res.json({
      submissions: rows.map((row) => ({
        ...ownView(row),
        checks: row.checks, // reviewers see the abstracts the advisory read was given
        accountEmail: row.account_email, // helps confirm identity, e.g. an institution's address
        own: row.user_id === u.id
      }))
    });
  }));

  router.get('/review/:id/prototype', wrap(async (req, res) => {
    const u = await user(req);
    if (!isReviewer(u) || !validId(req.params.id)) return res.status(404).type('text/plain').send('Not found.');
    const { rows } = await db.query('SELECT prototype FROM studio_submissions WHERE id = $1', [req.params.id]);
    if (!rows[0] || !rows[0].prototype) return res.status(404).type('text/plain').send('Not found.');
    sendSandboxed(res, rows[0].prototype);
  }));

  router.post('/review/:id', wrap(async (req, res) => {
    const u = await reviewer(req, res);
    if (!u) return;
    if (!validId(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const { rows } = await db.query('SELECT * FROM studio_submissions WHERE id = $1', [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Not found.' });
    if (row.user_id === u.id) return res.status(403).json({ error: 'Someone else has to review your own submission.' });
    const decision = req.body && req.body.decision;
    const note = text(req.body && req.body.note, 1000);
    const allowed = row.status === 'review' ? ['publish', 'changes', 'reject'] : row.status === 'published' ? ['unpublish'] : [];
    if (!allowed.includes(decision)) return res.status(409).json({ error: "That decision doesn't apply to this submission now." });
    if (decision !== 'publish' && note.length < 5) return res.status(400).json({ error: 'Add a note so the creator knows why.' });
    const status = { publish: 'published', changes: 'changes', reject: 'rejected', unpublish: 'changes' }[decision];
    await db.query(
      `UPDATE studio_submissions SET status = $1, decision = $2::jsonb, updated_at = now(),
              published_at = CASE WHEN $1 = 'published' THEN now() ELSE NULL END WHERE id = $3`,
      [status, JSON.stringify({ decision, note, at: new Date().toISOString(), by: u.id }), row.id]
    );
    await audit(db, req, 'studio_decision', { userId: u.id, detail: { id: row.id, decision } });
    res.json({ ok: true, status });
  }));

  return router;
}

module.exports = { studioRouter, cleanData, missingFields, publicView, SANDBOX_CSP };
