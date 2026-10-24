/* Moderator review queue: reported posts and posts held by the safety check. */
(async function () {
  const { esc, paragraphs, timeAgo, fullDate, badge, authorLink, labelPill, toast } = Forum.ui;
  const user = await Forum.ui.renderHeader();
  const area = document.getElementById("queue-area");
  const history = document.getElementById("history");

  if (!user || !user.canModerate) {
    area.innerHTML =
      '<div class="f-notice f-notice--info" role="status">Only moderators can see the review queue.</div>';
    history.closest("section").hidden = true;
    return;
  }

  const STATUS_NAMES = { visible: "Still visible", pending: "Held, not visible", hidden: "Hidden", removed: "Removed" };
  const reasonName = (id) => (id === "appeal" ? "Author asked for another review" : (Forum.catalog.reportReason(id) || { name: id }).name);

  function card(item) {
    const post = item.post;
    return (
      '<li class="f-card f-queue-item">' +
      '<div class="f-card__meta"><span class="f-eyebrow">' + (item.kind === "thread" ? "Conversation" : "Reply") + "</span>" + labelPill(post.label) +
      '<span class="f-status-tag">' + esc(STATUS_NAMES[post.status] || post.status) + "</span></div>" +
      '<h2 class="f-h3"><a href="thread.html?id=' + encodeURIComponent(item.threadId) + (item.kind === "reply" ? "#" + encodeURIComponent(post.id) : "") + '">' + esc(item.threadTitle) + "</a></h2>" +
      '<p class="f-post__byline">' + authorLink(post.author) + " " + badge(post.author) + ' <span class="f-dot" aria-hidden="true">·</span> <time title="' + esc(fullDate(post.createdAt)) + '">' + timeAgo(post.createdAt) + "</time></p>" +
      '<blockquote class="f-quote">' + paragraphs(post.body) + "</blockquote>" +
      (item.reports ? '<ul class="f-report-list">' +
      item.reports.map((r) =>
        "<li><strong>" + esc(reasonName(r.reason)) + "</strong>" + (r.automatic ? ' <span class="f-badge f-badge--mod">Safety check</span>' : "") +
        (r.note ? " · " + esc(r.note) : "") + ' <span class="f-muted">' + timeAgo(r.createdAt) + "</span></li>"
      ).join("") +
      "</ul>" : "") +
      '<label class="f-field"><span>Note for the record (optional)</span><input type="text" maxlength="500" data-note="' + esc(item.targetId) + '"></label>' +
      '<div class="f-actions f-actions--left">' +
      '<button type="button" class="f-button" data-resolve="keep" data-id="' + esc(item.targetId) + '">' + (post.status === "visible" ? "Keep it up" : "Make it visible") + "</button>" +
      (post.status === "hidden" && !item.reports ? "" : '<button type="button" class="f-button f-button--quiet" data-resolve="hide" data-id="' + esc(item.targetId) + '">Hide</button>') +
      '<button type="button" class="f-button f-button--danger" data-resolve="remove" data-id="' + esc(item.targetId) + '">Remove</button>' +
      "</div></li>"
    );
  }

  async function draw() {
    const queue = await Forum.store.moderationQueue();
    area.innerHTML = queue.length
      ? '<p class="f-muted" aria-live="polite">' + queue.length + (queue.length === 1 ? " item needs" : " items need") + " review.</p><ul class=\"f-cards\">" + queue.map(card).join("") + "</ul>"
      : '<div class="f-notice f-notice--info" role="status">All clear. Nothing is waiting for review.</div>';

    // Hidden posts stay listed, so a moderator can come back after checking something.
    const hidden = await Forum.store.hiddenPosts();
    area.insertAdjacentHTML(
      "beforeend",
      '<section aria-labelledby="hidden-heading"><h2 class="f-h2" id="hidden-heading">Hidden posts</h2>' +
        (hidden.length
          ? '<p class="f-muted">Only the author and moderators can see these. Make one visible again or remove it when you\'ve decided.</p><ul class="f-cards">' + hidden.map(card).join("") + "</ul>"
          : '<p class="f-muted">No hidden posts.</p>') +
        "</section>"
    );

    const past = await Forum.store.moderationHistory();
    const verbs = { keep: "Kept", hide: "Hid", remove: "Removed", "author-deleted": "Closed (the author deleted it):" };
    history.innerHTML = past.length
      ? past.map((r) => "<li>" + esc(verbs[r.resolution] || r.resolution) + " a " + esc(r.targetType) + " reported for " + esc(reasonName(r.reason).toLowerCase()) +
          (r.moderatorNote ? ' · "' + esc(r.moderatorNote) + '"' : "") + ' <span class="f-muted">' + timeAgo(r.resolvedAt) + "</span></li>").join("")
      : '<li class="f-muted">No decisions yet.</li>';
  }

  area.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-resolve]");
    if (!button) return;
    const id = button.dataset.id;
    const noteInput = area.querySelector('[data-note="' + CSS.escape(id) + '"]');
    try {
      await Forum.store.resolve(id, button.dataset.resolve, noteInput ? noteInput.value : "");
      toast({ keep: "Done. The post is visible.", hide: "Hidden.", remove: "Removed." }[button.dataset.resolve]);
      await draw();
    } catch (error) {
      toast(error.message);
    }
  });

  await draw();
})();
