/*
 * Accounts. Sign-up, sign-in and sessions go to the account server (/api/auth, see server/).
 * The session lives in an HttpOnly cookie that page scripts can't read.
 *
 * Questionnaire answers and the personal recommender model are still saved only in this
 * browser (localStorage), under the account's id. Moving them to the server is a separate
 * decision, because they include health information.
 */
window.Account = window.Account || {};

Account.auth = (function () {
  const SESSION = "chemoasis.account.session"; // remembers who's signed in, for the home page's play logging
  const userKey = (id) => "chemoasis.account.user." + id;

  const memory = {};
  const storage = {
    get(key) {
      try { const v = localStorage.getItem(key); return v === null ? memory[key] || null : v; } catch (_) { return memory[key] || null; }
    },
    set(key, value) {
      memory[key] = value;
      try { localStorage.setItem(key, value); } catch (_) { /* private mode: memory only */ }
    },
    remove(key) {
      delete memory[key];
      try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
    }
  };
  const read = (key, fallback) => { try { return JSON.parse(storage.get(key)) || fallback; } catch (_) { return fallback; } };
  const write = (key, value) => storage.set(key, JSON.stringify(value));

  async function api(path, options) {
    const opts = options || {};
    let res;
    try {
      res = await fetch("/api/auth" + path, {
        method: opts.method || "GET",
        credentials: "same-origin",
        headers: opts.body ? { "Content-Type": "application/json" } : {},
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (_) {
      throw new Error("We can't reach the account server right now. Check your connection and try again.");
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error((data && data.error) || "Something went wrong. Please try again.");
      error.status = res.status;
      throw error;
    }
    return data;
  }

  let cached; // undefined = not asked yet, null = signed out
  function remember(user) {
    cached = user;
    if (user) write(SESSION, { userId: user.id, at: Date.now() });
    else storage.remove(SESSION);
    return user;
  }

  return {
    async createAccount({ email, name, password }) {
      const { user } = await api("/signup", { method: "POST", body: { email, name, password } });
      return remember(user);
    },

    async signIn({ email, password }) {
      const { user } = await api("/login", { method: "POST", body: { email, password } });
      return remember(user);
    },

    async signOut() {
      try { await api("/logout", { method: "POST" }); } catch (_) { /* still sign out on this device */ }
      remember(null);
      return true;
    },

    async currentUser() {
      if (cached !== undefined) return cached;
      try {
        const { user } = await api("/me");
        return remember(user);
      } catch (error) {
        if (error.status === 401) return remember(null);
        throw error;
      }
    },

    // Answers, the personal model and preferences for the signed-in person (this browser only).
    async getData() {
      const user = await this.currentUser();
      if (!user) throw new Error("Please sign in first.");
      return read(userKey(user.id), { answers: {}, completedAt: null, useOwnPosts: false, model: null });
    },

    async saveData(patch) {
      const user = await this.currentUser();
      if (!user) throw new Error("Please sign in first.");
      const next = Object.assign(read(userKey(user.id), {}), patch);
      write(userKey(user.id), next);
      return next;
    },

    // Deletes the account on the server and everything saved for it in this browser.
    async deleteAccount() {
      const user = await this.currentUser();
      if (!user) return true;
      await api("/me", { method: "DELETE" });
      storage.remove(userKey(user.id));
      remember(null);
      return true;
    },

    // Used by the home page to log plays without loading the whole account app.
    recordPlay(gameId) {
      const session = read(SESSION, null);
      if (!session) return false;
      const data = read(userKey(session.userId), null);
      if (!data) return false;
      data.model = data.model || { version: 1, delta: {}, events: [], dismissed: {} };
      data.model.events.push({ game: gameId, kind: "play", at: Date.now(), applied: false });
      if (data.model.dismissed) delete data.model.dismissed[gameId];
      if (data.model.events.length > 300) data.model.events.splice(0, data.model.events.length - 300);
      write(userKey(session.userId), data);
      return true;
    }
  };
})();
