/* One conversation: the first post, its replies and the reply form. */
(async function () {
  const { esc, paragraphs, timeAgo, fullDate, badge, authorLink, labelPill, gameChips, statusNote, toast } = Forum.ui;
  const threadId = Forum.ui.param("id");
  const user = await Forum.ui.renderHeader();

  const threadBox = document.getElementById("thread");
  const repliesSection = document.querySelector(".f-replies");
  const repliesList = document.getElementById("replies");
  const compose = document.getElementById("compose");
  const form = document.getElementById("reply-form");

  function source(post) {
    if (!post.sourceUrl) return post.label === "info" ? '<p class="f-source f-muted">No source given.</p>' : "";
    return '<p class="f-source">Source: <a href="' + esc(post.sourceUrl) + '" target="_blank" rel="noopener nofollow">' + esc(post.sourceUrl.replace(/^https?:\/\//, "")) + "</a></p>";
  }

  function actions(post) {
    const helpful =
      '<button type="button" class="f-link-button" data-action="helpful" data-id="' + esc(post.id) + '" aria-pressed="' + post.markedHelpful + '">' +
      (post.markedHelpful ? "✓ Found helpful" : "Found this helpful") + (post.helpfulCount ? " · " + post.helpfulCount : "") + "</button>";
    const report = post.isOwn ? "" : '<button type="button" class="f-link-button" data-action="report" data-kind="' + post.kind + '" data-id="' + esc(post.id) + '">Report</button>';
    const remove = post.isOwn ? '<button type="button" class="f-link-button" data-action="delete" data-kind="' + post.kind + '" data-id="' + esc(post.id) + '">Delete</button>' : "";
    const reports = post.openReports ? '<span class="f-muted">' + post.openReports + " open report" + (post.openReports === 1 ? "" : "s") + "</span>" : "";
    return '<div class="f-post__actions">' + helpful + report + remove + reports + "</div>";
  }

  function byline(post) {
    return (
      '<p class="f-post__byline">' + authorLink(post.author) + " " + badge(post.author) +
      ' <span class="f-dot" aria-hidden="true">·</span> <time datetime="' + esc(post.createdAt) + '" title="' + esc(fullDate(post.createdAt)) + '">' + timeAgo(post.createdAt) + "</time>" +
      " " + labelPill(post.label) + "</p>"
    );
  }

  function drawReply(reply) {
    return '<li class="f-post" id="' + esc(reply.id) + '">' + byline(reply) + statusNote(reply) + '<div class="f-post__body">' + paragraphs(reply.body) + "</div>" + source(reply) + actions(reply) + "</li>";
  }

  async function draw() {
    let result;
    try {
      result = await Forum.store.getThread(threadId);
    } catch (error) {
      threadBox.innerHTML = '<div class="f-notice f-notice--warning" role="status">' + esc(error.message) + ' <a href="index.html">Back to all conversations</a>.</div>';
      return;
    }
    const { thread, replies } = result;
    const category = Forum.catalog.category(thread.categoryId);
    document.title = thread.title + " · Chemoasis community";

    threadBox.innerHTML =
      '<article class="f-post f-post--lead">' +
      (category ? '<a class="f-eyebrow" href="index.html?category=' + encodeURIComponent(category.id) + '">' + esc(category.name) + "</a>" : "") +
      '<h1 class="f-h1 f-h1--small">' + esc(thread.title) + "</h1>" +
      byline(thread) + statusNote(thread) +
      '<div class="f-post__body">' + paragraphs(thread.body) + "</div>" +
      source(thread) +
      (thread.gameIds && thread.gameIds.length ? '<div class="f-chips"><span class="f-muted">Games discussed:</span> ' + gameChips(thread.gameIds) + "</div>" : "") +
      actions(thread) +
      "</article>";

    repliesSection.hidden = false;
    repliesList.innerHTML = replies.length ? replies.map(drawReply).join("") : '<li class="f-empty">No replies yet. Be the first to reply kindly.</li>';
    compose.hidden = thread.status !== "visible" || !user;
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id, kind } = button.dataset;
    try {
      if (action === "helpful") {
        await Forum.store.toggleHelpful(id);
        await draw();
      } else if (action === "report") {
        Forum.ui.openReportDialog(kind, id);
      } else if (action === "delete") {
        if (!confirm("Delete this post? This can't be undone.")) return;
        await Forum.store.deleteMyPost(kind, id);
        if (kind === "thread") location.href = "index.html";
        else {
          toast("Your reply was deleted.");
          await draw();
        }
      }
    } catch (error) {
      toast(error.message);
    }
  });

  if (user) {
    Forum.ui.drawLabelOptions(document.getElementById("label-options"), user);
    Forum.ui.wireSourceField(form, document.getElementById("source-field"));
    form.elements.anonymous.checked = Boolean(user.settings.anonymousByDefault);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById("reply-error");
    const notesBox = document.getElementById("reply-notes");
    const submit = document.getElementById("reply-submit");
    errorBox.textContent = "";
    const draft = {
      body: form.elements.body.value,
      label: form.elements.label.value,
      sourceUrl: form.elements.label.value === "info" ? form.elements.sourceUrl.value : "",
      anonymous: form.elements.anonymous.checked
    };
    if (draft.body.trim().length < 2) {
      errorBox.textContent = "Please write something before posting.";
      return;
    }
    if (!(await Forum.ui.confirmSafety(form, notesBox, submit, draft))) return;
    try {
      const saved = await Forum.store.createReply(threadId, draft);
      form.reset();
      delete form.dataset.reviewed;
      notesBox.innerHTML = "";
      submit.textContent = "Post reply";
      Forum.ui.drawLabelOptions(document.getElementById("label-options"), user);
      form.elements.anonymous.checked = Boolean(user.settings.anonymousByDefault);
      document.getElementById("source-field").hidden = true;
      await draw();
      toast(saved.status === "pending" ? "Thanks. A moderator will review your reply before others can see it." : "Your reply is posted.");
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  await draw();
})();
