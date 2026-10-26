/*
 * Starter-game recommender.
 *
 * A small, explainable learning model:
 *   1. extract()  turns questionnaire answers + app context into named features.
 *   2. Each game has a linear model: score = Σ (prior weight + learned weight) × feature.
 *      Prior weights are hand-set from the questionnaire's meaning (e.g. "trouble finding
 *      words" → Story Echo). They need review by qualified professionals before launch.
 *   3. learn() nudges one person's weights with online logistic regression whenever
 *      they play a game (1) or say "Not for me" (0), so suggestions follow what they
 *      actually choose.
 *   4. recommend() ranks the games, keeps the top 3 varied, and explains each pick
 *      with the features that contributed most.
 *
 * The score is how well a game fits someone's answers and choices. It is NOT a
 * probability of medical benefit, and the app never shows it as one.
 *
 * Data only, no page code: loads in the browser and in Node tests.
 */
window.Account = window.Account || {};

Account.recommender = (function () {
  const GAMES = [
    { id: "lumen", name: "Lumen Garden", area: "Working memory", areas: ["memory"], blurb: "Repeat a growing path of lights, forwards and then backwards.", icon: "✿" },
    { id: "starling", name: "Starling Observatory", area: "Processing speed", areas: ["focus"], blurb: "Catch what flashes in the center and at the edges, faster each time.", icon: "✧" },
    { id: "cloudpath", name: "Cloudpath Cartographer", area: "Planning", areas: ["planning"], blurb: "Plan the fewest moves to match a goal, Tower of London style.", icon: "⌁" },
    { id: "echo", name: "Story Echo", area: "Verbal memory", areas: ["words", "memory"], blurb: "Learn word lists with memory strategies; lists grow as you improve.", icon: "☷" },
    { id: "rhythm", name: "Finger Rhythm", area: "Hand coordination", areas: ["hand"], blurb: "Tap glowing pads at your own pace while a hidden pattern repeats. Challenge mode speeds up.", icon: "◉" },
    { id: "signal", name: "Signal Match", area: "Mental flexibility", areas: ["speed", "focus"], blurb: "Sort by shape or by fill as the rule keeps switching.", icon: "◇" }
  ];

  const AREA_NAMES = {
    memory: "memory", words: "word-finding", focus: "focus", speed: "thinking speed",
    planning: "planning", hand: "hand coordination", movement: "movement", balance: "balance"
  };

  // Prior weights per game. "gentle" is high on low-energy days, so demanding games get a negative weight.
  const PRIOR = {
    lumen: {
      bias: -1.0, "cog:memory": 2.0, "cog:planning": 0.3,
      "life:work": 0.3, "life:social": 0.4, "life:school": 0.5, "life:homework": 0.7,
      "drug:methotrexate": 0.4, "drug:anthracycline": 0.3, "dx:b12d": 0.2, "dx:hormone": 0.3, "cancer:brain": 0.4,
      gentle: 0.3, "community:memory": 0.3, "own:memory": 0.9, "played:lumen": 0.25
    },
    starling: {
      bias: -1.05, "cog:focus": 2.0, "cog:speed": 1.0, "phys:reaction": 0.5,
      "life:work": 0.5, "life:driving": 0.6, "life:school": 0.6, "life:homework": 0.4,
      "med:any": 0.4, "dx:anemia": 0.3, "dx:thyroid": 0.3, "dx:b12d": 0.2, short_sleep: 0.3,
      gentle: 0.2, "community:focus": 0.3, "own:focus": 0.9, "played:starling": 0.25
    },
    cloudpath: {
      bias: -1.1, "cog:planning": 2.0, "cog:focus": 0.3,
      "life:household": 0.7, "life:work": 0.6, "life:homework": 0.5, "dx:hormone": 0.2,
      gentle: -0.6, "age:child": -0.3, "community:planning": 0.3, "own:planning": 0.9, "played:cloudpath": 0.25
    },
    echo: {
      bias: -1.15, "cog:words": 2.0, "cog:memory": 0.9,
      "life:social": 0.7, "life:work": 0.3, "life:school": 0.4, "life:homework": 0.4,
      "drug:methotrexate": 0.4, "cancer:brain": 0.3, "dx:hormone": 0.2,
      gentle: -0.5, "age:child": -0.4, "community:memory": 0.15, "own:words": 0.9, "own:memory": 0.3, "played:echo": 0.25
    },
    rhythm: {
      bias: -1.0, "phys:numb": 2.0, "phys:grip": 1.8, "phys:balance": 0.4, "phys:fatigue": 0.2,
      "life:household": 0.5, "life:hobbies": 0.6, "life:sports": 0.5,
      "drug:platinum": 0.6, "drug:taxane": 0.6, "drug:vinca": 0.6, "dx:neuropathy": 1.2,
      gentle: 0.3, "community:hand": 0.3, "community:movement": 0.1, "own:hand": 0.9, "played:rhythm": 0.25
    },
    signal: {
      bias: -1.05, "cog:speed": 2.0, "cog:focus": 0.6, "phys:reaction": 1.5,
      "life:driving": 0.8, "life:sports": 0.5, "life:work": 0.3, "med:any": 0.2,
      gentle: 0.1, "community:speed": 0.3, "community:focus": 0.1, "own:speed": 0.9, "played:signal": 0.25
    }
  };

  const LEARNING_RATE = { play: 0.35, skip: 0.8 };
  const WEIGHT_LIMIT = 2.5;
  const DECAY = 0.01; // pulls learned weights back toward the priors over time
  const DISMISS_DAYS = 7;
  const DIVERSITY = 0.12;

  const sigmoid = (s) => 1 / (1 + Math.exp(-s));
  const rankWeight = (i) => Math.max(0.1, 1 - i * 0.22);
  const ORDINAL = ["first", "second", "third", "fourth", "fifth"];

  const DRUG_TEXT = {
    platinum: "You listed platinum-based chemo, which is often linked to numbness in the hands and feet",
    taxane: "You listed taxanes, which are often linked to numbness in the hands and feet",
    vinca: "You listed vincristine, which is often linked to numbness in the hands and feet",
    methotrexate: "You listed methotrexate; some people notice thinking changes after it",
    anthracycline: "You listed anthracyclines; many people notice memory changes during or after chemotherapy"
  };
  const DX_TEXT = {
    neuropathy: "A doctor has told you about peripheral neuropathy",
    anemia: "You mentioned anemia, which can affect energy",
    thyroid: "You mentioned thyroid issues, which can affect energy and focus",
    b12d: "You mentioned low B12 or vitamin D; low B12 is known to affect memory, so it's worth raising with your care team",
    hormone: "You mentioned hormone changes, which can affect memory and focus"
  };

  const label = (q, id) => (window.Account.questions ? Account.questions.label(q, id) : id);

  /* ---------- features ---------- */

  function extract(answers, context) {
    const a = answers || {};
    const ctx = context || {};
    const x = { bias: 1 };
    const why = {};
    const set = (f, v, text) => {
      if (!v) return;
      x[f] = (x[f] || 0) + v;
      if (text && !why[f]) why[f] = text;
    };

    (a.rankCog || []).forEach((id, i) => set("cog:" + id, rankWeight(i),
      i === 0 ? `You said “${label("rankCog", id)}” bothers you most` : `You ranked “${label("rankCog", id)}” ${ORDINAL[i]} among thinking symptoms`));
    (a.rankPhys || []).forEach((id, i) => set("phys:" + id, rankWeight(i),
      i === 0 ? `You said “${label("rankPhys", id)}” bothers you most` : `You ranked “${label("rankPhys", id)}” ${ORDINAL[i]} among physical symptoms`));
    (a.rankLife || []).forEach((id, i) => {
      const f = "life:" + (id === "relationships" ? "social" : id);
      set(f, rankWeight(i), i === 0 ? `You said “${label("rankLife", id)}” is most affected` : `You said “${label("rankLife", id)}” is affected too`);
    });

    (a.drugs || []).forEach((id) => set("drug:" + id, DRUG_TEXT[id] ? 1 : 0, DRUG_TEXT[id]));
    (a.diagnoses || []).forEach((id) => set("dx:" + id, DX_TEXT[id] ? 1 : 0, DX_TEXT[id]));

    const meds = (a.meds || []).filter((id) => id !== "none" && id !== "unsure");
    set("med:any", Math.min(1, meds.length / 2), "Some of your medications can affect focus or energy");

    const sleep = { lt5: 1, "5-7": 0.5 }[a.sleep] || 0;
    set("short_sleep", sleep, a.sleep === "lt5" ? "You usually sleep under 5 hours" : "You usually sleep 5 to 7 hours");
    const lowEnergy = a.energy ? (5 - a.energy) / 4 : 0;

    set("status:active", { active: 1, lt6m: 0.5 }[a.status] || 0, a.status === "active" ? "You're currently in chemo" : "You finished chemo recently");
    set("age:child", a.age === "u13" ? 1 : 0, "Made for younger players too");
    set("age:older", { "60-74": 0.5, "75+": 1 }[a.age] || 0);
    set("cancer:brain", a.cancer === "brain" ? 1 : 0, "You were treated for a brain or spinal cord cancer");

    // How much to favor short, gentle games. Not a health measure: just pacing.
    const fatigue = (a.rankPhys || []).indexOf("fatigue");
    const gentle = Math.max(
      lowEnergy,
      sleep * 0.6,
      (x["status:active"] || 0) * 0.6,
      (x["med:any"] || 0) * 0.4,
      (x["age:older"] || 0) * 0.4,
      fatigue >= 0 ? rankWeight(fatigue) * 0.5 : 0
    );
    set("gentle", Math.round(gentle * 100) / 100,
      a.energy && a.energy <= 2 ? `You rated your energy ${a.energy} out of 5, and this one is quick and starts easy` : "Quick to play and starts easy, which can suit lower-energy days");

    // Context from the rest of the app.
    const community = ctx.communityAreas || {};
    const maxCommunity = Math.max(0, ...Object.values(community));
    for (const [area, n] of Object.entries(community)) {
      if (maxCommunity) set("community:" + area, (n / maxCommunity) * 0.6, `${cap(AREA_NAMES[area] || area)} is a common topic in the community right now (popularity, not proof it helps)`);
    }
    for (const [area, v] of Object.entries(ctx.ownAreas || {})) {
      set("own:" + area, Math.min(1, v), `Your forum posts mention ${AREA_NAMES[area] || area}`);
    }
    for (const [game, n] of Object.entries(ctx.plays || {})) {
      set("played:" + game, Math.min(1, n / 3), "You've played this before");
    }

    return { x, why };
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- model ---------- */

  function newModel() {
    return { version: 1, delta: {}, events: [], dismissed: {} };
  }

  function weight(model, gameId, f) {
    const d = model && model.delta[gameId];
    return (PRIOR[gameId][f] || 0) + ((d && d[f]) || 0);
  }

  function score(gameId, features, model) {
    let s = 0;
    const parts = [];
    for (const [f, v] of Object.entries(features.x)) {
      const c = weight(model, gameId, f) * v;
      s += c;
      if (f !== "bias" && c > 0.05) parts.push({ f, c });
    }
    parts.sort((p, q) => q.c - p.c);
    return { fit: sigmoid(s), parts };
  }

  // One step of online logistic regression on this person's weights for one game.
  function learn(model, gameId, features, label, rate) {
    if (!PRIOR[gameId]) return model;
    const d = model.delta[gameId] || (model.delta[gameId] = {});
    const { fit } = score(gameId, features, model);
    const grad = label - fit;
    for (const [f, v] of Object.entries(features.x)) {
      const next = ((d[f] || 0) * (1 - DECAY)) + rate * grad * v;
      d[f] = Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, next));
    }
    return model;
  }

  // Applies any play / skip events that haven't trained the model yet.
  function train(model, answers, context) {
    const features = extract(answers, context);
    for (const e of model.events) {
      if (e.applied) continue;
      if (e.kind === "play") learn(model, e.game, features, 1, LEARNING_RATE.play);
      if (e.kind === "skip") learn(model, e.game, features, 0, LEARNING_RATE.skip);
      e.applied = true;
    }
    return model;
  }

  function record(model, gameId, kind, now) {
    const at = now || Date.now();
    model.events.push({ game: gameId, kind, at, applied: false });
    if (model.events.length > 300) model.events.splice(0, model.events.length - 300);
    if (kind === "skip") model.dismissed[gameId] = at;
    if (kind === "play") delete model.dismissed[gameId];
    return model;
  }

  /* ---------- ranking ---------- */

  function recommend(answers, context, model, options) {
    const opts = options || {};
    const count = opts.count || 3;
    const now = opts.now || Date.now();
    const m = model || newModel();
    const features = extract(answers, context);

    const isDismissed = (id) => m.dismissed[id] && now - m.dismissed[id] < DISMISS_DAYS * 864e5;
    const scored = GAMES.map((g) => Object.assign({ game: g, dismissed: Boolean(isDismissed(g.id)) }, score(g.id, features, m)));

    // Greedy pick: best fit first, with a small penalty for repeating the same training area.
    const picked = [];
    const pool = scored.filter((s) => !s.dismissed);
    const backup = scored.filter((s) => s.dismissed);
    while (picked.length < count && (pool.length || backup.length)) {
      const from = pool.length ? pool : backup;
      let best = 0, bestValue = -Infinity;
      from.forEach((s, i) => {
        const overlap = picked.reduce((n, p) => n + s.game.areas.filter((a) => p.game.areas.includes(a)).length, 0);
        const value = s.fit - DIVERSITY * overlap;
        if (value > bestValue) { bestValue = value; best = i; }
      });
      picked.push(from.splice(best, 1)[0]);
    }

    return {
      picks: picked.map((s, i) => ({
        rank: i + 1,
        game: s.game,
        fit: s.fit, // internal only: never show as a percentage or a chance of benefit
        reasons: reasonsFor(s, features),
        notes: notesFor(s.game.id, features, answers)
      })),
      heard: heard(answers),
      notes: globalNotes(answers, features)
    };
  }

  function reasonsFor(scored, features) {
    const out = [];
    for (const { f } of scored.parts) {
      const text = features.why[f];
      if (text && !out.includes(text)) out.push(text);
      if (out.length === 3) break;
    }
    if (!out.length) out.push("A gentle place to start for anyone");
    return out;
  }

  function notesFor(gameId, features, answers) {
    const x = features.x;
    const notes = [];
    if (gameId === "rhythm" && (x["phys:numb"] || x["phys:grip"] || x["dx:neuropathy"])) {
      notes.push("If your hands are painful, check with your care team before tapping games.");
    }
    if ((answers || {}).age === "u13") notes.push("Play with a grown-up nearby, and stop whenever you like.");
    return notes;
  }

  function globalNotes(answers, features) {
    const a = answers || {};
    const notes = [];
    if ((features.x.gentle || 0) >= 0.6) notes.push("Your energy may be low right now. Try one session at Level 1. Story Echo, Finger Rhythm and Signal Match start in Gentle mode, with no timer, and you can pause any game or stop at any time.");
    if ((a.rankPhys || []).slice(0, 2).includes("balance")) {
      notes.push("There isn't a balance activity in the library yet. Your care team or a physical therapist can suggest safe balance exercises.");
    }
    return notes;
  }

  // Plain-language summary of the answers that matter most, shown back to the person.
  function heard(answers) {
    const a = answers || {};
    const out = [];
    if (a.rankCog && a.rankCog[0]) out.push(label("rankCog", a.rankCog[0]));
    if (a.rankPhys && a.rankPhys[0]) out.push(label("rankPhys", a.rankPhys[0]));
    if (a.rankLife && a.rankLife[0]) out.push(label("rankLife", a.rankLife[0]) + " (most affected)");
    if (a.energy) out.push(`Energy ${a.energy} of 5`);
    return out;
  }

  return { GAMES, PRIOR, extract, newModel, score, learn, train, record, recommend };
})();
