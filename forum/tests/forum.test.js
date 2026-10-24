/*
 * Checks the forum's rules without a browser: safety check, posting, privacy,
 * reports, moderation, edits, appeals and muting. Uses only demo data.
 *
 * Run from the repo root:  node forum/tests/forum.test.js
 * Needs Node 16 or newer and nothing else.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Loads the same files the pages load, with a pretend browser around them.
function freshForum() {
  const storage = {};
  const window = {
    localStorage: {
      getItem: (key) => (key in storage ? storage[key] : null),
      setItem: (key, value) => (storage[key] = String(value)),
      removeItem: (key) => delete storage[key]
    }
  };
  window.window = window;
  const context = vm.createContext(Object.assign(window, { console, Date, JSON, Math, Promise, Set, Error, URL }));
  for (const file of ["catalog", "seed", "safety", "store"]) {
    const code = fs.readFileSync(path.join(__dirname, "..", "assets", "js", file + ".js"), "utf8");
    vm.runInContext(code, context, { filename: file + ".js" });
  }
  context.Forum.__storage = window.localStorage;
  return context.Forum;
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

// Adds a person to the saved forum, the way the team would after checking them.
// The example accounts don't include a professional on purpose (see seed.js).
async function addPerson(F, profile) {
  await F.store.listThreads(); // makes sure the forum is saved before we edit it
  const key = "chemoasis-forum-demo-v1";
  const data = JSON.parse(F.__storage.getItem(key));
  data.profiles.push(Object.assign({ bio: "", showBio: false, createdAt: new Date().toISOString() }, profile));
  F.__storage.setItem(key, JSON.stringify(data));
}
const addNurse = (F) =>
  addPerson(F, { id: "u-nurse", displayName: "Checked nurse", type: "professional", professional: { verified: true, credential: "RN", specialty: "Oncology nursing" } });

function assert(condition, message) {
  if (!condition) throw new Error(message || "expected true");
}

async function rejects(promise, text) {
  try {
    await promise;
  } catch (error) {
    assert(!text || error.message.includes(text), 'expected error containing "' + text + '", got "' + error.message + '"');
    return;
  }
  throw new Error('expected an error containing "' + text + '"');
}

// ---------- safety check ----------

test("crisis language shows the 988 Lifeline and does not hold the post", (F) => {
  const result = F.safety.review({ body: "Some days I want to die." });
  assert(result.notes.some((n) => /988/.test(n.message)), "988 note missing");
  assert(!result.hold, "crisis posts should not be held");
});

test("an unsafe medical claim is held for a moderator", (F) => {
  assert(F.safety.review({ title: "This cures chemo brain", body: "Stop taking your medication." }).hold);
});

test("an ordinary post passes with no notes", (F) => {
  const result = F.safety.review({ body: "Pair Match helped me pass the time today." });
  assert(!result.hold && result.notes.length === 0);
});

test("common crisis phrases show the 988 Lifeline and alert moderators", (F) => {
  const phrases = [
    "Honestly everyone would be better off without me.",
    "I keep thinking about ending it all.",
    "There's no reason to live like this.",
    "I've been wanting to hurt myself again.",
    "I thought about taking an overdose.",
    "I can’t go on like this."
  ];
  for (const body of phrases) {
    const result = F.safety.review({ body });
    assert(result.alert && result.notes.some((n) => /988/.test(n.message)), "missed: " + body);
    assert(!result.hold, "crisis posts should not be held: " + body);
  }
});

test("a fever or a temperature of 100.4°F / 38°C shows the chemo fever warning", (F) => {
  const fever = (body) => F.safety.review({ body }).notes.some((n) => n.id === "fever");
  for (const body of ["I've had a fever since last night", "My temp was 100.6 this morning", "38.4 C after my infusion", "It hit 101°F"]) {
    assert(fever(body), "missed: " + body);
  }
  for (const body of ["I slept 100 hours this week", "I reached level 38!", "My temperature was 98.6", "Normal temp, 37.2 C"]) {
    assert(!fever(body), "false alarm: " + body);
  }
});

test("only http and https source links are accepted", (F) => {
  assert(F.safety.isValidSourceUrl("https://www.cancer.gov/"));
  assert(!F.safety.isValidSourceUrl("javascript:alert(1)"));
});

// ---------- posting and privacy ----------

test("members see visible threads but not held ones", async (F) => {
  const threads = await F.store.listThreads();
  assert(threads.length === 7, "expected 7, got " + threads.length);
  assert(!threads.some((t) => t.id === "t-held"));
});

test("an unsafe new thread is held and its author still sees it", async (F) => {
  const saved = await F.store.createThread({ categoryId: "games", title: "Miracle game", body: "This game cures neuropathy." });
  assert(saved.status === "pending");
  const { thread } = await F.store.getThread(saved.id);
  assert(thread.isOwn);
  await F.store.switchDemoUser("u-june");
  await rejects(F.store.getThread(saved.id), "isn't available");
});

test("anonymous posts hide the author from others but not from moderators", async (F) => {
  const saved = await F.store.createThread({ categoryId: "experiences", title: "Quiet post", body: "Posting anonymously.", anonymous: true });
  await F.store.switchDemoUser("u-june");
  assert((await F.store.getThread(saved.id)).thread.author.id === null);
  await F.store.switchDemoUser("u-mod");
  assert((await F.store.getThread(saved.id)).thread.author.id === "u-river");
});

test("members can't use the professional label", async (F) => {
  const saved = await F.store.createThread({ categoryId: "experiences", title: "Advice", body: "My advice.", label: "professional" });
  assert((await F.store.getThread(saved.id)).thread.label === "experience");
});

test("professional guidance is never anonymous", async (F) => {
  await addNurse(F);
  await F.store.switchDemoUser("u-nurse");
  const saved = await F.store.createThread({ categoryId: "ask-a-professional", title: "Sleep tips", body: "Some general tips.", label: "professional", anonymous: true });
  const { thread } = await F.store.getThread(saved.id);
  assert(thread.label === "professional" && !thread.anonymous);
});

test("search also looks at replies", async (F) => {
  const found = await F.store.listThreads({ query: "go-to on low-energy" });
  assert(found.length === 1 && found[0].id === "t-hello", "got " + found.map((t) => t.id));
});

test("members can't pick a name that sounds like a role", async (F) => {
  await rejects(F.store.updateMyProfile({ displayName: "Nurse Kim" }), "doesn't sound like a role");
});

// ---------- reports and moderation ----------

test("three different reporters hide a post until a moderator decides", async (F) => {
  for (const user of ["u-river", "u-alex", "u-sam"]) {
    await F.store.switchDemoUser(user);
    await F.store.report("thread", "t-seated", "spam", "");
  }
  await F.store.switchDemoUser("u-jordan");
  assert(!(await F.store.listThreads()).some((t) => t.id === "t-seated"));
});

test("the same person can't report a post twice", async (F) => {
  await F.store.report("thread", "t-seated", "spam", "");
  await rejects(F.store.report("thread", "t-seated", "spam", ""), "already reported");
});

test("only moderators can open the review queue or resolve reports", async (F) => {
  await rejects(F.store.moderationQueue(), "Only moderators");
  await rejects(F.store.resolve("t-hello", "remove", ""), "Only moderators");
});

test("a post its author deleted can't be brought back by a moderator", async (F) => {
  await F.store.switchDemoUser("u-jordan");
  await F.store.deleteMyPost("reply", "r-quick-tap-2");
  await F.store.switchDemoUser("u-mod");
  await rejects(F.store.resolve("r-quick-tap-2", "keep", ""), "no longer exists");
  assert(!(await F.store.moderationQueue()).some((item) => item.targetId === "r-quick-tap-2"));
});

test("topic signals count real members' posts only, as counts", async (F) => {
  assert(Object.keys((await F.store.topicSignals(365)).areas).length === 0, "the team's example posts must not count");
  await addPerson(F, { id: "real-member", displayName: "Maya", type: "member" });
  await F.store.switchDemoUser("real-member");
  await F.store.createThread({ categoryId: "games", title: "Story Echo tips", body: "Grouping words helps me.", gameIds: ["echo"] });
  const signals = await F.store.topicSignals(365);
  const text = JSON.stringify(signals);
  assert(!/real-member|Maya|body|title|Grouping/.test(text), "signals leak people or text: " + text);
  assert(signals.games.echo === 1 && signals.areas.words === 1 && signals.areas.memory === 1, text);
});

test("the example posts don't include a made-up verified professional", async (F) => {
  const threads = await F.store.listThreads();
  for (const t of threads) {
    const { thread, replies } = await F.store.getThread(t.id);
    for (const post of [thread, ...replies]) {
      assert(post.label !== "professional", "example post uses professional guidance: " + post.id);
      assert(!(post.author.professional && post.author.professional.verified), "example verified professional: " + post.id);
    }
  }
});

test("a crisis post stays up and goes to the top of the moderators' queue", async (F) => {
  const saved = await F.store.createThread({ categoryId: "experiences", title: "Rough week", body: "Some days I feel like everyone is better off without me." });
  assert(saved.status === "visible");
  await F.store.switchDemoUser("u-june");
  assert((await F.store.listThreads()).some((t) => t.id === saved.id), "others should still see it");
  await F.store.switchDemoUser("u-mod");
  const queue = await F.store.moderationQueue();
  assert(queue[0].targetId === saved.id && queue[0].support, "it should be first in the queue");
  assert(queue[0].reports.some((r) => r.reason === "support" && r.automatic));
});

test("people can flag that someone may need support, and it never hides the post", async (F) => {
  for (const user of ["u-river", "u-june", "u-sam"]) {
    await F.store.switchDemoUser(user);
    await F.store.report("thread", "t-foggy", "support", "");
  }
  await F.store.switchDemoUser("u-jordan");
  assert((await F.store.listThreads()).some((t) => t.id === "t-foggy"), "support reports must not hide a post");
});

test("the automatic safety report doesn't count toward hiding a post", async (F) => {
  const saved = await F.store.createThread({ categoryId: "experiences", title: "Hard day", body: "I want to die some days." });
  for (const user of ["u-june", "u-sam"]) {
    await F.store.switchDemoUser(user);
    await F.store.report("thread", saved.id, "other", "");
  }
  await F.store.switchDemoUser("u-alex");
  assert((await F.store.listThreads()).some((t) => t.id === saved.id), "two people plus the safety check is not three reporters");
});

// ---------- edits ----------

test("authors can edit their own post and it's marked edited", async (F) => {
  await F.store.editMyPost("thread", "t-pair-match", { title: "Pair Match, updated", body: "New text." });
  const { thread } = await F.store.getThread("t-pair-match");
  assert(thread.title === "Pair Match, updated" && thread.editedAt);
});

test("nobody can edit someone else's post", async (F) => {
  await rejects(F.store.editMyPost("thread", "t-foggy", { body: "Changed." }), "your own");
});

test("an edit that adds an unsafe claim is held for review", async (F) => {
  const saved = await F.store.editMyPost("reply", "r-notebook-1", { body: "This cures chemo brain, stop your medication." });
  assert(saved.status === "pending");
});

test("hidden posts can't be edited", async (F) => {
  await F.store.switchDemoUser("u-mod");
  await F.store.resolve("t-quick-tap", "hide", "");
  await F.store.switchDemoUser("u-river");
  await rejects(F.store.editMyPost("thread", "t-quick-tap", { body: "Sneaky fix." }), "can't be edited");
});

test("an anonymous post can't be switched to professional guidance", async (F) => {
  await addNurse(F);
  await F.store.switchDemoUser("u-nurse");
  const saved = await F.store.createThread({ categoryId: "experiences", title: "Anon nurse post", body: "Some thoughts.", anonymous: true });
  await rejects(F.store.editMyPost("thread", saved.id, { label: "professional" }), "can't become professional");
});

// ---------- appeals ----------

test("authors can ask once for another review of a hidden post", async (F) => {
  await F.store.switchDemoUser("u-mod");
  await F.store.resolve("t-quick-tap", "hide", "");
  await F.store.switchDemoUser("u-river");
  await F.store.requestAnotherReview("thread", "t-quick-tap", "Please look again.");
  await rejects(F.store.requestAnotherReview("thread", "t-quick-tap", ""), "already asked");
  await F.store.switchDemoUser("u-mod");
  const item = (await F.store.moderationQueue()).find((i) => i.targetId === "t-quick-tap");
  assert(item && item.reports.some((r) => r.reason === "appeal"));
});

test("visible posts and other people's posts can't be appealed", async (F) => {
  await rejects(F.store.requestAnotherReview("thread", "t-pair-match", ""), "Only hidden or removed");
  await rejects(F.store.requestAnotherReview("thread", "t-foggy", ""), "your own");
});

// ---------- muting ----------

test("muting hides someone's named posts and replies from you only", async (F) => {
  await F.store.setMuted("u-june", true);
  assert(!(await F.store.listThreads()).some((t) => t.id === "t-seated"));
  const { replies, mutedCount } = await F.store.getThread("t-pair-match");
  assert(!replies.some((r) => r.id === "r-pair-1") && mutedCount === 1);
  await F.store.switchDemoUser("u-alex");
  assert((await F.store.listThreads()).some((t) => t.id === "t-seated"));
});

test("moderators and yourself can't be muted", async (F) => {
  await rejects(F.store.setMuted("u-mod", true), "Moderators can't be muted");
  await rejects(F.store.setMuted("u-river", true), "can't mute");
});

test("muting never hides anonymous posts, which would reveal their author", async (F) => {
  await F.store.switchDemoUser("u-june");
  const saved = await F.store.createThread({ categoryId: "experiences", title: "Anon by June", body: "Hello.", anonymous: true });
  await F.store.switchDemoUser("u-river");
  await F.store.setMuted("u-june", true);
  assert((await F.store.listThreads()).some((t) => t.id === saved.id));
});

// ---------- fixes from the Claudex review ----------

test("authors can't delete a post a moderator has hidden", async (F) => {
  await F.store.switchDemoUser("u-mod");
  await F.store.resolve("t-quick-tap", "hide", "");
  await F.store.switchDemoUser("u-river");
  await rejects(F.store.deleteMyPost("thread", "t-quick-tap"), "can't be deleted");
});

test("hidden posts stay listed for moderators after the reports close", async (F) => {
  await F.store.switchDemoUser("u-mod");
  await F.store.resolve("t-quick-tap", "hide", "");
  assert(!(await F.store.moderationQueue()).some((i) => i.targetId === "t-quick-tap"));
  assert((await F.store.hiddenPosts()).some((i) => i.targetId === "t-quick-tap"));
});

test("people can't report their own post or one that isn't visible", async (F) => {
  await rejects(F.store.report("thread", "t-pair-match", "spam", ""), "your own post");
  await rejects(F.store.report("thread", "t-held", "spam", ""), "no longer exists");
});

test("a reported post can't be edited until a moderator has seen it", async (F) => {
  await F.store.switchDemoUser("u-june");
  await F.store.report("thread", "t-pair-match", "misinformation", "");
  await F.store.switchDemoUser("u-river");
  await rejects(F.store.editMyPost("thread", "t-pair-match", { body: "Different text now." }), "reviews a report");
});

test("changes made in another tab aren't overwritten", async (F) => {
  await F.store.createThread({ categoryId: "welcome", title: "From tab one", body: "Hello." });
  const raw = JSON.parse(F.__storage.getItem("chemoasis-forum-demo-v1"));
  raw.threads.push(Object.assign({}, raw.threads[0], { id: "t-other-tab", title: "From tab two" }));
  F.__storage.setItem("chemoasis-forum-demo-v1", JSON.stringify(raw));
  await F.store.createThread({ categoryId: "welcome", title: "From tab one again", body: "Hello." });
  const titles = (await F.store.listThreads()).map((t) => t.title);
  assert(titles.includes("From tab two") && titles.includes("From tab one again"));
});

// ---------- game tags ----------

test("forum game tags match the six games in the library", (F) => {
  const recommender = fs.readFileSync(path.join(__dirname, "..", "..", "account", "assets", "js", "recommender.js"), "utf8");
  const library = [...recommender.matchAll(/\{ id: "(\w+)", name: "([^"]+)", area: "[^"]*", areas: \[([^\]]*)\]/g)].map((m) => ({
    id: m[1],
    name: m[2],
    areas: m[3].split(",").map((a) => a.trim().replace(/"/g, ""))
  }));
  assert(library.length === 6, "expected 6 library games, found " + library.length);
  assert(JSON.stringify(F.catalog.GAMES) === JSON.stringify(library), "catalog.js GAMES differs from recommender.js GAMES");
  library.forEach((game) => game.areas.forEach((area) => assert(F.catalog.area(area), "no training area " + area)));
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try {
      await run(freshForum());
      console.log("ok   " + name);
    } catch (error) {
      failed++;
      console.log("FAIL " + name + "\n     " + error.message);
    }
  }
  console.log("\n" + (tests.length - failed) + " of " + tests.length + " passed");
  process.exit(failed ? 1 : 0);
})();
