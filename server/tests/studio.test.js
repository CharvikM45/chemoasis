// Research Studio API tests, against pg-mem, with the public registries and Claude replaced by
// stand-ins (no network). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { migrate } = require('../db');
const { createApp } = require('../app');
const { safeSvg } = require('../studio-ai');
const { npiChecksumOk, orcidChecksumOk } = require('../studio-checks');

const ORCID = '0000-0002-1825-0097'; // ORCID's own example iD, with a valid check digit
const NPI = '1234567893'; // the registry's documented example of a valid NPI

// Answers like the real registries for the records below; anything else is "not found".
function fakeRegistries({ down = false } = {}) {
  const calls = [];
  const json = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });
  const impl = async (url) => {
    calls.push(String(url));
    if (down) throw new Error('network down');
    if (url.includes('pub.orcid.org')) {
      return url.includes(ORCID) ? json(200, { name: { 'given-names': { value: 'Josiah' }, 'family-name': { value: 'Carberry' } } }) : json(404, {});
    }
    if (url.includes('npiregistry')) {
      return json(200, url.includes(NPI) ? { result_count: 1, results: [{ basic: { first_name: 'JOSIAH', last_name: 'CARBERRY' }, taxonomies: [{ primary: true, desc: 'Occupational Therapist' }], addresses: [{ state: 'RI' }] }] } : { result_count: 0, results: [] });
    }
    if (url.includes('api.crossref.org')) {
      return url.includes('10.1000%2Freal') ? json(200, { message: { title: ['Cognitive training after chemotherapy: a pilot trial'], 'container-title': ['Journal of Example Oncology'], issued: { 'date-parts': [[2021, 3]] }, abstract: '<jats:p>Small pilot.</jats:p>' } }) : json(404, {});
    }
    if (url.includes('esummary')) return json(200, { result: { 31234567: { title: 'Memory after cancer treatment', fulljournalname: 'Example Neuro-Oncology', pubdate: '2019 Jun' } } });
    if (url.includes('efetch')) return { status: 200, ok: true, text: async () => 'An abstract.' };
    return json(404, {});
  };
  return { impl, calls };
}

function fakeAi() {
  const calls = { sketch: 0, review: 0 };
  return {
    calls,
    sketch: async () => { calls.sketch++; return { value: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#1c120d"/><text x="40" y="80" fill="#f4e9df">Pause</text></svg>', notes: 'Big cards in a grid.' } }; },
    review: async () => { calls.review++; return { value: { summary: 'The pilot is small.', researchSupportsClaim: 'partly', concerns: [{ topic: 'claims', detail: 'Says "improves" for a pilot.' }] } }; }
  };
}

async function start({ registries = fakeRegistries(), ai = null } = {}) {
  const { Pool } = newDb().adapters.createPg();
  const db = new Pool();
  await migrate(db);
  const app = createApp({ db, isProd: false, moderators: ['mod@example.com'], fetchImpl: registries.impl, studioAi: ai });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, cookie } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch (_) { /* HTML or text */ }
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json, raw, headers: res.headers, cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  const signUp = async (email, name) => (await call('POST', '/api/auth/signup', { body: { email, name, password: 'gentle-steps-42', consent: true } })).cookie;
  return { db, call, signUp, registries, close: () => new Promise((r) => server.close(r)) };
}

// A complete submission. Placeholder people and studies only.
function complete(overrides = {}) {
  return {
    activity: {
      title: 'Garden Recall', area: 'memory',
      summary: 'Remember where flowers were planted, then plant them again.',
      howToPlay: 'Watch a few flowers appear in a garden, then tap where each one was. No timer.',
      audience: 'People during or after chemotherapy who notice memory changes.',
      claim: 'A small pilot found people enjoyed short memory practice like this and kept it up.',
      limitations: 'One small pilot without a control group.'
    },
    research: [{ link: 'https://doi.org/10.1000/real', note: 'Pilot of short daily memory practice.' }],
    creator: { name: 'Josiah Carberry, PhD', credentials: 'PhD', specialty: 'Neuropsychology', institution: 'Example University', location: 'Rhode Island, US', orcid: 'https://orcid.org/' + ORCID, showInstitution: true, showLocation: false },
    prototypeKind: 'html', agreed: true,
    ...overrides
  };
}
const GAME = '<!doctype html><html lang="en"><body><button>Pause</button><script>document.body.dataset.ok = 1;</script></body></html>';

test('check digits: ORCID and NPI', () => {
  assert.ok(orcidChecksumOk(ORCID));
  assert.ok(orcidChecksumOk('0000-0002-1694-233X'));
  assert.ok(!orcidChecksumOk('0000-0002-1825-0098'));
  assert.ok(npiChecksumOk(NPI));
  assert.ok(!npiChecksumOk('1234567890'));
});

test('the Studio needs an account to create, and drafts belong to their creator', async () => {
  const t = await start();
  try {
    assert.strictEqual((await t.call('POST', '/api/studio/mine', { body: { data: complete() } })).status, 401);
    assert.deepStrictEqual((await t.call('GET', '/api/studio/status')).json, { signedIn: false, reviewer: false, assistant: false });
    const ana = await t.signUp('ana@example.com', 'Ana');
    const ben = await t.signUp('ben@example.com', 'Ben');
    const made = await t.call('POST', '/api/studio/mine', { body: { data: { activity: { title: 'Half done', area: 'not-an-area' }, extra: 'dropped' } }, cookie: ana });
    assert.strictEqual(made.status, 201);
    const draft = made.json.submission;
    assert.strictEqual(draft.status, 'draft');
    assert.strictEqual(draft.data.activity.area, '', 'unknown areas are dropped');
    assert.strictEqual(draft.data.extra, undefined, 'unknown fields are dropped');
    assert.strictEqual((await t.call('GET', '/api/studio/mine/' + draft.id, { cookie: ben })).status, 404, "nobody else can open someone's draft");
    assert.strictEqual((await t.call('PUT', '/api/studio/mine/' + draft.id, { body: { data: complete() }, cookie: ben })).status, 404);
    assert.strictEqual((await t.call('GET', '/api/studio/mine', { cookie: ben })).json.submissions.length, 0);
    assert.strictEqual((await t.call('GET', '/api/studio/published')).json.activities.length, 0, 'drafts are never public');
  } finally { await t.close(); }
});

test('submitting an incomplete draft lists what is missing, with nothing looked up', async () => {
  const t = await start();
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    const id = (await t.call('POST', '/api/studio/mine', { body: { data: complete({ agreed: false, creator: { ...complete().creator, orcid: '0000-0002-1825-0098' }, research: [{ link: 'my blog post' }] }) }, cookie: ana })).json.submission.id;
    const sent = await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana });
    assert.strictEqual(sent.status, 400);
    const missing = sent.json.missing.join(' | ');
    assert.match(missing, /submission agreement/);
    assert.match(missing, /ORCID iD isn't valid/);
    assert.match(missing, /DOI or a PubMed link/);
    assert.match(missing, /prototype file/);
    assert.strictEqual(t.registries.calls.length, 0, 'no registry is called until the form is complete');
  } finally { await t.close(); }
});

test('a submission with real records goes to review, a reviewer publishes it, and players see the credit', async () => {
  const ai = fakeAi();
  const t = await start({ ai });
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    const mod = await t.signUp('mod@example.com', 'Mod');
    const id = (await t.call('POST', '/api/studio/mine', { body: { data: complete({ creator: { ...complete().creator, npi: NPI } }), code: GAME }, cookie: ana })).json.submission.id;

    const sent = await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
    const s = sent.json.submission;
    assert.strictEqual(s.status, 'review', 'software never publishes: it waits for a person');
    const byKey = Object.fromEntries(s.checks.items.map((i) => [i.key, i]));
    assert.strictEqual(byKey.orcid.status, 'pass');
    assert.strictEqual(byKey.npi.status, 'pass');
    assert.strictEqual(byKey.wording.status, 'pass');
    assert.strictEqual(byKey.prototype.status, 'pass');
    assert.strictEqual(s.checks.research[0].title, 'Cognitive training after chemotherapy: a pilot trial');
    assert.strictEqual(s.checks.research[0].abstract, undefined, 'abstracts are for the reviewer, not sent back');
    assert.strictEqual(s.checks.ai.status, 'done');
    assert.strictEqual(ai.calls.review, 1);
    assert.strictEqual((await t.call('PUT', '/api/studio/mine/' + id, { body: { data: complete() }, cookie: ana })).status, 409, 'no edits while in review');
    assert.strictEqual((await t.call('GET', '/api/studio/published')).json.activities.length, 0);

    // Only reviewers see the queue, and they see the advisory read and the abstracts.
    assert.strictEqual((await t.call('GET', '/api/studio/review', { cookie: ana })).status, 403);
    const queue = (await t.call('GET', '/api/studio/review', { cookie: mod })).json.submissions;
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].accountEmail, 'ana@example.com');
    assert.match(queue[0].checks.research[0].abstract, /Small pilot/);
    assert.strictEqual(queue[0].checks.ai.concerns[0].topic, 'claims');
    const preview = await t.call('GET', `/api/studio/review/${id}/prototype`, { cookie: mod });
    assert.strictEqual(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /^sandbox allow-scripts;.*connect-src 'none'/);

    assert.strictEqual((await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'reject' }, cookie: mod })).status, 400, 'a rejection needs a reason');
    assert.strictEqual((await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish' }, cookie: ana })).status, 403, 'creators cannot publish');
    assert.strictEqual(queue[0].hasCode, true);
    assert.strictEqual(queue[0].code, undefined, "the queue doesn't carry the prototypes' code");
    assert.strictEqual((await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish' }, cookie: mod })).status, 409, 'a decision says which version it is about');
    const decided = await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish', submittedAt: queue[0].submittedAt }, cookie: mod });
    assert.strictEqual(decided.json.status, 'published');
    const audits = await t.db.query("SELECT detail FROM audit_log WHERE event = 'studio_decision'");
    assert.strictEqual(audits.rows[0].detail.decision, 'publish', 'every decision is recorded');

    // The public listing: credit as the creator chose it, sources from the registry.
    const listed = (await t.call('GET', '/api/studio/published')).json.activities;
    assert.strictEqual(listed.length, 1);
    const a = listed[0];
    assert.strictEqual(a.creator.name, 'Josiah Carberry, PhD');
    assert.strictEqual(a.creator.verified, true);
    assert.strictEqual(a.creator.institution, 'Example University');
    assert.strictEqual(a.creator.location, '', 'location stays hidden unless the creator shows it');
    assert.strictEqual(a.creator.orcidUrl, 'https://orcid.org/' + ORCID);
    assert.deepStrictEqual(a.research[0], { title: 'Cognitive training after chemotherapy: a pilot trial', journal: 'Journal of Example Oncology', year: '2021', url: 'https://doi.org/10.1000/real' });
    assert.strictEqual(JSON.stringify(a).includes('ana@example.com'), false, 'the account email is never public');
    assert.strictEqual(JSON.stringify(a).includes(NPI), false, 'the NPI number itself is not shown');

    // The game runs sandboxed: its own origin, no internet, framed only by this site.
    const play = await t.call('GET', '/api/studio/play/' + id);
    assert.strictEqual(play.status, 200);
    assert.strictEqual(play.raw, GAME);
    const csp = play.headers.get('content-security-policy');
    assert.match(csp, /sandbox allow-scripts(;|$)/);
    assert.doesNotMatch(csp, /allow-same-origin|allow-top-navigation|allow-forms|allow-popups/);
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.strictEqual(play.headers.get('x-frame-options'), 'SAMEORIGIN');

    // Withdrawing takes it down at once.
    assert.strictEqual((await t.call('POST', `/api/studio/mine/${id}/withdraw`, { cookie: ana })).status, 200);
    assert.strictEqual((await t.call('GET', '/api/studio/published')).json.activities.length, 0);
    assert.strictEqual((await t.call('GET', '/api/studio/play/' + id)).status, 404);
  } finally { await t.close(); }
});

test('records that do not exist send it straight back, without a reviewer or the advisory read', async () => {
  const ai = fakeAi();
  const t = await start({ ai });
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    const data = complete({ research: [{ link: '10.1000/made-up', note: '' }] });
    const id = (await t.call('POST', '/api/studio/mine', { body: { data, code: GAME }, cookie: ana })).json.submission.id;
    const s = (await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana })).json.submission;
    assert.strictEqual(s.status, 'changes');
    assert.strictEqual(s.checks.research[0].status, 'fail');
    assert.strictEqual(ai.calls.review, 0);
    assert.match(s.decision.note, /automatic checks/);
    // Fixed and sent again, it goes through.
    assert.strictEqual((await t.call('PUT', '/api/studio/mine/' + id, { body: { data: complete(), code: GAME }, cookie: ana })).status, 200);
    assert.strictEqual((await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana })).json.submission.status, 'review');
  } finally { await t.close(); }
});

test('a registry that is down, a name that does not match and big promises all go to the reviewer as warnings', async () => {
  const t = await start({ registries: fakeRegistries({ down: true }) });
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    const data = complete({ activity: { ...complete().activity, summary: 'This game cures chemo brain, guaranteed.' } });
    const id = (await t.call('POST', '/api/studio/mine', { body: { data, code: '<script>fetch("https://evil.example")</script>' }, cookie: ana })).json.submission.id;
    const s = (await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana })).json.submission;
    assert.strictEqual(s.status, 'review');
    const byKey = Object.fromEntries(s.checks.items.map((i) => [i.key, i]));
    assert.strictEqual(byKey.orcid.status, 'warn');
    assert.match(byKey.wording.message, /"cures".*"guaranteed"/);
    assert.match(byKey.prototype.message, /internet/);
    assert.strictEqual(s.checks.research[0].status, 'warn');
    assert.strictEqual(s.checks.ai.status, 'off', 'no key, no advisory read');
  } finally { await t.close(); }

  const t2 = await start();
  try {
    const ana = await t2.signUp('ana@example.com', 'Ana');
    const id = (await t2.call('POST', '/api/studio/mine', { body: { data: complete({ creator: { ...complete().creator, name: 'Someone Else' } }), code: GAME }, cookie: ana })).json.submission.id;
    const s = (await t2.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana })).json.submission;
    const orcid = s.checks.items.find((i) => i.key === 'orcid');
    assert.strictEqual(orcid.status, 'warn');
    assert.match(orcid.message, /Josiah Carberry/);
    // Not verified, so a published card wouldn't carry the badge.
  } finally { await t2.close(); }
});

test("reviewers can't decide on their own submission", async () => {
  const t = await start();
  try {
    const mod = await t.signUp('mod@example.com', 'Mod');
    const id = (await t.call('POST', '/api/studio/mine', { body: { data: complete(), code: GAME }, cookie: mod })).json.submission.id;
    await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: mod });
    const own = await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish' }, cookie: mod });
    assert.strictEqual(own.status, 403);
  } finally { await t.close(); }
});

test('the design assistant: off without a key, and when on, only a safe drawing comes back', async () => {
  const off = await start();
  try {
    const ana = await off.signUp('ana@example.com', 'Ana');
    const res = await off.call('POST', '/api/studio/sketch', { body: { description: 'A calm memory game with flowers in a garden.' }, cookie: ana });
    assert.strictEqual(res.status, 503);
  } finally { await off.close(); }

  const ai = fakeAi();
  const t = await start({ ai });
  try {
    assert.strictEqual((await t.call('POST', '/api/studio/sketch', { body: { description: 'A calm memory game with flowers in a garden.' } })).status, 401);
    const ana = await t.signUp('ana@example.com', 'Ana');
    assert.strictEqual((await t.call('GET', '/api/studio/status', { cookie: ana })).json.assistant, true);
    assert.strictEqual((await t.call('POST', '/api/studio/sketch', { body: { description: 'short' }, cookie: ana })).status, 400);
    const res = await t.call('POST', '/api/studio/sketch', { body: { description: 'A calm memory game with flowers in a garden.' }, cookie: ana });
    assert.strictEqual(res.status, 200);
    assert.match(res.json.svg, /^<svg/);
    assert.strictEqual(res.json.notes, 'Big cards in a grid.');
  } finally { await t.close(); }

  assert.ok(safeSvg('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'));
  assert.strictEqual(safeSvg('<svg><script>alert(1)</script></svg>'), null);
  assert.strictEqual(safeSvg('<svg><rect onload="alert(1)"/></svg>'), null);
  assert.strictEqual(safeSvg('<svg><use href="https://evil.example/x.svg#a"/></svg>'), null);
  assert.strictEqual(safeSvg('<svg><use href="#piece"/></svg>'), '<svg><use href="#piece"/></svg>', 'links inside the drawing are fine');
  assert.strictEqual(safeSvg('<div>not svg</div>'), null);
  assert.strictEqual(safeSvg('<svg><animateTransform attributeName="transform" type="rotate"/></svg>'), null, 'no animation of any kind');
});

test('a reviewer only decides on the version they read', async () => {
  const t = await start();
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    const mod = await t.signUp('mod@example.com', 'Mod');
    const id = (await t.call('POST', '/api/studio/mine', { body: { data: complete(), code: GAME }, cookie: ana })).json.submission.id;
    await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana });
    const seen = (await t.call('GET', '/api/studio/review', { cookie: mod })).json.submissions[0].submittedAt;

    // While the reviewer reads, the creator withdraws, swaps in a different game and sends it again.
    await t.call('POST', `/api/studio/mine/${id}/withdraw`, { cookie: ana });
    assert.strictEqual((await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish', submittedAt: seen }, cookie: mod })).status, 409, 'withdrawn: nothing to decide');
    await new Promise((r) => setTimeout(r, 5));
    await t.call('PUT', '/api/studio/mine/' + id, { body: { data: complete(), code: GAME.replace('Pause', 'Stop') }, cookie: ana });
    await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana });
    const stale = await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish', submittedAt: seen }, cookie: mod });
    assert.strictEqual(stale.status, 409, 'the new version has to be looked at first');
    assert.strictEqual((await t.call('GET', '/api/studio/published')).json.activities.length, 0);

    const fresh = (await t.call('GET', '/api/studio/review', { cookie: mod })).json.submissions[0].submittedAt;
    assert.notStrictEqual(fresh, seen);
    assert.strictEqual((await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish', submittedAt: fresh }, cookie: mod })).status, 200);
  } finally { await t.close(); }
});

test('the queue lists everything waiting before what is published, and drafts stay private', async () => {
  const t = await start();
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    const mod = await t.signUp('mod@example.com', 'Mod');
    const make = async () => (await t.call('POST', '/api/studio/mine', { body: { data: complete(), code: GAME }, cookie: ana })).json.submission.id;
    const first = await make();
    const { submittedAt } = (await t.call('POST', `/api/studio/mine/${first}/submit`, { cookie: ana })).json.submission;
    await t.call('POST', `/api/studio/review/${first}`, { body: { decision: 'publish', submittedAt }, cookie: mod });
    const second = await make();
    await t.call('POST', `/api/studio/mine/${second}/submit`, { cookie: ana });
    const draft = await make();

    const queue = (await t.call('GET', '/api/studio/review', { cookie: mod })).json.submissions;
    assert.deepStrictEqual(queue.map((s) => [s.id, s.status]), [[second, 'review'], [first, 'published']]);
    assert.strictEqual((await t.call('GET', `/api/studio/review/${draft}/prototype`, { cookie: mod })).status, 404, "a reviewer can't open a draft");
  } finally { await t.close(); }
});

test('a prototype near the limit saves whole with a mock-up, and one over it is turned away', async () => {
  const t = await start();
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    // Quotes and tabs double in size as JSON, so this draft is well over 512 KB on the way in.
    const code = ('<!doctype html><p title="' + '"\t'.repeat(160000)).slice(0, 300 * 1024 - 7) + '</html>';
    const sketch = '<svg xmlns="http://www.w3.org/2000/svg">' + '<rect width="1" height="1" fill="#fff"/>'.repeat(3500) + '</svg>';
    const made = await t.call('POST', '/api/studio/mine', { body: { data: complete({ sketch }), code }, cookie: ana });
    assert.strictEqual(made.status, 201, JSON.stringify(made.json));
    assert.strictEqual(made.json.submission.code, code, 'saved whole, not cut short');
    assert.strictEqual(made.json.submission.data.sketch, sketch);

    const over = await t.call('PUT', '/api/studio/mine/' + made.json.submission.id, { body: { data: complete(), code: code + ' ' + 'x' }, cookie: ana });
    assert.strictEqual(over.status, 413);
    assert.match(over.json.error, /over 300 KB/);
    assert.strictEqual((await t.call('GET', '/api/studio/mine/' + made.json.submission.id, { cookie: ana })).json.submission.code, code, 'the saved version is untouched');
  } finally { await t.close(); }
});

test('deleting an account deletes its submissions, published ones included', async () => {
  const t = await start();
  try {
    const ana = await t.signUp('ana@example.com', 'Ana');
    const mod = await t.signUp('mod@example.com', 'Mod');
    const id = (await t.call('POST', '/api/studio/mine', { body: { data: complete(), code: GAME }, cookie: ana })).json.submission.id;
    const { submittedAt } = (await t.call('POST', `/api/studio/mine/${id}/submit`, { cookie: ana })).json.submission;
    await t.call('POST', `/api/studio/review/${id}`, { body: { decision: 'publish', submittedAt }, cookie: mod });
    assert.strictEqual((await t.call('GET', '/api/studio/published')).json.activities.length, 1);
    assert.strictEqual((await t.call('DELETE', '/api/auth/me', { cookie: ana })).status, 204);
    assert.strictEqual((await t.call('GET', '/api/studio/published')).json.activities.length, 0);
  } finally { await t.close(); }
});
