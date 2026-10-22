/*
 * Gathers context about the signed-in person from the rest of the app for the recommender:
 *   - community: how often each training area comes up in public forum conversations
 *     (Forum.store.topicSignals: counts only, no user IDs or post text)
 *   - own posts: only if the person turns it on, their own forum posts are scanned for
 *     topics like "word-finding" or "numb fingers". Nothing leaves the browser.
 *   - plays: how many times they've opened each game.
 */
window.Account = window.Account || {};

Account.context = (function () {
  // Regex fragments matched at the start of a word ("numb" matches "numbness", but "hand" won't match "handle").
  const TOPICS = {
    memory: ["forget", "forgot", "remember", "memory", "misplac"],
    words: ["words?\\b", "names?\\b", "tip of my tongue", "find the right"],
    focus: ["focus", "concentrat", "distract", "attention"],
    speed: ["slow", "fog", "processing", "reaction"],
    planning: ["plan(s|ning)?\\b", "lose track", "lost track", "organi[sz]", "halfway", "multitask"],
    hand: ["hands?\\b", "finger", "numb", "tingl", "grip", "buttons?\\b", "typing"],
    balance: ["balance", "dizzy", "unsteady", "falling", "fell\\b"],
    movement: ["walk", "coordination", "stiff"]
  };

  // Topic strengths (0..1) from text and from the games tagged on posts.
  function topicsFromPosts(posts) {
    const counts = {};
    for (const post of posts) {
      const text = ((post.title || "") + " " + (post.body || "")).toLowerCase();
      for (const [area, words] of Object.entries(TOPICS)) {
        if (words.some((w) => new RegExp("\\b" + w).test(text))) counts[area] = (counts[area] || 0) + 1;
      }
      for (const gameId of post.gameIds || []) {
        const game = window.Forum && Forum.catalog && Forum.catalog.game(gameId);
        for (const area of (game && game.areas) || []) counts[area] = (counts[area] || 0) + 1;
      }
    }
    const max = Math.max(0, ...Object.values(counts));
    const out = {};
    for (const [area, n] of Object.entries(counts)) out[area] = max ? n / max : 0;
    return out;
  }

  function playsFrom(model) {
    const plays = {};
    for (const e of (model && model.events) || []) if (e.kind === "play") plays[e.game] = (plays[e.game] || 0) + 1;
    return plays;
  }

  async function gather(data) {
    const ctx = { communityAreas: {}, ownAreas: {}, ownPostCount: 0, forumName: null, plays: playsFrom(data.model), forumAvailable: false };
    const store = window.Forum && Forum.store;
    if (!store) return ctx;
    ctx.forumAvailable = true;
    try {
      const signals = await store.topicSignals(30);
      ctx.communityAreas = signals.areas || {};
    } catch (_) { /* forum unavailable: carry on without it */ }

    if (data.useOwnPosts) {
      try {
        const me = await store.currentUser();
        if (me) {
          const profile = await store.getProfile(me.id);
          ctx.forumName = me.displayName;
          ctx.ownPostCount = profile.threads.length;
          ctx.ownAreas = topicsFromPosts(profile.threads);
        }
      } catch (_) { /* ignore */ }
    }
    return ctx;
  }

  return { gather, topicsFromPosts, playsFrom };
})();
