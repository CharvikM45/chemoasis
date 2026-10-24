/* New conversation form. With ?edit=<id> it edits one of your own conversations instead. */
(async function () {
  const { esc } = Forum.ui;
  const user = await Forum.ui.renderHeader();
  if (Forum.ui.pageBlocked()) return;
  const form = document.getElementById("new-form");
  const hint = document.getElementById("category-hint");
  const submit = document.getElementById("new-submit");
  const notesBox = document.getElementById("new-notes");
  const errorBox = document.getElementById("new-error");
  const editId = Forum.ui.param("edit");

  form.elements.categoryId.insertAdjacentHTML(
    "beforeend",
    Forum.catalog.CATEGORIES.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("")
  );
  form.elements.categoryId.value = Forum.ui.param("category") || "";

  document.getElementById("game-options").innerHTML = Forum.catalog.GAMES.map(
    (g) => '<label class="f-check"><input type="checkbox" name="gameIds" value="' + esc(g.id) + '"> ' + esc(g.name) + "</label>"
  ).join("");
  const checkGame = (id) => {
    const box = form.querySelector('input[name="gameIds"][value="' + CSS.escape(id) + '"]');
    if (box) box.checked = true;
  };
  if (Forum.ui.param("game")) checkGame(Forum.ui.param("game"));

  Forum.ui.drawLabelOptions(document.getElementById("label-options"), user);
  form.elements.anonymous.checked = Boolean(user && user.settings.anonymousByDefault);

  let draft = null;
  if (editId) {
    let thread;
    try {
      thread = (await Forum.store.getThread(editId)).thread;
      if (!thread.isOwn) throw new Error("You can only edit your own posts.");
    } catch (error) {
      form.hidden = true;
      Forum.ui.notice(form.parentElement.insertBefore(document.createElement("div"), form), error.message, "warning");
      return;
    }
    document.querySelector(".f-main .eyebrow").textContent = "Edit conversation";
    document.querySelector(".f-main h1").textContent = "Edit your post";
    document.title = "Edit post · Chemoasis community";
    form.elements.categoryId.value = thread.categoryId;
    form.elements.categoryId.disabled = true;
    form.elements.title.value = thread.title;
    form.elements.body.value = thread.body;
    const labelBox = form.querySelector('input[name="label"][value="' + CSS.escape(thread.label) + '"]');
    if (labelBox) labelBox.checked = true;
    form.elements.sourceUrl.value = thread.sourceUrl || "";
    (thread.gameIds || []).forEach(checkGame);
    form.elements.anonymous.checked = Boolean(thread.anonymous);
    form.elements.anonymous.disabled = true;
    form.elements.anonymous.dataset.locked = "true";
    // Professional guidance always shows who wrote it, so an anonymous post can't switch to it.
    const proOption = form.querySelector('input[name="label"][value="professional"]');
    if (thread.anonymous && proOption) proOption.closest("label").hidden = true;
    form.elements.anonymous.closest("label").title = "Whether a post is anonymous can't change after it's posted.";
    submit.textContent = "Save changes";
    document.querySelector(".f-actions .f-button--quiet").href = "thread.html?id=" + encodeURIComponent(editId);
  } else if (user) {
    draft = Forum.ui.keepDraft(form, "new:" + user.id, ["categoryId", "title", "body", "sourceUrl"], (discard) =>
      Forum.ui.draftRestoredNotice(notesBox, discard, form)
    );
  }
  Forum.ui.wireSourceField(form, document.getElementById("source-field"));

  function showHint() {
    const category = Forum.catalog.category(form.elements.categoryId.value);
    hint.textContent = category ? category.blurb : "";
  }
  form.addEventListener("change", showHint);
  showHint();

  // No more than 3 game tags.
  form.addEventListener("change", (event) => {
    if (event.target.name !== "gameIds") return;
    const checked = form.querySelectorAll('input[name="gameIds"]:checked');
    if (checked.length > 3) {
      event.target.checked = false;
      errorBox.textContent = "You can tag up to 3 games.";
    } else {
      errorBox.textContent = "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.textContent = "";
    const post = {
      categoryId: form.elements.categoryId.value,
      title: form.elements.title.value,
      body: form.elements.body.value,
      label: form.elements.label.value,
      sourceUrl: form.elements.label.value === "info" ? form.elements.sourceUrl.value : "",
      gameIds: Array.from(form.querySelectorAll('input[name="gameIds"]:checked')).map((box) => box.value),
      anonymous: form.elements.anonymous.checked
    };
    if (!post.categoryId) {
      errorBox.textContent = "Please choose a category.";
      form.elements.categoryId.focus();
      return;
    }
    if (post.title.trim().length < 4) {
      errorBox.textContent = "Please add a title (at least 4 characters).";
      form.elements.title.focus();
      return;
    }
    if (post.body.trim().length < 2) {
      errorBox.textContent = "Please write something before posting.";
      form.elements.body.focus();
      return;
    }
    if (!(await Forum.ui.confirmSafety(form, notesBox, submit, post))) return;
    try {
      const saved = editId
        ? await Forum.store.editMyPost("thread", editId, { title: post.title, body: post.body, label: post.label, sourceUrl: post.sourceUrl, gameIds: post.gameIds })
        : await Forum.store.createThread(post);
      if (draft) draft.clear();
      location.href = "thread.html?id=" + encodeURIComponent(saved.id);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });
})();
