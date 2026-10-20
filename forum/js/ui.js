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

  function statusNote(item) {
    if (item.status === "pending") return '<p class="f-status f-status--pending">Waiting for a moderator to review. Only you and moderators can see this.</p>';
    if (item.status === "hidden") return '<p class="f-status f-status--hidden">Hidden while a moderator reviews reports. Only you and moderators can see this.</p>';
    if (item.status === "removed") return '<p class="f-status f-status--hidden">Removed by a moderator.</p>';
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

  async function renderHeader() {
    const header = document.querySelector("[data-forum-header]");
    if (!header) return null;
    const user = await Forum.store.currentUser();
    const users = await Forum.store.listDemoUsers();
    const here = location.pathname.split("/").pop() || "index.html";
    const link = (href, text) =>
      '<a href="' + href + '"' + (here === href ? ' aria-current="page"' : "") + ">" + text + "</a>";

    document.documentElement.classList.toggle("f-large-text", Boolean(user && user.settings.largeText));

    header.innerHTML =
      '<a class="skip-link" href="#main">Skip to main content</a>' +
      '<div class="f-header__inner">' +
      '<a class="f-brand" href="../index.html">✣ chemoasis</a>' +
      '<nav class="f-nav" aria-label="Forum">' +
      link("index.html", "Forum") +
      link("new.html", "New post") +
      link("guidelines.html", "Guidelines") +
      (user && user.canModerate ? link("moderation.html", "Review queue") : "") +
      (user ? '<a href="profile.html?id=' + encodeURIComponent(user.id) + '"' + (here === "profile.html" && param("id") === user.id ? ' aria-current="page"' : "") + ">My profile</a>" : "") +
      "</nav>" +
      '<label class="f-demo-switch"><span>Demo account</span><select id="f-demo-user">' +
      users.map((u) => '<option value="' + esc(u.id) + '"' + (user && u.id === user.id ? " selected" : "") + ">" + esc(u.displayName) + "</option>").join("") +
      "</select></label>" +
      "</div>" +
      '<p class="f-banner">Chemoasis is supportive and educational. It does not diagnose and does not replace your care team. For new, severe or worsening symptoms, contact your care team, or call 911 in an emergency.</p>';

    header.querySelector("#f-demo-user").addEventListener("change", async (event) => {
      await Forum.store.switchDemoUser(event.target.value);
      location.reload();
    });
    return user;
  }

  // One report dialog shared by every page.
  function openReportDialog(kind, id) {
    let dialog = document.getElementById("f-report-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "f-report-dialog";
      dialog.className = "f-dialog";
      dialog.innerHTML =
        '<form method="dialog" class="f-form">' +
        '<h2 class="f-h2">Report this post</h2>' +
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
  function wireSourceField(form, field) {
    const update = () => {
      field.hidden = form.elements.label.value !== "info";
    };
    form.addEventListener("change", (event) => {
      if (event.target.name === "label") update();
    });
    update();
  }

  /*
   * First submit: show any safety notes and ask the person to confirm.
   * Second submit of the same text: post it. Returns true when it's OK to post now.
   */
  async function confirmSafety(form, notesBox, submitButton, draft) {
    const result = await Forum.store.previewDraft(draft);
    const fingerprint = JSON.stringify(draft);
    if (!result.notes.length || form.dataset.reviewed === fingerprint) return true;
    form.dataset.reviewed = fingerprint;
    notesBox.innerHTML = safetyNotes(result.notes) + '<p class="f-muted">You can edit your post, or press the button again to post it as is.</p>';
    submitButton.textContent = result.hold ? "Send for review" : "Post anyway";
    notesBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return false;
  }

  return {
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
    openReportDialog
  };
})();
