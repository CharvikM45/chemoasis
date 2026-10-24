/*
 * Forum.store for the live site: the same functions as store.js, but each one asks the server
 * (/api/forum), which runs store.js against the shared forum as the signed-in person.
 * Pages don't change: every function already returned a Promise.
 */
window.Forum = window.Forum || {};

Forum.store = (function () {
  async function call(method, ...args) {
    let res;
    try {
      res = await fetch("/api/forum/" + method, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args })
      });
    } catch (_) {
      throw new Error("We can't reach the community right now. Check your connection and try again.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || "Something went wrong. Please try again.");
    return data.result;
  }

  const methods = [
    "currentUser", "getProfile", "updateMyProfile", "updateMySettings", "listThreads", "categoryCounts", "getThread",
    "previewDraft", "createThread", "createReply", "editMyPost", "requestAnotherReview", "setMuted", "listMuted",
    "deleteMyPost", "toggleHelpful", "report", "moderationQueue", "hiddenPosts", "moderationHistory", "resolve", "topicSignals"
  ];
  const store = { AUTO_HIDE_REPORTS: 3, isPersistent: () => true };
  for (const m of methods) store[m] = (...args) => call(m, ...args);
  return store;
})();
