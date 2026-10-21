/*
 * Demo sign-in. Accounts, answers and the personal model live only in this browser
 * (localStorage). Every function returns a Promise, like Forum.store, so the bodies can
 * be swapped for Supabase Auth + tables later without changing the pages.
 *
 * This is NOT real security: anyone with access to this browser can read the data.
 */
window.Account = window.Account || {};

Account.auth = (function () {
  const USERS = "chemoasis.account.users";
  const SESSION = "chemoasis.account.session";
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
  const fail = (message) => Promise.reject(new Error(message));

  const normalEmail = (email) => String(email || "").trim().toLowerCase();
  const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

  async function hash(password, salt) {
    const subtle = window.crypto && window.crypto.subtle;
    if (subtle) {
      const key = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
      return "pbkdf2:" + toHex(bits);
    }
    // Fallback for browsers without Web Crypto. Demo only.
    let h = 5381;
    for (const ch of salt + password) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
    return "djb2:" + h.toString(16);
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(8);
    (window.crypto || { getRandomValues: (b) => b.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
    return prefix + toHex(bytes);
  }

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });

  return {
    async createAccount({ email, name, password }) {
      const e = normalEmail(email);
      const n = String(name || "").trim();
      if (!/^\S+@\S+\.\S+$/.test(e)) return fail("Please enter an email address like name@example.com.");
      if (!n) return fail("Please enter a first name or nickname.");
      if (String(password || "").length < 8) return fail("Please use a password with at least 8 characters.");
      const users = read(USERS, []);
      if (users.some((u) => u.email === e)) return fail("There's already an account with that email in this browser. Try signing in.");
      const salt = randomId("s-");
      const user = { id: randomId("u-"), email: e, name: n.slice(0, 40), salt, hash: await hash(password, salt), createdAt: new Date().toISOString() };
      users.push(user);
      write(USERS, users);
      write(SESSION, { userId: user.id, at: Date.now() });
      return publicUser(user);
    },

    async signIn({ email, password }) {
      const user = read(USERS, []).find((u) => u.email === normalEmail(email));
      if (!user || (await hash(String(password || ""), user.salt)) !== user.hash) {
        return fail("That email and password don't match an account in this browser.");
      }
      write(SESSION, { userId: user.id, at: Date.now() });
      return publicUser(user);
    },

    signOut() {
      storage.remove(SESSION);
      return Promise.resolve(true);
    },

    currentUser() {
      const session = read(SESSION, null);
      const user = session && read(USERS, []).find((u) => u.id === session.userId);
      return Promise.resolve(user ? publicUser(user) : null);
    },

    // Answers, the personal model and preferences for the signed-in person.
    async getData() {
      const user = await this.currentUser();
      if (!user) return fail("Please sign in first.");
      return read(userKey(user.id), { answers: {}, completedAt: null, useOwnPosts: false, model: null });
    },

    async saveData(patch) {
      const user = await this.currentUser();
      if (!user) return fail("Please sign in first.");
      const next = Object.assign(read(userKey(user.id), {}), patch);
      write(userKey(user.id), next);
      return next;
    },

    // Removes the account and everything saved for it from this browser.
    async deleteAccount() {
      const user = await this.currentUser();
      if (!user) return true;
      write(USERS, read(USERS, []).filter((u) => u.id !== user.id));
      storage.remove(userKey(user.id));
      storage.remove(SESSION);
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
