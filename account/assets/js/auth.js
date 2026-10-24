/*
 * Accounts. Sign-up, sign-in and sessions go to the account server (/api/auth, see server/).
 * The session lives in an HttpOnly cookie that page scripts can't read.
 *
 * Questionnaire answers, the personal recommender model and level progress are saved on the
 * account (/api/profile). Anything an older version saved in this browser is uploaded the first
 * time that person signs in here, then removed from the browser.
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

  async function request(url, options) {
    const opts = options || {};
    let res;
    try {
      res = await fetch(url, {
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
  const api = (path, options) => request("/api/auth" + path, options);
  const profileApi = (path, options) => request("/api/profile" + path, options);
  const EMPTY = () => ({ answers: {}, completedAt: null, useOwnPosts: false, model: null, levels: {} });

  // Fire-and-forget updates from the home page; they never block a game from opening.
  function notify(path, body) {
    if (!read(SESSION, null)) return false;
    fetch("/api/profile" + path, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    return true;
  }

  let cached; // undefined = not asked yet, null = signed out
  let profile = null; // last profile loaded or saved, so a save needs one request, not two
  function remember(user) {
    cached = user;
    if (user) write(SESSION, { userId: user.id, at: Date.now() });
    else storage.remove(SESSION);
    profile = null;
    return user;
  }

  return {
    async createAccount({ email, name, password, consent }) {
      const { user } = await api("/signup", { method: "POST", body: { email, name, password, consent } });
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

    // Answers, the personal model, preferences and level progress for the signed-in person.
    async getData() {
      const user = await this.currentUser();
      if (!user) throw new Error("Please sign in first.");
      let remote = (await profileApi("")).profile;
      const local = read(userKey(user.id), null);
      if (!remote && local) remote = (await profileApi("", { method: "PUT", body: { profile: local } })).profile;
      if (local) storage.remove(userKey(user.id));
      return (profile = Object.assign(EMPTY(), remote || {}));
    },

    async saveData(patch) {
      const next = Object.assign({}, profile || (await this.getData()), patch);
      const saved = await profileApi("", { method: "PUT", body: { profile: next } });
      return (profile = Object.assign(EMPTY(), saved.profile));
    },

    // Finished levels saved on the account, or null when signed out.
    async levels() {
      if (!read(SESSION, null)) return null;
      try { const { profile } = await profileApi(""); return (profile && profile.levels) || {}; }
      catch (error) { if (error.status === 401) storage.remove(SESSION); return null; } // signed out elsewhere: stop asking
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

    // Used by the home page to log plays and finished levels without loading the whole account app.
    recordPlay(gameId) { return notify("/play", { game: gameId }); },
    recordLevel(gameId, level) { return notify("/level", { game: gameId, level }); },
    recordResult(gameId, level, score) { return notify("/result", { game: gameId, level, score }); }
  };
})();
