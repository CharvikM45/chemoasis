/*
 * Checks the questionnaire rules and the recommender without a browser.
 * Run from the repo root:  node account/tests/recommender.test.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

function load() {
  const window = {};
  window.window = window;
  const context = vm.createContext(Object.assign(window, { console, Date, JSON, Math, Object, Array, Set, RegExp }));
  for (const file of ["questions", "recommender", "context"]) {
    const code = fs.readFileSync(path.join(__dirname, "..", "assets", "js", file + ".js"), "utf8");
    vm.runInContext(code, context, { filename: file + ".js" });
  }
  return context.Account;
}

const Account = load();
const R = Account.recommender;
const Q = Account.questions;
const ids = (result) => result.picks.map((p) => p.game.id);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (error) {
    console.log("  ✗ " + name + "\n    " + error.message);
    process.exitCode = 1;
  }
}

console.log("Questionnaire");

check("has exactly 10 questions", () => assert.strictEqual(Q.QUESTIONS.length, 10));

check("under-18 life areas replace adult ones", () => {
  const q = Q.QUESTIONS.find((x) => x.id === "rankLife");
  const minor = Q.optionsFor(q, { age: "13-17" }).map((o) => o.id);
  const adult = Q.optionsFor(q, { age: "30-44" }).map((o) => o.id);
  assert.strictEqual(JSON.stringify(minor), JSON.stringify(["school", "homework", "sports", "hobbies", "social"]));
  assert.strictEqual(JSON.stringify(adult), JSON.stringify(["work", "household", "driving", "hobbies", "relationships"]));
});

check("age-specific diagnoses only show for the right ages", () => {
  const q = Q.QUESTIONS.find((x) => x.id === "diagnoses");
  assert.ok(!Q.optionsFor(q, { age: "u13" }).some((o) => o.id === "hormone"));
  assert.ok(!Q.optionsFor(q, { age: "45-59" }).some((o) => o.id === "growth"));
});

check("changing age drops answers that no longer apply", () => {
  const cleaned = Q.clean({ age: "13-17", rankLife: ["work", "hobbies"], diagnoses: ["hormone", "anemia"] });
  assert.strictEqual(cleaned.rankLife.join(), "hobbies");
  assert.strictEqual(cleaned.diagnoses.join(), "anemia");
});

console.log("Recommendations");

check("always returns 3 different games, even with no answers", () => {
  const result = R.recommend({}, {}, R.newModel());
  assert.strictEqual(result.picks.length, 3);
  assert.strictEqual(new Set(ids(result)).size, 3);
  assert.ok(result.picks.every((p) => p.reasons.length > 0));
});

check("trouble finding words first → Story Echo first", () => {
  const result = R.recommend({ rankCog: ["words", "memory"], rankLife: ["relationships"] }, {}, R.newModel());
  assert.strictEqual(ids(result)[0], "echo");
  assert.ok(result.picks[0].reasons[0].includes("Trouble finding words"));
});

check("hand numbness + platinum + neuropathy → Finger Rhythm first, with a care-team note", () => {
  const answers = { drugs: ["platinum"], diagnoses: ["neuropathy"], rankPhys: ["numb", "grip"], rankCog: ["focus"] };
  const result = R.recommend(answers, {}, R.newModel());
  assert.strictEqual(ids(result)[0], "rhythm");
  assert.ok(result.picks[0].notes.some((n) => n.includes("care team")));
});

check("slower thinking + slower reactions + driving → Signal Match first", () => {
  const result = R.recommend({ rankCog: ["speed"], rankPhys: ["reaction"], rankLife: ["driving"] }, {}, R.newModel());
  assert.strictEqual(ids(result)[0], "signal");
});

check("ranking order matters: second-ranked symptom's game comes after the first", () => {
  const result = R.recommend({ rankCog: ["focus", "planning"] }, {}, R.newModel());
  assert.strictEqual(ids(result).slice(0, 2).join(), "starling,cloudpath");
});

check("low energy lowers demanding games (Cloudpath, Story Echo)", () => {
  const base = { rankCog: ["planning", "words"] };
  const rested = R.recommend(Object.assign({ energy: 5, sleep: "7-9" }, base), {}, R.newModel());
  const tired = R.recommend(Object.assign({ energy: 1, sleep: "lt5" }, base), {}, R.newModel());
  const fit = (r, id) => r.picks.find((p) => p.game.id === id).fit;
  assert.ok(fit(tired, "cloudpath") < fit(rested, "cloudpath"));
  assert.ok(tired.notes.some((n) => n.includes("Make gentler")));
  assert.ok(!rested.notes.some((n) => n.includes("Make gentler")));
});

check("community topics nudge, but don't outweigh, the person's own ranking", () => {
  const ctx = { communityAreas: { hand: 12, memory: 1 } };
  const result = R.recommend({ rankCog: ["memory"] }, ctx, R.newModel());
  assert.strictEqual(ids(result)[0], "lumen");
  const noAnswers = R.recommend({}, ctx, R.newModel());
  assert.strictEqual(ids(noAnswers)[0], "rhythm");
  assert.ok(noAnswers.picks[0].reasons.some((r) => r.includes("popularity")));
});

check("own forum posts (opt-in) count as a signal", () => {
  const ownAreas = Account.context.topicsFromPosts([{ title: "Numb fingers", body: "Buttons are hard and my hands tingle." }]);
  assert.ok(ownAreas.hand > 0);
  const result = R.recommend({}, { ownAreas }, R.newModel());
  assert.strictEqual(ids(result)[0], "rhythm");
  assert.ok(result.picks[0].reasons.some((r) => r.includes("forum posts")));
});

check("topic matching uses word starts (\"handle\" is not \"hand\")", () => {
  const areas = Account.context.topicsFromPosts([{ title: "How I handle mornings", body: "" }]);
  assert.ok(!areas.hand);
});

console.log("Learning");

check("playing a game raises its fit for that person", () => {
  const answers = { rankCog: ["memory"] };
  const model = R.newModel();
  const before = R.recommend(answers, {}, model).picks.find((p) => p.game.id === "lumen").fit;
  R.record(model, "lumen", "play");
  R.train(model, answers, {});
  const after = R.recommend(answers, {}, model).picks.find((p) => p.game.id === "lumen").fit;
  assert.ok(after > before, `${after} should be > ${before}`);
  assert.ok(model.events.every((e) => e.applied));
});

check("\"Not for me\" removes a game for a week and lowers its fit", () => {
  const answers = { rankCog: ["words"] };
  const model = R.newModel();
  const fitBefore = R.score("echo", R.extract(answers, {}), model).fit;
  R.record(model, "echo", "skip", 1000);
  R.train(model, answers, {});
  const now = 1000 + 864e5;
  assert.ok(!ids(R.recommend(answers, {}, model, { now })).includes("echo"));
  assert.ok(R.score("echo", R.extract(answers, {}), model).fit < fitBefore);
  const later = R.recommend(answers, {}, model, { now: 1000 + 8 * 864e5 });
  assert.ok(ids(later).includes("echo"), "comes back after 7 days if it still fits");
});

check("events train the model only once", () => {
  const model = R.newModel();
  R.record(model, "signal", "play");
  R.train(model, {}, {});
  const once = JSON.stringify(model.delta);
  R.train(model, {}, {});
  assert.strictEqual(JSON.stringify(model.delta), once);
});

check("learned weights stay bounded after many plays", () => {
  const model = R.newModel();
  for (let i = 0; i < 500; i++) { R.record(model, "rhythm", "play"); R.train(model, { rankPhys: ["numb"] }, {}); }
  assert.ok(Object.values(model.delta.rhythm).every((w) => Math.abs(w) <= 2.5));
});

console.log("Wording");

check("never shows a percentage or a chance of benefit", () => {
  const result = R.recommend({ rankCog: ["memory"], rankPhys: ["numb"], energy: 2 }, { communityAreas: { focus: 3 } }, R.newModel());
  const text = JSON.stringify([result.picks.map((p) => [p.reasons, p.notes]), result.notes, result.heard]);
  assert.ok(!/%|probab|chance|improve|cure|treat/i.test(text), text);
});

check("balance ranked high → says there's no balance game yet", () => {
  const result = R.recommend({ rankPhys: ["balance"] }, {}, R.newModel());
  assert.ok(result.notes.some((n) => n.includes("balance")));
});

console.log(`\n${passed} checks passed${process.exitCode ? ", some failed" : ""}.`);
