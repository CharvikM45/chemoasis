/* One conversation: the first post, its replies and the reply form. */
(async function () {
  const { esc, paragraphs, timeAgo, fullDate, badge, authorLink, labelPill, gameChips, statusNote, toast } = Forum.ui;
  const threadId = Forum.ui.param("id");
  const user = await Forum.ui.renderHeader();

  const threadBox = document.getElementById("thread");
  const repliesSection = document.querySelector(".f-replies");
  const repliesList = document.getElementById("replies");
  const mutedNote = document.getElementById("muted-note");
  const compose = document.getElementById("compose");
  const form = document.getElementById("reply-form");
  const notesBox = document.getElementById("reply-notes");
  const posts = {}; // id -> post, for listen and edit

  function source(post) {
    if (!post.sourceUrl) return post.label === "info" ? '<p class="f-source f-muted">No source given.</p>' : "";
    return '<p class="f-source">Source: <a href="' + esc(post.sourceUrl) + '" target="_blank" rel="noopener nofollow">' + esc(post.sourceUrl.replace(/^https?:\/\//, "")) + "</a></p>";
  }

  function actions(post) {
    const visible = post.status === "visible";
    const parts = [];
    if (visible) {
      parts.push(
        '<button type="button" class="f-link-button" data-action="helpful" data-id="' + esc(post.id) + '" aria-pressed="' + post.markedHelpful + '">' +
          (post.markedHelpful ? "✓ Found helpful" : "Found this helpful") + (post.helpfulCount ? " · " + post.helpfulCount : "") + "</button>"
      );
    }
    parts.push(Forum.ui.listenButton(post.id));
    // While a moderator has a post hidden or removed, its author can ask for another review but not edit or delete it.
    const authorCanChange = post.isOwn && (visible || post.status === "pending");
    if (authorCanChange) {
      parts.push('<button type="button" class="f-link-button" data-action="edit" data-kind="' + post.kind + '" data-id="' + esc(post.id) + '">Edit</button>');
    }
    if (authorCanChange) {
      parts.push('<button type="button" class="f-link-button" data-action="delete" data-kind="' + post.kind + '" data-id="' + esc(post.id) + '">Delete</button>');
    } else if (visible) {
      parts.push('<button type="button" class="f-link-button" data-action="report" data-kind="' + post.kind + '" data-id="' + esc(post.id) + '">Report</button>');
    }
    if (post.openReports) parts.push('<span class="f-muted">' + post.openReports + " open report" + (post.openReports === 1 ? "" : "s") + "</span>");
    return '<div class="f-post__actions">' + parts.join("") + "</div>";
  }

  function byline(post) {
    return (
      '<p class="f-post__byline">' + authorLink(post.author) + " " + badge(post.author) +
      ' <span class="f-dot" aria-hidden="true">·</span> <time datetime="' + esc(post.createdAt) + '" title="' + esc(fullDate(post.createdAt)) + '">' + timeAgo(post.createdAt) + "</time>" +
      (post.editedAt ? ' <span class="f-muted" title="' + esc(fullDate(post.editedAt)) + '">(edited)</span>' : "") +
      " " + labelPill(post.label) + "</p>"
    );
  }

  function drawReply(reply) {
    return (
      '<li class="f-post" id="' + esc(reply.id) + '">' + byline(reply) + statusNote(reply, true) +
      '<div class="f-post__body" data-body="' + esc(reply.id) + '">' + paragraphs(reply.body) + "</div>" +
      source(reply) + actions(reply) + "</li>"
    );
  }

  async function draw() {
    let result;
    try {
      result = await Forum.store.getThread(threadId);
    } catch (error) {
      threadBox.innerHTML = '<div class="f-notice f-notice--warning" role="status">' + esc(error.message) + ' <a href="index.html">Back to all conversations</a>.</div>';
      repliesSection.hidden = true;
      repliesList.innerHTML = "";
      compose.hidden = true;
      return;
    }
    const { thread, replies, mutedCount } = result;
    const category = Forum.catalog.category(thread.categoryId);
    document.title = thread.title + " · Chemoasis community";
    posts[thread.id] = thread;
    replies.forEach((r) => (posts[r.id] = r));

    threadBox.innerHTML =
      '<article class="f-post f-post--lead">' +
      (category ? '<a class="f-eyebrow" href="index.html?category=' + encodeURIComponent(category.id) + '">' + esc(category.name) + "</a>" : "") +
      '<h1 class="f-h1 f-h1--small">' + esc(thread.title) + "</h1>" +
      byline(thread) + statusNote(thread, true) +
      '<div class="f-post__body" data-body="' + esc(thread.id) + '">' + paragraphs(thread.body) + "</div>" +
      source(thread) +
      (thread.gameIds && thread.gameIds.length ? '<div class="f-chips"><span class="f-muted">Games discussed:</span> ' + gameChips(thread.gameIds) + "</div>" : "") +
      actions(thread) +
      "</article>";

    repliesSection.hidden = false;
    repliesList.innerHTML = replies.length ? replies.map(drawReply).join("") : '<li class="f-empty">No replies yet. Be the first to reply kindly.</li>';
    mutedNote.textContent = mutedCount ? mutedCount + (mutedCount === 1 ? " reply from someone you muted is hidden." : " replies from people you muted are hidden.") : "";
    compose.hidden = thread.status !== "visible" || !user;
  }

  // Replies are edited in place; the first post is edited on the full form.
  function editReplyInPlace(id) {
    const post = posts[id];
    const body = document.querySelector('[data-body="' + CSS.escape(id) + '"]');
    if (!post || !body || body.querySelector("form")) return;
    body.innerHTML =
      '<form class="f-form f-edit-form">' +
      '<label class="f-field"><span>Edit your reply</span><textarea name="body" rows="5" maxlength="5000"></textarea></label>' +
      '<div class="f-edit-notes"></div><div class="f-error" role="alert"></div>' +
      '<div class="f-actions f-actions--left"><button type="submit" class="f-button">Save</button><button type="button" class="f-button f-button--quiet" data-cancel-edit>Cancel</button></div>' +
      "</form>";
    const editForm = body.querySelector("form");
    editForm.elements.body.value = post.body;
    editForm.elements.body.focus();
    body.querySelector("[data-cancel-edit]").addEventListener("click", draw);
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const draft = { body: editForm.elements.body.value, label: post.label, sourceUrl: post.sourceUrl || "" };
      const button = editForm.querySelector('button[type="submit"]');
      if (!(await Forum.ui.confirmSafety(editForm, editForm.querySelector(".f-edit-notes"), button, draft))) return;
      try {
        const saved = await Forum.store.editMyPost("reply", id, { body: draft.body });
        await draw();
        toast(saved.status === "pending" ? "Saved. A moderator will review it before others can see it." : "Your reply was updated.");
      } catch (error) {
        editForm.querySelector(".f-error").textContent = error.message;
      }
    });
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id, kind } = button.dataset;
    try {
      if (action === "helpful") {
        // Updated in place, so keyboard and screen reader users keep their spot on the page.
        const result = await Forum.store.toggleHelpful(id);
        button.setAttribute("aria-pressed", String(result.marked));
        button.textContent = (result.marked ? "✓ Found helpful" : "Found this helpful") + (result.count ? " · " + result.count : "");
        if (posts[id]) Object.assign(posts[id], { markedHelpful: result.marked, helpfulCount: result.count });
      } else if (action === "listen") {
        const post = posts[id];
        if (post) Forum.ui.toggleListen(button, (post.title ? post.title + ". " : "") + post.body);
      } else if (action === "report") {
        Forum.ui.openReportDialog(kind, id, draw);
      } else if (action === "edit") {
        if (kind === "thread") location.href = "new.html?edit=" + encodeURIComponent(id);
        else editReplyInPlace(id);
      } else if (action === "appeal") {
        const note = await Forum.ui.askForNote(
          "Ask for another review",
          "A moderator will look at this post again. You can only ask once per post.",
          "Send"
        );
        if (note === null) return;
        await Forum.store.requestAnotherReview(kind, id, note);
        await draw();
        toast("Sent. A moderator will take another look.");
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

  let draft = null;
  if (user) {
    Forum.ui.drawLabelOptions(document.getElementById("label-options"), user);
    form.elements.anonymous.checked = Boolean(user.settings.anonymousByDefault);
    draft = Forum.ui.keepDraft(form, "reply:" + user.id + ":" + threadId, ["body", "sourceUrl"], (discard) =>
      Forum.ui.draftRestoredNotice(notesBox, discard, form)
    );
    Forum.ui.wireSourceField(form, document.getElementById("source-field"));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById("reply-error");
    const submit = document.getElementById("reply-submit");
    errorBox.textContent = "";
    const reply = {
      body: form.elements.body.value,
      label: form.elements.label.value,
      sourceUrl: form.elements.label.value === "info" ? form.elements.sourceUrl.value : "",
      anonymous: form.elements.anonymous.checked
    };
    if (reply.body.trim().length < 2) {
      errorBox.textContent = "Please write something before posting.";
      return;
    }
    if (!(await Forum.ui.confirmSafety(form, notesBox, submit, reply))) return;
    try {
      const saved = await Forum.store.createReply(threadId, reply);
      if (draft) draft.clear();
      form.reset();
      delete form.dataset.reviewed;
      notesBox.innerHTML = "";
      submit.textContent = "Post reply";
      Forum.ui.drawLabelOptions(document.getElementById("label-options"), user);
      form.elements.anonymous.checked = Boolean(user.settings.anonymousByDefault);
      form.dispatchEvent(new Event("change"));
      await draw();
      toast(saved.status === "pending" ? "Thanks. A moderator will review your reply before others can see it." : "Your reply is posted.");
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  await draw();
})();
