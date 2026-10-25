/*
 * Shared page helpers: the header, badges, dates, notices and the report dialog.
 * Everything a person typed goes through esc() before it reaches the page.
 */
window.Forum = window.Forum || {};

Forum.ui = (function () {
  const BADGES = {
    professional: { text: "Verified professional", className: "f-badge--pro" },
    creator: { text: "Activity creator", className: "f-badge--creator" },
    moderator: { text: "Moderator", className: "f-badge--mod" }
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Keeps line breaks people typed, without allowing any HTML.
  function paragraphs(text) {
    return String(text || "")
      .split(/\n{2,}/)
      .map((part) => "<p>" + esc(part).replace(/\n/g, "<br>") + "</p>")
      .join("");
  }

  function timeAgo(iso) {
    const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    const steps = [
      [60, "second"],
      [60, "minute"],
      [24, "hour"],
      [7, "day"],
      [4.35, "week"],
      [12, "month"],
      [Infinity, "year"]
    ];
    let value = seconds;
    for (const [size, unit] of steps) {
      if (value < size) {
        const n = Math.floor(value);
        return n <= 0 || (unit === "second" && n < 45) ? "just now" : n + " " + unit + (n === 1 ? "" : "s") + " ago";
      }
      value /= size;
    }
    return "";
  }

  function fullDate(iso) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function param(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function badge(author) {
    if (!author || author.anonymous && !author.id) return "";
    const info = BADGES[author.type];
    if (!info) return "";
    if (author.type === "professional" && !(author.professional && author.professional.verified)) return "";
    return '<span class="f-badge ' + info.className + '">' + esc(info.text) + "</span>";
  }

  function authorLink(author) {
    if (!author || !author.id) return '<span class="f-author">' + esc(author ? author.displayName : "Unknown") + "</span>";
    const anon = author.anonymous ? ' <span class="f-muted">(posted anonymously)</span>' : "";
    return '<a class="f-author" href="profile.html?id=' + encodeURIComponent(author.id) + '">' + esc(author.displayName) + "</a>" + anon;
  }

  function labelPill(labelId) {
    const label = Forum.catalog.label(labelId);
    if (!label) return "";
    return '<span class="f-label f-label--' + esc(label.id) + '" title="' + esc(label.hint) + '">' + esc(label.name) + "</span>";
  }

  function gameChips(gameIds) {
    return (gameIds || [])
      .map((id) => Forum.catalog.game(id))
      .filter(Boolean)
      .map((game) => '<a class="f-chip" href="index.html?game=' + encodeURIComponent(game.id) + '">' + esc(game.name) + "</a>")
      .join("");
  }

  function statusNote(item, withActions) {
    const appeal =
      withActions && item.isOwn && !item.appealed && (item.status === "hidden" || item.status === "removed")
        ? ' <button type="button" class="f-link-button" data-action="appeal" data-kind="' + item.kind + '" data-id="' + esc(item.id) + '">Ask for another review</button>'
        : "";
    const appealed = item.isOwn && item.appealed && (item.status === "hidden" || item.status === "removed") ? " You asked for another review." : "";
    if (item.status === "pending") return '<p class="f-status f-status--pending">Waiting for a moderator to review. Only you and moderators can see this.</p>';
    if (item.status === "hidden" && item.openReports) return '<p class="f-status f-status--hidden">Hidden while a moderator reviews it. Only you and moderators can see this.' + appealed + appeal + "</p>";
    if (item.status === "hidden") return '<p class="f-status f-status--hidden">Hidden by a moderator. Only you and moderators can see this.' + appealed + appeal + "</p>";
    if (item.status === "removed") return '<p class="f-status f-status--hidden">Removed by a moderator. Only you and moderators can see this.' + appealed + appeal + "</p>";
    return "";
  }

  function threadCard(thread) {
    const category = Forum.catalog.category(thread.categoryId);
    return (
      '<li class="f-card">' +
      '<div class="f-card__meta">' +
      (category ? '<a class="f-eyebrow" href="index.html?category=' + encodeURIComponent(category.id) + '">' + esc(category.name) + "</a>" : "") +
      labelPill(thread.label) +
      "</div>" +
      '<h3 class="f-card__title"><a href="thread.html?id=' + encodeURIComponent(thread.id) + '">' + esc(thread.title) + "</a></h3>" +
      statusNote(thread) +
      '<p class="f-card__excerpt">' + esc(thread.body.length > 180 ? thread.body.slice(0, 177) + "..." : thread.body) + "</p>" +
      (thread.gameIds && thread.gameIds.length ? '<div class="f-chips">' + gameChips(thread.gameIds) + "</div>" : "") +
      '<p class="f-card__footer">' +
      authorLink(thread.author) + " " + badge(thread.author) +
      ' <span class="f-dot" aria-hidden="true">·</span> <time datetime="' + esc(thread.lastActivityAt) + '" title="' + esc(fullDate(thread.lastActivityAt)) + '">active ' + timeAgo(thread.lastActivityAt) + "</time>" +
      ' <span class="f-dot" aria-hidden="true">·</span> ' + thread.replyCount + (thread.replyCount === 1 ? " reply" : " replies") +
      (thread.helpfulCount ? ' <span class="f-dot" aria-hidden="true">·</span> ' + thread.helpfulCount + " found helpful" : "") +
      "</p></li>"
    );
  }

  function notice(container, message, kind) {
    container.innerHTML = '<div class="f-notice f-notice--' + (kind || "info") + '" role="status">' + esc(message) + "</div>";
  }

  // Short-lived message announced to screen readers.
  function toast(message) {
    let region = document.getElementById("f-toast");
    if (!region) {
      region = document.createElement("div");
      region.id = "f-toast";
      region.className = "f-toast";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    region.textContent = message;
    region.classList.add("is-visible");
    clearTimeout(region._timer);
    region._timer = setTimeout(() => region.classList.remove("is-visible"), 3200);
  }

  function safetyNotes(notes) {
    return notes
      .map((note) => {
        const link = note.link ? ' <a href="' + esc(note.link.href) + '" target="_blank" rel="noopener">' + esc(note.link.text) + "</a>" : "";
        return '<div class="f-notice f-notice--' + esc(note.level) + '" role="alert">' + esc(note.message) + link + "</div>";
      })
      .join("");
  }

  async function showQueueCount(linkEl) {
    if (!linkEl) return;
    let queue;
    try {
      queue = await Forum.store.moderationQueue();
    } catch (error) {
      return; // the count is a convenience; the queue page still works
    }
    if (!queue.length) return;
    const support = queue.filter((item) => item.support).length;
    const count = document.createElement("span");
    count.className = "f-count" + (support ? " f-count--support" : "");
    count.textContent = String(queue.length);
    linkEl.append(" ", count);
    linkEl.setAttribute(
      "aria-label",
      "Review queue, " + queue.length + " waiting" + (support ? ", " + support + " from someone who may need support" : "")
    );
    if (support) linkEl.title = support === 1 ? "Someone may need support" : support + " people may need support";
  }

  let blocked = false;

  // True when the header replaced the page with a sign-in card or an "offline" notice,
  // so the page script should stop.
  function pageBlocked() {
    return blocked;
  }

  function blockPage(html) {
    blocked = true;
    const main = document.getElementById("main");
    if (main) main.innerHTML = html;
  }

  /*
   * Draws the header. In demo mode it has the demo account switcher; on the live forum it shows
   * who is signed in. The live forum needs an account to read, except pages drawn with
   * { public: true } (the guidelines).
   */
  async function renderHeader(options) {
    const header = document.querySelector("[data-forum-header]");
    if (!header) return null;
    const mode = await Forum.store.mode();
    const user = mode === "offline" ? null : await Forum.store.currentUser();
    const users = mode === "demo" ? await Forum.store.listDemoUsers() : [];
    const here = location.pathname.split("/").pop() || "index.html";
    const link = (href, text) =>
      '<a href="' + href + '"' + (here === href ? ' aria-current="page"' : "") + ">" + text + "</a>";

    document.documentElement.classList.toggle("f-large-text", Boolean(user && user.settings.largeText));

    let account;
    if (mode === "demo") {
      account =
        '<label class="f-demo-switch"><span>Demo account</span><select id="f-demo-user">' +
        users.map((u) => '<option value="' + esc(u.id) + '"' + (user && u.id === user.id ? " selected" : "") + ">" + esc(u.displayName) + "</option>").join("") +
        "</select></label>";
    } else if (user) {
      account = '<div class="f-account"><span>' + esc(user.displayName) + '</span><a href="../account/index.html">Your account</a></div>';
    } else {
      account = '<div class="f-account"><a href="../account/index.html?next=forum">Sign in</a></div>';
    }

    // The top bar is the same as on every other page (logo left; Games, Community, Open Research Studio and Your games
    // right). The community's own links and the account sit on a bar below it, which scrolls away.
    header.innerHTML =
      '<a class="skip-link" href="#main">Skip to main content</a>' +
      '<nav class="f-top" aria-label="Primary navigation">' +
      '<a class="f-brand" href="../home/index.html"><span class="f-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>chemoasis</a>' +
      '<div class="f-top__links">' +
      '<a class="f-top__link" href="../home/index.html?games=1">Games</a>' +
      '<a class="f-top__link" href="index.html" aria-current="true">Community</a>' +
      '<a class="f-top__link" href="../home/research.html">Open Research Studio</a>' +
      '<a class="f-top__link f-top__cta" href="../account/index.html">Your games <span aria-hidden="true">→</span></a>' +
      "</div>" +
      "</nav>";

    let below = document.querySelector("[data-forum-subbar]");
    if (!below) {
      below = document.createElement("div");
      below.setAttribute("data-forum-subbar", "");
      header.after(below);
    }
    below.innerHTML =
      '<div class="f-subbar"><div class="f-subbar__inner">' +
      '<nav class="f-nav" aria-label="Community">' +
      link("index.html", "Conversations") +
      link("new.html", "New post") +
      link("guidelines.html", "Guidelines") +
      (user && user.canModerate ? link("moderation.html", "Review queue") : "") +
      (user ? '<a href="profile.html?id=' + encodeURIComponent(user.id) + '"' + (here === "profile.html" && param("id") === user.id ? ' aria-current="page"' : "") + ">My profile</a>" : "") +
      "</nav>" +
      account +
      "</div></div>" +
      '<p class="f-banner">Chemoasis is supportive and educational. It does not diagnose and does not replace your care team. For new, severe or worsening symptoms, contact your care team, or call 911 in an emergency.</p>' +
      (mode === "demo"
        ? '<p class="f-banner f-banner--demo">Demo: the Chemoasis server isn\'t running, so these are the example posts, and anything you post is saved only in this browser.</p>'
        : "") +
      (mode === "demo" && !Forum.store.isPersistent()
        ? '<p class="f-banner f-banner--warning" role="status">This browser is blocking site storage, so anything you post in this demo disappears when you leave the page.</p>'
        : "");

    // The demo's account switcher and reset button only belong on the demo.
    if (mode !== "demo") document.querySelectorAll("[data-demo-only]").forEach((el) => el.remove());

    // Moderators see how many posts wait for review, so a post from someone who may need
    // support doesn't sit unseen until a moderator happens to open the queue.
    if (user && user.canModerate) showQueueCount(below.querySelector('.f-nav a[href="moderation.html"]'));

    const switcher = below.querySelector("#f-demo-user");
    if (switcher) {
      switcher.addEventListener("change", async (event) => {
        await Forum.store.switchDemoUser(event.target.value);
        location.reload();
      });
    }

    const isPublic = Boolean(options && options.public);
    if (mode === "offline" && !isPublic) {
      blockPage('<div class="f-notice f-notice--warning" role="status">We can\'t reach the community right now. Please try again in a few minutes.</div>');
    } else if (mode === "live" && !user && !isPublic) {
      blockPage(
        '<section class="f-signin" aria-labelledby="signin-heading">' +
          '<p class="eyebrow">Community</p>' +
          '<h1 class="f-h1 f-h1--small" id="signin-heading">Sign in to join the conversation</h1>' +
          '<p class="f-lede">People share health experiences here, so conversations are only open to people with a Chemoasis account. ' +
          "You choose the name people see, and you can post anonymously.</p>" +
          '<a class="f-button" href="../account/index.html?next=forum">Sign in or create an account</a>' +
          '<a href="guidelines.html">Read the community guidelines first</a>' +
          "</section>"
      );
    }
    return user;
  }

  // One report dialog shared by every page.
  function openReportDialog(kind, id, onReported) {
    let dialog = document.getElementById("f-report-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "f-report-dialog";
      dialog.className = "f-dialog";
      dialog.setAttribute("aria-labelledby", "f-report-title");
      dialog.innerHTML =
        '<form method="dialog" class="f-form">' +
        '<h2 class="f-h2" id="f-report-title">Report this post</h2>' +
        '<p class="f-muted">Reports are private. A moderator reviews every one.</p>' +
        '<fieldset><legend>What\'s wrong?</legend>' +
        Forum.catalog.REPORT_REASONS.map(
          (r, i) => '<label class="f-radio"><input type="radio" name="reason" value="' + esc(r.id) + '"' + (i === 0 ? " required" : "") + "> " + esc(r.name) + "</label>"
        ).join("") +
        "</fieldset>" +
        '<label class="f-field"><span>Anything else a moderator should know? (optional)</span><textarea name="note" rows="3" maxlength="500"></textarea></label>' +
        '<div class="f-error" role="alert"></div>' +
        '<div class="f-actions"><button type="button" class="f-button f-button--quiet" data-cancel>Cancel</button><button type="submit" class="f-button" value="send">Send report</button></div>' +
        "</form>";
      document.body.appendChild(dialog);
      dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    }

    const form = dialog.querySelector("form");
    const error = dialog.querySelector(".f-error");
    form.reset();
    error.textContent = "";
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await Forum.store.report(kind, id, data.get("reason"), data.get("note"));
        dialog.close();
        toast("Thanks. A moderator will review your report.");
        if (onReported) await onReported(); // a third report can hide the post, so the page redraws
      } catch (err) {
        error.textContent = err.message;
      }
    };
    dialog.showModal();
  }

  // Draws the post-label radio buttons. Only verified professionals see "Professional guidance".
  function drawLabelOptions(container, user) {
    container.innerHTML = Forum.catalog.LABELS
      .filter((label) => label.id !== "professional" || (user && user.canPostProfessional))
      .map(
        (label, i) =>
          '<label class="f-radio"><input type="radio" name="label" value="' + esc(label.id) + '"' + (i === 0 ? " checked" : "") + "> " +
          '<span><strong>' + esc(label.name) + '</strong><br><span class="f-muted">' + esc(label.hint) + "</span></span></label>"
      )
      .join("");
  }

  // Shows the source field only for "General information" posts.
  // Professional guidance is always signed, so the anonymous box turns off for it.
  function wireSourceField(form, field) {
    const update = () => {
      field.hidden = form.elements.label.value !== "info";
      const anon = form.elements.anonymous;
      if (!anon || anon.dataset.locked) return; // locked when editing: anonymity can't change after posting
      const pro = form.elements.label.value === "professional";
      if (pro) anon.checked = false;
      anon.disabled = pro;
      anon.closest("label").title = pro ? "Professional guidance is always posted under your verified name." : "";
    };
    form.addEventListener("change", update);
    update();
  }

  /*
   * First submit: show any safety notes and ask the person to confirm.
   * Second submit of the same text: post it. Returns true when it's OK to post now.
   */
  async function confirmSafety(form, notesBox, submitButton, draft) {
    const result = await Forum.store.previewDraft(draft);
    const fingerprint = JSON.stringify(draft);
    if (!submitButton.dataset.defaultText) submitButton.dataset.defaultText = submitButton.textContent;
    if (!result.notes.length) {
      // The text changed and is fine now, so old notes and "Send for review" no longer apply.
      notesBox.innerHTML = "";
      submitButton.textContent = submitButton.dataset.defaultText;
      delete form.dataset.reviewed;
      return true;
    }
    if (form.dataset.reviewed === fingerprint) return true;
    form.dataset.reviewed = fingerprint;
    notesBox.innerHTML = safetyNotes(result.notes) + '<p class="f-muted">You can edit your post, or press the button again to post it as is.</p>';
    submitButton.textContent = result.hold ? "Send for review" : "Post anyway";
    notesBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return false;
  }

  // A small dialog that asks for an optional note, used for appeals.
  function askForNote(title, help, buttonText) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "f-dialog";
      dialog.setAttribute("aria-labelledby", "f-note-title");
      dialog.innerHTML =
        '<form method="dialog" class="f-form">' +
        '<h2 class="f-h2" id="f-note-title">' + esc(title) + "</h2>" +
        '<p class="f-muted">' + esc(help) + "</p>" +
        '<label class="f-field"><span>Note for the moderator (optional)</span><textarea name="note" rows="3" maxlength="500"></textarea></label>' +
        '<div class="f-actions"><button type="button" class="f-button f-button--quiet" data-cancel>Cancel</button><button type="submit" class="f-button">' + esc(buttonText) + "</button></div>" +
        "</form>";
      document.body.appendChild(dialog);
      let answered = false;
      dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
      dialog.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        answered = true;
        const note = dialog.querySelector("textarea").value;
        dialog.close();
        resolve(note);
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        if (!answered) resolve(null);
      });
      dialog.showModal();
    });
  }

  // "Listen" reads a post aloud with the browser's built-in voice, for people who prefer audio.
  const canSpeak = "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

  function listenButton(id) {
    return canSpeak ? '<button type="button" class="f-link-button" data-action="listen" data-id="' + esc(id) + '" aria-pressed="false">Listen</button>' : "";
  }

  function toggleListen(button, text) {
    const speaking = button.getAttribute("aria-pressed") === "true";
    window.speechSynthesis.cancel();
    document.querySelectorAll('[data-action="listen"][aria-pressed="true"]').forEach((b) => {
      b.setAttribute("aria-pressed", "false");
      b.textContent = "Listen";
    });
    if (speaking) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = utterance.onerror = () => {
      button.setAttribute("aria-pressed", "false");
      button.textContent = "Listen";
    };
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Stop";
    window.speechSynthesis.speak(utterance);
  }

  /*
   * Unsent drafts are kept in this browser, so a tired moment or a closed tab doesn't lose a long post.
   * Only the fields listed are saved, and only until the post is sent or discarded.
   */
  function keepDraft(form, key, fields, onRestore) {
    const storageKey = "chemoasis-forum-draft:" + key;
    const read = () => {
      try {
        return JSON.parse(localStorage.getItem(storageKey) || "null");
      } catch (error) {
        return null;
      }
    };
    const write = (value) => {
      try {
        if (value) localStorage.setItem(storageKey, JSON.stringify(value));
        else localStorage.removeItem(storageKey);
      } catch (error) {
        // Storage blocked: drafts just aren't kept.
      }
    };

    let timer;
    const saved = read();
    if (saved && fields.some((name) => saved[name])) {
      fields.forEach((name) => {
        if (saved[name] !== undefined && form.elements[name]) form.elements[name].value = saved[name];
      });
      // Discarding clears only the saved fields, so settings like "post anonymously" stay as they were.
      if (onRestore) onRestore(() => {
        clearTimeout(timer);
        write(null);
        fields.forEach((name) => {
          if (form.elements[name] && !form.elements[name].disabled) form.elements[name].value = "";
        });
      });
    }

    form.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const value = {};
        fields.forEach((name) => {
          if (form.elements[name]) value[name] = form.elements[name].value;
        });
        write(fields.some((name) => value[name] && value[name].trim()) ? value : null);
      }, 300);
    });

    return {
      clear: () => {
        clearTimeout(timer); // a save still waiting must not bring back a post that was just sent
        write(null);
      }
    };
  }

  function draftRestoredNotice(container, discard, form) {
    container.innerHTML =
      '<div class="f-notice f-notice--info" role="status">We brought back the draft you hadn\'t posted yet. ' +
      '<button type="button" class="f-link-button" data-discard-draft>Discard it</button></div>';
    container.querySelector("[data-discard-draft]").addEventListener("click", () => {
      discard();
      delete form.dataset.reviewed;
      form.dispatchEvent(new Event("change"));
      container.innerHTML = "";
    });
  }

  return {
    askForNote,
    listenButton,
    toggleListen,
    keepDraft,
    draftRestoredNotice,
    drawLabelOptions,
    wireSourceField,
    confirmSafety,
    esc,
    paragraphs,
    timeAgo,
    fullDate,
    param,
    badge,
    authorLink,
    labelPill,
    gameChips,
    statusNote,
    threadCard,
    notice,
    toast,
    safetyNotes,
    renderHeader,
    pageBlocked,
    openReportDialog
  };
})();
