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

test("more ways people say they want to die are caught too", (F) => {
  const phrases = [
    "Honestly I want to take my own life some days.",
    "I don't want to be alive anymore.",
    "I dont want to exist.",
    "There is no point in living like this.",
    "Sometimes I want to unalive myself.",
    "kms, honestly",
    "I'd rather be dead than do another round.",
    "I just want it all to end."
  ];
  for (const body of phrases) {
    const result = F.safety.review({ body });
    assert(result.alert && result.notes.some((n) => /988/.test(n.message)), "missed: " + body);
  }
  for (const body of ["I want to end the chemo on a good note.", "I want this week to end.", "She takes my life advice too seriously."]) {
    assert(!F.safety.review({ body }).alert, "false alarm: " + body);
  }
});

test("everyday ways of saying it are caught, and ordinary chemo talk is not", (F) => {
  const phrases = [
    "i wanna die",
    "I want to end it.",
    "Been thinking of ending things",
    "I don't want to go on.",
    "Everyone would be better off if I wasn't here",
    "I'm saving up my pills",
    "I wish I wouldn't wake up",
    "I've been thinking about not waking up",
    "I'm done fighting",
    "I can't do this anymore",
    "I want to disappear forever",
    "I'm going to stop my chemo and let it happen",
    "I want it all to stop",
    "I don't see the point anymore",
    // "like this" and "anymore" together (missed before, found in the site sweep, 2026-10-26).
    "Honestly I can't go on like this anymore.",
    "I can't keep going like this any more",
    "I don't want to go on like this anymore!"
  ];
  for (const body of phrases) {
    const result = F.safety.review({ body });
    assert(result.alert && result.notes.some((n) => /988/.test(n.message)), "missed: " + body);
  }
  for (const body of [
    "I didn't wake up until noon.",
    "I can't go on the trip this year.",
    "I can't keep going to the gym like before, so I walk.",
    "I want to keep going.",
    "I am done with chemo!",
    "I want the nausea to stop.",
    "I collect my pills from the pharmacy on Mondays."
  ]) {
    assert(!F.safety.review({ body }).alert, "false alarm: " + body);
  }
});

test("advice to skip a cycle or stop prescribed medicine is held, a personal story is not", (F) => {
  for (const body of ["Just skip your next cycle, it's fine.", "You can stop taking your anti-nausea meds once you feel better.", "Don't take your steroids, they're poison."]) {
    assert(F.safety.review({ body }).hold, "should hold: " + body);
  }
  for (const body of ["We had to delay my next cycle because my counts were low.", "I had to stop my steroids after cycle 3 and my doctor adjusted it."]) {
    assert(!F.safety.review({ body }).hold, "should not hold: " + body);
  }
});

test("a claim that something cures is held, but talking about a cure is not", (F) => {
  for (const body of ["This game cured my brain fog.", "Starling cures chemo brain.", "This will cure your neuropathy.", "Turmeric is a cure for cancer."]) {
    assert(F.safety.review({ body }).hold, "should hold: " + body);
  }
  for (const body of ["I hope they find a cure one day.", "My oncologist said I am cured!", "There's no cure for chemo brain, but these helped.", "I hope they find a cure for cancer."]) {
    assert(!F.safety.review({ body }).hold, "should not hold: " + body);
  }
});

test("a fever or a temperature of 100.4°F / 38°C shows the chemo fever warning", (F) => {
  const fever = (body) => F.safety.review({ body }).notes.some((n) => n.id === "fever");
  for (const body of ["I've had a fever since last night", "My temp was 100.6 this morning", "38.4 C after my infusion", "It hit 101°F", "I'm running a temperature after chemo", "Spiked a temp last night"]) {
    assert(fever(body), "missed: " + body);
  }
  for (const body of ["I slept 100 hours this week", "I reached level 38!", "My temperature was 98.6", "Normal temp, 37.2 C", "I have a temperature of 98.6 today"]) {
    assert(!fever(body), "false alarm: " + body);
  }
});

// ---------- the ChatGPT audit's misses (2026-10-26) ----------
// Every phrase the audit found slipping through, kept as written (odd spellings and look-alike
// letters included). These are test inputs, not advice.

test("crisis wording from the audit shows the 988 Lifeline and alerts moderators", (F) => {
  const phrases = [
    "I am thinking of ending my own life tonight.",
    "I am going to kill my self.",
    "I want to k1ll myself.",
    "I want to kiII myself.",
    "I want to unalive me.",
    "I might off myself tonight.",
    "Thinking about deleting myself from this world.",
    "I cannot keep going anymore.",
    "I do not want to wake up tomorrow.",
    "I wish I could go to sleep forever.",
    "Everyone would be happier if I were gone.",
    "My family would be better without me around.",
    "This is my goodbye. I will not be here tomorrow.",
    "I have decided to end everything tonight.",
    "I am going to end things after everyone falls asleep.",
    "I have been cutting my arms on purpose.",
    "I hurt my self to cope.",
    "I cannot promise I will keep myself safe tonight.",
    "I am scared I might do something to myself.",
    "I am about to do something permanent to myself.",
    "brb gonna off myself, haha but actually.",
    "I feel like ending it rn.",
    "I am going to take every pill I have.",
    "I want to stop existing permanently.",
    "I wish I was not alive.",
    "I want 2 die.",
    "I want to d!e.",
    "I will end my own life after treatment."
  ];
  for (const body of phrases) {
    const result = F.safety.review({ body });
    assert(result.alert && !result.hold, "missed: " + body);
  }
});

test("advice to change doses or skip treatment from the audit is held for a moderator", (F) => {
  const phrases = [
    "Just skip the next chemotherapy cycle.",
    "Take a break from your chemotherapy without asking anyone.",
    "Put your next chemotherapy infusion off for a month.",
    "Do not go to your chemotherapy appointment.",
    "You can safely miss a round of chemotherapy.",
    "You should discontinue the prescribed medicine.",
    "Do not take your prescribed pills.",
    "You do not need to take the pills your doctor gave you.",
    "Double your prescribed dose tonight.",
    "Take twice as much of your prescribed medication.",
    "Cut your steroid dose in half on your own.",
    "Increase the dose without checking with your doctor.",
    "Reduce your chemotherapy dose yourself.",
    "Take an extra dose if you still feel bad.",
    "Crush your chemotherapy tablets to make them work faster.",
    "Share your prescription medicines with another patient.",
    "Borrow someone else’s prescription for the same symptom.",
    "Replace chemotherapy with supplements.",
    "Cancer disappears if you only drink this juice.",
    "Skip your steroid tablets tomorrow.",
    "Do not tell your care team about the dose change.",
    "Your doctor is wrong; flush the prescription pills.",
    "Replace your prescribed medication with this natural remedy.",
    "Do not take the blood thinner your doctor prescribed.",
    "If you miss a dose, take two doses together next time.",
    "You can safely stop the antibiotics early.",
    "Wean yourself off the steroids overnight."
  ];
  for (const body of phrases) assert(F.safety.review({ body }).hold, "should hold: " + body);
  const fine = [
    "Ask your care team before you change your dose.",
    "Tell your nurse if you miss a dose.",
    "My doctor reduced my dose after cycle 2.",
    "Your oncologist may lower the dose if side effects are bad.",
    "Don't skip your anti-nausea meds.",
    "Put ice on your hands during the infusion.",
    "Don't forget to take your anti-nausea pills before the infusion."
  ];
  for (const body of fine) assert(!F.safety.review({ body }).hold, "should not hold: " + body);
});

test("urgent symptoms and fever readings from the audit show a warning", (F) => {
  const phrases = [
    "Chemo patient here, the thermometer reads 38.2 Celsius.",
    "My temperature is thirty eight degrees after chemotherapy.",
    "My temp is one hundred and one after chemo.",
    "I am on chemo and burning up with chills.",
    "I had chemotherapy yesterday and now I am shaking with rigors.",
    "My temperture is 38.5 after chemo.",
    "I have a fevr during chemotherapy.",
    "I am febrile after my infusion.",
    "My thermometer says 101.2 after chemotherapy.",
    "38,5 C after chemo, should I wait?",
    "100,6 F after chemo and I am shivering.",
    "My chest feels tight and heavy after treatment.",
    "There is crushing pressure in my chest.",
    "I cannot breathe after chemotherapy.",
    "I am struggling to breathe.",
    "I am short of breath while sitting still.",
    "I am gasping for air.",
    "I have new shortness of breath and blue lips.",
    "I lost consciousness after chemotherapy.",
    "I blacked out after my infusion.",
    "I had chemo today and now I have a feever.",
    "I am on chemotherapy and my temp is 100.45°F."
  ];
  for (const body of phrases) {
    assert(F.safety.review({ body }).notes.some((n) => n.id === "fever" || n.id === "urgent"), "missed: " + body);
  }
  const fever = (body) => F.safety.review({ body }).notes.some((n) => n.id === "fever");
  for (const body of ["I have no fever and feel fine today.", "The forecast is 101 F today.", "I got chills watching that movie.", "My walk was 100 steps."]) {
    assert(!fever(body), "false alarm: " + body);
  }
});

test("staff and clinician names from the audit are refused, ordinary names are not", async (F) => {
  const names = [
    "Dоctor Amber",
    "Mоderator Amber",
    "Nυrse Amber",
    "Admіn Amber",
    "Chemoasіs Team",
    "Мoderator Team",
    "ｍｏｄｅｒａｔｏｒ",
    "Ｄｒ Amber",
    "DoctorAmber",
    "NurseAmber",
    "AdminAmber",
    "StaffAmber",
    "DrAmber",
    "AmberMD",
    "AmberRN",
    "N.P. Amber",
    "M.D. Amber",
    "R.N. Amber",
    "CareTeam Amber",
    "OncologyNurse",
    "PharmacistAmber",
    "TherapistAmber",
    "PhysicianAmber",
    "ClinicianAmber",
    "Site Owner Amber"
  ];
  for (const name of names) {
    await rejects(F.store.updateMyProfile({ displayName: name }), "doesn't sound like a role");
  }
  for (const name of ["Drew", "Andrea", "Stafford", "Nursen", "Admira", "McKenzie", "Maria Sánchez"]) {
    const saved = await F.store.updateMyProfile({ displayName: name });
    assert(saved.displayName === name, "refused an ordinary name: " + name);
  }
});

test("look-alike copies of another member's name are refused", async (F) => {
  await addPerson(F, { id: "luna", displayName: "Luna Willow", type: "member" });
  for (const name of [
    
  ]) {
    await rejects(F.store.updateMyProfile({ displayName: name }), "already uses that name");
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

test("punctuation and look-alike spellings can't slip a staff or clinician name through", async (F) => {
  for (const name of ["Moderator_Team", "Chemoasis_Support", "Oncologist Sam", "RN Kim", "Dr.Kim", "Mod-Squad"]) {
    await rejects(F.store.updateMyProfile({ displayName: name }), "doesn't sound like a role");
  }
  for (const name of ["Former  member", "Formermember", "Member_4821"]) {
    await rejects(F.store.updateMyProfile({ displayName: name }), "gives out itself");
  }
});

test("two members can't share a display name", async (F) => {
  await addPerson(F, { id: "real-member", displayName: "Maya", type: "member" });
  await rejects(F.store.updateMyProfile({ displayName: "MAYA" }), "already uses that name");
  await rejects(F.store.updateMyProfile({ displayName: "Ma-ya" }), "already uses that name");
});

test("members can't take a name the forum gives out, but can keep their own", async (F) => {
  for (const name of ["Member 4821", "Former member", "Sam (example)"]) {
    await rejects(F.store.updateMyProfile({ displayName: name }), "gives out itself");
  }
  // River's demo name has "(example)" in it, and saving the profile resends it unchanged.
  const saved = await F.store.updateMyProfile({ displayName: "River (example)", bio: "New bio." });
  assert(saved.displayName === "River (example)" && saved.bio === "New bio.");
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

test("reports from accounts under 2 days old don't count toward hiding a post", async (F) => {
  for (const user of ["u-river", "u-sam", "u-jordan"]) { // u-jordan's account is 1 day old
    await F.store.switchDemoUser(user);
    await F.store.report("thread", "t-seated", "spam", "");
  }
  assert((await F.store.listThreads()).some((t) => t.id === "t-seated"), "a new account's report shouldn't hide the post");
  await F.store.switchDemoUser("u-mod");
  const item = (await F.store.moderationQueue()).find((i) => i.targetId === "t-seated");
  assert(item && item.reports.length === 3, "every report still reaches the moderators");
});

test("a post can only be a thread or a reply", async (F) => {
  await rejects(F.store.report("anything", "r-foggy-1", "spam", ""), "no longer exists");
  await rejects(F.store.editMyPost("anything", "t-hello", { body: "Changed" }), "your own posts");
  await rejects(F.store.deleteMyPost("anything", "t-hello"), "your own posts");
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

test("\"Other\" is the last category and gets the same safety checks", async (F) => {
  const ids = F.catalog.CATEGORIES.map((c) => c.id);
  assert(ids[ids.length - 1] === "other", "Other should be listed last");
  assert(new Set(ids).size === ids.length, "category ids must be unique");
  const held = await F.store.createThread({ categoryId: "other", title: "Big news", body: "This game cured my brain fog." });
  assert(held.status === "pending", "a cure claim in Other should be held like anywhere else");
  const crisis = await F.store.createThread({ categoryId: "other", title: "Off topic", body: "I want to die some days." });
  await F.store.switchDemoUser("u-mod");
  const queue = await F.store.moderationQueue();
  assert(queue[0].targetId === crisis.id && queue[0].support, "a crisis post in Other goes to the top of the queue");
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
