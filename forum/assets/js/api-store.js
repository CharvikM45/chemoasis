/*
 * Forum.store for the pages. It picks one of three modes once per page load:
 *   - "live": on the Chemoasis server, each function asks /api/forum, which runs store.js
 *     against the shared forum as the signed-in person (server/forum.js).
 *   - "demo": opened as plain files, or on a host without the server. It uses store.js right
 *     here with made-up example posts saved only in this browser, and a demo account switcher.
 *   - "offline": the server is there but not answering. Calls fail with a friendly message
 *     instead of quietly showing demo posts on the real site.
 * Load after catalog.js, seed.js, safety.js and store.js. Pages don't change between modes:
 * every function returns a Promise either way.
 */
window.Forum = window.Forum || {};

Forum.store = (function (local) {
  const methods = [
    "currentUser", "getProfile", "updateMyProfile", "updateMySettings", "listThreads", "categoryCounts", "getThread",
    "previewDraft", "createThread", "createReply", "editMyPost", "requestAnotherReview", "setMuted", "listMuted",
    "deleteMyPost", "toggleHelpful", "report", "moderationQueue", "hiddenPosts", "moderationHistory", "resolve", "topicSignals"
  ];
  const demoOnly = ["switchDemoUser", "listDemoUsers", "resetDemo"];

  async function send(method, args) {
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
    if (!res.ok) {
      const error = new Error((data && data.error) || "Something went wrong. Please try again.");
      error.status = res.status;
      throw error;
    }
    return data.result;
  }

  // Asking who is signed in also tells us whether the forum API is there at all.
  let modeCheck = null;
  let currentMode = null;
  let firstUser; // the answer to that first question, so the header doesn't ask twice
  function mode() {
    if (!modeCheck) {
      const onServer = typeof location !== "undefined" && /^https?:$/.test(location.protocol);
      modeCheck = (onServer
        ? send("currentUser", []).then(
            (user) => {
              firstUser = user;
              return "live";
            },
            (error) => (error.status === 404 || error.status === 405 ? "demo" : "offline")
          )
        : Promise.resolve("demo")
      ).then((value) => (currentMode = value));
    }
    return modeCheck;
  }

  const offline = () => Promise.reject(new Error("We can't reach the community right now. Please try again in a few minutes."));

  const store = {
    AUTO_HIDE_REPORTS: local.AUTO_HIDE_REPORTS,
    mode,
    // False only in a demo whose browser blocks site storage, so the page can warn people.
    isPersistent: () => (currentMode === "demo" ? local.isPersistent() : true)
  };
  for (const m of methods) {
    store[m] = (...args) =>
      mode().then((which) => {
        if (which === "demo") return local[m](...args);
        if (which === "offline") return offline();
        if (m === "currentUser" && firstUser !== undefined) {
          const user = firstUser;
          firstUser = undefined;
          return user;
        }
        return send(m, args);
      });
  }
  for (const m of demoOnly) {
    store[m] = (...args) =>
      mode().then((which) => (which === "demo" ? local[m](...args) : m === "listDemoUsers" ? [] : Promise.reject(new Error("Demo accounts are switched off on the live forum."))));
  }
  return store;
})(Forum.store);
