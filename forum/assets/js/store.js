/*
 * The forum's data layer. Pages only talk to Forum.store, never to storage directly.
 *
 * These are the forum's rules. On the live site the server runs this file against the shared
 * forum in Postgres, as the signed-in person (server/forum.js), and pages reach it through
 * api-store.js. The tests run it directly against demo data in a pretend browser, which is
 * what the localStorage code below is for. No page code here.
 */
window.Forum = window.Forum || {};

Forum.store = (function () {
  const STORAGE_KEY = "chemoasis-forum-demo-v1";
  const AUTO_HIDE_REPORTS = 3;
  let memoryCopy = null;
  let persistent = true; // false when the browser blocks localStorage

  // ---------- storage ----------

  // Reads the saved copy every time, so two open tabs never overwrite each other's newer changes.
  function load() {
    if (persistent) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          memoryCopy = JSON.parse(saved);
          return memoryCopy;
        }
      } catch (error) {
        persistent = false; // Private mode or blocked storage: keep changes in memory for this page only.
      }
    }
    if (memoryCopy) return memoryCopy;
    memoryCopy = Forum.seed();
    save();
    return memoryCopy;
  }

  function save() {
    if (!persistent) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCopy));
    } catch (error) {
      persistent = false;
    }
  }

  const copy = (value) => JSON.parse(JSON.stringify(value));
  const done = (value) => Promise.resolve(value === undefined ? undefined : copy(value));
  const fail = (message) => Promise.reject(new Error(message));
  const newId = (prefix) => prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- people ----------

  function me(data) {
    return data.profiles.find((p) => p.id === data.currentUserId);
  }

  function isModerator(profile) {
    return Boolean(profile) && profile.type === "moderator";
  }

  function isVerifiedProfessional(profile) {
    return Boolean(profile) && profile.type === "professional" && Boolean(profile.professional && profile.professional.verified);
  }

  // What other people may see about a profile.
  function publicProfile(profile, viewer) {
    if (!profile) return null;
    const own = viewer && viewer.id === profile.id;
    const view = {
      id: profile.id,
      displayName: profile.displayName,
      type: profile.type,
      createdAt: profile.createdAt,
      isOwn: own
    };
    if (profile.showBio || own) view.bio = profile.bio;
    if (profile.type === "professional" && profile.professional) view.professional = profile.professional;
    if (own) view.showBio = profile.showBio;
    return view;
  }

  function authorView(data, authorId, anonymous) {
    const viewer = me(data);
    const profile = data.profiles.find((p) => p.id === authorId);
    if (anonymous && !(viewer && (viewer.id === authorId || isModerator(viewer)))) {
      return { id: null, displayName: "Anonymous member", type: "member", anonymous: true };
    }
    const view = publicProfile(profile, viewer);
    if (view && anonymous) view.anonymous = true;
    return view;
  }

  // ---------- visibility ----------

  function canSee(item, viewer) {
    if (item.status === "visible") return true;
    if (!viewer) return false;
    if (item.status === "removed-by-author") return false;
    // Authors still see their own held, hidden or removed posts, so they know what happened and can ask for another review.
    return isModerator(viewer) || item.authorId === viewer.id;
  }

  function mutedIds(data, viewer) {
    return viewer ? (data.settings[viewer.id] || {}).muted || [] : [];
  }

  // Anonymous posts are never hidden by muting: hiding one would reveal who wrote it.
  function isMuted(item, muted) {
    return !item.anonymous && muted.includes(item.authorId);
  }

  function decorate(data, item, kind) {
    const viewer = me(data);
    const helpfulBy = data.helpful[item.id] || [];
    const view = Object.assign({}, item, {
      kind,
      author: authorView(data, item.authorId, item.anonymous),
      helpfulCount: helpfulBy.length,
      markedHelpful: Boolean(viewer) && helpfulBy.includes(viewer.id),
      isOwn: Boolean(viewer) && viewer.id === item.authorId,
      openReports: data.reports.filter((r) => r.targetId === item.id && r.status === "open").length,
      appealed: data.reports.some((r) => r.targetId === item.id && r.reason === "appeal")
    });
    delete view.authorId;
    if (!isModerator(viewer) && !view.isOwn) {
      delete view.openReports;
      delete view.appealed;
    }
    return view;
  }

  function threadSummary(data, thread) {
    const viewer = me(data);
    const replies = data.replies.filter((r) => r.threadId === thread.id && canSee(r, viewer));
    const last = replies.reduce((latest, r) => (r.createdAt > latest ? r.createdAt : latest), thread.createdAt);
    return Object.assign(decorate(data, thread, "thread"), {
      replyCount: replies.length,
      lastActivityAt: last
    });
  }

  // ---------- drafts ----------

  function cleanDraft(data, draft, needsTitle) {
    const author = me(data);
    const title = (draft.title || "").trim();
    const body = (draft.body || "").trim();
    const sourceUrl = (draft.sourceUrl || "").trim();

    if (!author) return { error: "Please sign in to post." };
    if (needsTitle && title.length < 4) return { error: "Please add a title (at least 4 characters)." };
    if (needsTitle && title.length > 120) return { error: "Please keep the title under 120 characters." };
    if (body.length < 2) return { error: "Please write something before posting." };
    if (body.length > 5000) return { error: "Please keep posts under 5,000 characters." };
    if (!Forum.safety.isValidSourceUrl(sourceUrl)) return { error: "The source link needs to be a full web address starting with https:// or http://" };

    let label = Forum.catalog.label(draft.label) ? draft.label : "experience";
    if (label === "professional" && !isVerifiedProfessional(author)) label = "experience";

    const settings = data.settings[author.id] || {};
    let anonymous = draft.anonymous === undefined ? Boolean(settings.anonymousByDefault) : Boolean(draft.anonymous);
    // Professional guidance is only worth something when readers can see whose credentials stand behind it.
    if (label === "professional") anonymous = false;

    return {
      value: { title, body, sourceUrl: sourceUrl || undefined, label, anonymous },
      author,
      review: Forum.safety.review({ title, body, label, sourceUrl })
    };
  }

  function holdForReview(data, item, targetType) {
    item.status = "pending";
    data.reports.push({
      id: newId("rep"),
      targetType,
      targetId: item.id,
      reporterId: "system",
      reason: "unsafe-medical",
      note: "Held automatically: the safety check flagged a possible unsafe medical claim.",
      status: "open",
      createdAt: new Date().toISOString()
    });
  }

  // ---------- public API ----------

  return {
    AUTO_HIDE_REPORTS,

    // False when the browser won't let the demo save anything, so the page can warn people.
    isPersistent() {
      load();
      return persistent;
    },

    currentUser() {
      const data = load();
      const user = me(data);
      if (!user) return done(null);
      return done(Object.assign(publicProfile(user, user), {
        canModerate: isModerator(user),
        canPostProfessional: isVerifiedProfessional(user),
        settings: data.settings[user.id] || {}
      }));
    },

    // Demo only: lets testers switch between the made-up accounts.
    switchDemoUser(userId) {
      const data = load();
      if (!data.profiles.some((p) => p.id === userId)) return fail("Unknown demo account.");
      data.currentUserId = userId;
      save();
      return done(true);
    },

    listDemoUsers() {
      const data = load();
      return done(data.profiles.map((p) => ({ id: p.id, displayName: p.displayName, type: p.type })));
    },

    getProfile(userId) {
      const data = load();
      const viewer = me(data);
      const profile = data.profiles.find((p) => p.id === userId);
      if (!profile) return fail("This profile doesn't exist.");
      const threads = data.threads
        .filter((t) => t.authorId === userId && canSee(t, viewer) && (t.status !== "removed" || (viewer && viewer.id === userId)) && (!t.anonymous || (viewer && viewer.id === userId)))
        .map((t) => threadSummary(data, t))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return done({ profile: publicProfile(profile, viewer), threads, muted: mutedIds(data, viewer).includes(userId) });
    },

    updateMyProfile(patch) {
      const data = load();
      const user = me(data);
      if (!user) return fail("Please sign in first.");
      if (patch.displayName !== undefined) {
        const name = String(patch.displayName).trim();
        if (name.length < 2 || name.length > 40) return fail("Display names need 2 to 40 characters.");
        // Names that could pass for staff, a badge or an anonymous post would mislead readers.
        if ((user.type === "member" || user.type === "creator") && /\b(anonymous|moderator|mod|admin|chemoasis|reframe|verified|official|staff|nurse|doctor|dr)\b/i.test(name)) {
          return fail("Please pick a name that doesn't sound like a role, a badge or the app itself.");
        }
        user.displayName = name;
      }
      if (patch.bio !== undefined) user.bio = String(patch.bio).trim().slice(0, 300);
      if (patch.showBio !== undefined) user.showBio = Boolean(patch.showBio);
      save();
      return done(publicProfile(user, user));
    },

    updateMySettings(patch) {
      const data = load();
      const user = me(data);
      if (!user) return fail("Please sign in first.");
      const current = data.settings[user.id] || {};
      data.settings[user.id] = Object.assign(current, {
        anonymousByDefault: patch.anonymousByDefault !== undefined ? Boolean(patch.anonymousByDefault) : Boolean(current.anonymousByDefault),
        largeText: patch.largeText !== undefined ? Boolean(patch.largeText) : Boolean(current.largeText)
      });
      save();
      return done(data.settings[user.id]);
    },

    listThreads(options) {
      const opts = options || {};
      const data = load();
      const viewer = me(data);
      const query = (opts.query || "").trim().toLowerCase();

      const muted = mutedIds(data, viewer);
      let threads = data.threads.filter((t) => canSee(t, viewer) && t.status !== "removed" && !isMuted(t, muted));
      if (opts.categoryId) threads = threads.filter((t) => t.categoryId === opts.categoryId);
      if (opts.gameId) threads = threads.filter((t) => (t.gameIds || []).includes(opts.gameId));
      if (opts.area) {
        threads = threads.filter((t) =>
          (t.gameIds || []).some((id) => {
            const game = Forum.catalog.game(id);
            return game && game.areas.includes(opts.area);
          })
        );
      }
      if (query) {
        threads = threads.filter((t) => {
          const replyText = data.replies
            .filter((r) => r.threadId === t.id && canSee(r, viewer) && !isMuted(r, muted))
            .map((r) => r.body)
            .join(" ");
          return (t.title + " " + t.body + " " + replyText).toLowerCase().includes(query);
        });
      }

      const summaries = threads.map((t) => threadSummary(data, t));
      if (opts.sort === "replies") summaries.sort((a, b) => b.replyCount - a.replyCount || b.lastActivityAt.localeCompare(a.lastActivityAt));
      else summaries.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      return done(summaries);
    },

    categoryCounts() {
      const data = load();
      const viewer = me(data);
      const counts = {};
      data.threads.filter((t) => canSee(t, viewer) && t.status !== "removed").forEach((t) => {
        counts[t.categoryId] = (counts[t.categoryId] || 0) + 1;
      });
      return done(counts);
    },

    getThread(threadId) {
      const data = load();
      const viewer = me(data);
      const thread = data.threads.find((t) => t.id === threadId);
      if (!thread || !canSee(thread, viewer)) return fail("This conversation isn't available. It may have been removed.");
      const muted = mutedIds(data, viewer);
      const visibleReplies = data.replies.filter((r) => r.threadId === threadId && canSee(r, viewer));
      const mutedCount = visibleReplies.filter((r) => isMuted(r, muted)).length;
      const replies = visibleReplies
        .filter((r) => !isMuted(r, muted))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => decorate(data, r, "reply"));
      return done({ thread: threadSummary(data, thread), replies, mutedCount });
    },

    // Checks a draft without saving it, so the page can show safety notes first.
    previewDraft(draft) {
      return done(Forum.safety.review(draft));
    },

    createThread(draft) {
      const data = load();
      if (!Forum.catalog.category(draft.categoryId)) return fail("Please choose a category.");
      const cleaned = cleanDraft(data, draft, true);
      if (cleaned.error) return fail(cleaned.error);

      const gameIds = (draft.gameIds || []).filter((id) => Forum.catalog.game(id)).slice(0, 3);
      const thread = Object.assign(
        { id: newId("t"), categoryId: draft.categoryId, authorId: cleaned.author.id, gameIds, status: "visible", createdAt: new Date().toISOString() },
        cleaned.value
      );
      if (cleaned.review.hold) holdForReview(data, thread, "thread");
      data.threads.push(thread);
      save();
      return done({ id: thread.id, status: thread.status });
    },

    createReply(threadId, draft) {
      const data = load();
      const thread = data.threads.find((t) => t.id === threadId);
      if (!thread || thread.status !== "visible") return fail("You can't reply to this conversation right now.");
      const cleaned = cleanDraft(data, draft, false);
      if (cleaned.error) return fail(cleaned.error);

      const reply = Object.assign(
        { id: newId("r"), threadId, authorId: cleaned.author.id, status: "visible", createdAt: new Date().toISOString() },
        cleaned.value
      );
      delete reply.title;
      if (cleaned.review.hold) holdForReview(data, reply, "reply");
      data.replies.push(reply);
      save();
      return done({ id: reply.id, status: reply.status });
    },

    // Authors can fix a visible or held post. Edits go through the same safety check as new posts.
    editMyPost(kind, id, draft) {
      const data = load();
      const user = me(data);
      const list = kind === "thread" ? data.threads : data.replies;
      const item = list.find((x) => x.id === id);
      if (!item || !user || item.authorId !== user.id) return fail("You can only edit your own posts.");
      if (item.status !== "visible" && item.status !== "pending") return fail("This post can't be edited while a moderator has it hidden or removed.");
      // Keeps the text people reported in place until a moderator has seen it.
      if (data.reports.some((r) => r.targetId === id && r.status === "open" && r.reporterId !== "system" && r.reason !== "appeal")) {
        return fail("This post can't be edited while a moderator reviews a report about it.");
      }

      const merged = Object.assign({ title: item.title, body: item.body, label: item.label, sourceUrl: item.sourceUrl, anonymous: item.anonymous }, draft);
      const cleaned = cleanDraft(data, merged, kind === "thread");
      if (cleaned.error) return fail(cleaned.error);
      // Professional guidance always shows who wrote it, so switching an anonymous post to it would reveal the author.
      if (item.anonymous && cleaned.value.label === "professional") {
        return fail("An anonymous post can't become professional guidance. Please write a new post for that.");
      }

      item.body = cleaned.value.body;
      item.label = cleaned.value.label;
      item.sourceUrl = cleaned.value.sourceUrl;
      if (kind === "thread") {
        item.title = cleaned.value.title;
        if (Array.isArray(draft.gameIds)) item.gameIds = draft.gameIds.filter((g) => Forum.catalog.game(g)).slice(0, 3);
      }
      item.editedAt = new Date().toISOString();
      const alreadyHeld = data.reports.some((r) => r.targetId === id && r.status === "open" && r.reporterId === "system");
      if (cleaned.review.hold && !alreadyHeld) holdForReview(data, item, kind);
      save();
      return done({ id: item.id, status: item.status });
    },

    // One appeal per post, for posts a moderator hid or removed.
    requestAnotherReview(kind, id, note) {
      const data = load();
      const user = me(data);
      const list = kind === "thread" ? data.threads : data.replies;
      const item = list.find((x) => x.id === id);
      if (!item || !user || item.authorId !== user.id) return fail("You can only ask about your own posts.");
      if (item.status !== "hidden" && item.status !== "removed") return fail("Only hidden or removed posts can be sent for another review.");
      if (data.reports.some((r) => r.targetId === id && r.reason === "appeal")) return fail("You've already asked for another review of this post.");
      data.reports.push({
        id: newId("rep"),
        targetType: kind,
        targetId: id,
        reporterId: user.id,
        reason: "appeal",
        note: String(note || "").trim().slice(0, 500),
        status: "open",
        createdAt: new Date().toISOString()
      });
      save();
      return done(true);
    },

    // Muting hides someone's named posts from you only. They aren't told.
    setMuted(userId, muted) {
      const data = load();
      const user = me(data);
      if (!user) return fail("Please sign in first.");
      const target = data.profiles.find((p) => p.id === userId);
      if (!target || target.id === user.id) return fail("You can't mute that account.");
      if (target.type === "moderator") return fail("Moderators can't be muted, so safety notices always reach you.");
      const settings = data.settings[user.id] || (data.settings[user.id] = {});
      const list = settings.muted || (settings.muted = []);
      const at = list.indexOf(userId);
      if (muted && at < 0) list.push(userId);
      if (!muted && at >= 0) list.splice(at, 1);
      save();
      return done(list.slice());
    },

    listMuted() {
      const data = load();
      const viewer = me(data);
      return done(
        mutedIds(data, viewer)
          .map((id) => data.profiles.find((p) => p.id === id))
          .filter(Boolean)
          .map((p) => ({ id: p.id, displayName: p.displayName }))
      );
    },

    deleteMyPost(kind, id) {
      const data = load();
      const user = me(data);
      const list = kind === "thread" ? data.threads : data.replies;
      const item = list.find((x) => x.id === id);
      if (!item || !user || item.authorId !== user.id) return fail("You can only delete your own posts.");
      // A moderator's decision stands: deleting would quietly close the reports on a hidden post.
      if (item.status !== "visible" && item.status !== "pending") return fail("This post can't be deleted while a moderator has it hidden or removed.");
      item.status = "removed-by-author";
      // Nobody can see the post any more, so its open reports are closed rather than left for a moderator to undo.
      const closedAt = new Date().toISOString();
      data.reports.forEach((r) => {
        if (r.targetId === id && r.status === "open") {
          r.status = "dismissed";
          r.resolution = "author-deleted";
          r.resolvedAt = closedAt;
        }
      });
      save();
      return done(true);
    },

    toggleHelpful(id) {
      const data = load();
      const user = me(data);
      if (!user) return fail("Please sign in first.");
      const post = data.threads.find((t) => t.id === id) || data.replies.find((r) => r.id === id);
      if (!post || post.status !== "visible") return fail("You can only mark visible posts as helpful.");
      const list = data.helpful[id] || (data.helpful[id] = []);
      const at = list.indexOf(user.id);
      if (at >= 0) list.splice(at, 1);
      else list.push(user.id);
      save();
      return done({ count: list.length, marked: at < 0 });
    },

    report(kind, id, reason, note) {
      const data = load();
      const user = me(data);
      if (!user) return fail("Please sign in first.");
      if (!Forum.catalog.reportReason(reason)) return fail("Please choose a reason.");
      const list = kind === "thread" ? data.threads : data.replies;
      const item = list.find((x) => x.id === id);
      if (!item || item.status !== "visible") return fail("That post no longer exists.");
      if (item.authorId === user.id) return fail("You can't report your own post. You can edit or delete it instead.");
      if (data.reports.some((r) => r.targetId === id && r.reporterId === user.id && r.status === "open")) {
        return fail("You've already reported this. A moderator will look at it.");
      }
      data.reports.push({
        id: newId("rep"),
        targetType: kind,
        targetId: id,
        reporterId: user.id,
        reason,
        note: String(note || "").trim().slice(0, 500),
        status: "open",
        createdAt: new Date().toISOString()
      });

      // Several different people reporting the same post hides it until a moderator decides.
      const reporters = new Set(data.reports.filter((r) => r.targetId === id && r.status === "open").map((r) => r.reporterId));
      if (reporters.size >= AUTO_HIDE_REPORTS && item.status === "visible") item.status = "hidden";
      save();
      return done(true);
    },

    moderationQueue() {
      const data = load();
      const viewer = me(data);
      if (!isModerator(viewer)) return fail("Only moderators can see the review queue.");
      const open = data.reports.filter((r) => r.status === "open");
      const byTarget = {};
      open.forEach((r) => {
        (byTarget[r.targetId] = byTarget[r.targetId] || []).push(r);
      });
      const items = Object.keys(byTarget).map((targetId) => {
        const reports = byTarget[targetId];
        const kind = reports[0].targetType;
        const source = (kind === "thread" ? data.threads : data.replies).find((x) => x.id === targetId);
        if (!source || source.status === "removed-by-author") return null;
        const parent = kind === "reply" ? data.threads.find((t) => t.id === source.threadId) : source;
        return {
          targetId,
          kind,
          post: decorate(data, source, kind),
          threadId: parent ? parent.id : null,
          threadTitle: parent ? parent.title : "",
          reports: reports.map((r) => ({
            id: r.id,
            reason: r.reason,
            note: r.note,
            createdAt: r.createdAt,
            automatic: r.reporterId === "system"
          }))
        };
      }).filter(Boolean);
      items.sort((a, b) => b.reports.length - a.reports.length);
      return done(items);
    },

    // Posts a moderator hid with no open reports left, so they can come back to them later.
    hiddenPosts() {
      const data = load();
      if (!isModerator(me(data))) return fail("Only moderators can see hidden posts.");
      const open = new Set(data.reports.filter((r) => r.status === "open").map((r) => r.targetId));
      const items = [];
      [["thread", data.threads], ["reply", data.replies]].forEach(([kind, list]) => {
        list.filter((x) => x.status === "hidden" && !open.has(x.id)).forEach((x) => {
          const parent = kind === "reply" ? data.threads.find((t) => t.id === x.threadId) : x;
          items.push({ targetId: x.id, kind, post: decorate(data, x, kind), threadId: parent ? parent.id : null, threadTitle: parent ? parent.title : "" });
        });
      });
      return done(items);
    },

    moderationHistory() {
      const data = load();
      if (!isModerator(me(data))) return fail("Only moderators can see the review history.");
      return done(
        data.reports
          .filter((r) => r.status !== "open")
          .sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || ""))
          .slice(0, 20)
      );
    },

    // action: "keep" (post stays up), "hide" (hidden, author still sees it) or "remove".
    resolve(targetId, action, note) {
      const data = load();
      const moderator = me(data);
      if (!isModerator(moderator)) return fail("Only moderators can do that.");
      const item = data.threads.find((t) => t.id === targetId) || data.replies.find((r) => r.id === targetId);
      if (!item || item.status === "removed-by-author") return fail("That post no longer exists.");
      const statuses = { keep: "visible", hide: "hidden", remove: "removed" };
      if (!statuses[action]) return fail("Unknown action.");
      item.status = statuses[action];
      const resolvedAt = new Date().toISOString();
      data.reports.forEach((r) => {
        if (r.targetId === targetId && r.status === "open") {
          r.status = action === "keep" ? "dismissed" : "actioned";
          r.resolution = action;
          r.resolvedBy = moderator.id;
          r.resolvedAt = resolvedAt;
          r.moderatorNote = String(note || "").trim().slice(0, 500);
        }
      });
      save();
      return done(true);
    },

    /*
     * Topic signals for Sahas's recommendations: how often each training area and game
     * comes up in public, visible threads. Counts only, no user IDs and no post text,
     * which matches the brief's rule against unrestricted use of people's posts.
     */
    topicSignals(days) {
      const data = load();
      const since = new Date(Date.now() - (days || 30) * 24 * 60 * 60 * 1000).toISOString();
      const areas = {};
      const games = {};
      data.threads
        .filter((t) => t.status === "visible" && t.createdAt >= since)
        .forEach((t) => {
          (t.gameIds || []).forEach((gameId) => {
            games[gameId] = (games[gameId] || 0) + 1;
            const game = Forum.catalog.game(gameId);
            (game ? game.areas : []).forEach((area) => {
              areas[area] = (areas[area] || 0) + 1;
            });
          });
        });
      return done({ since, areas, games });
    },

    resetDemo() {
      memoryCopy = Forum.seed();
      save();
      return done(true);
    }
  };
})();
