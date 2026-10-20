/* New conversation form. */
(async function () {
  const { esc } = Forum.ui;
  const user = await Forum.ui.renderHeader();
  const form = document.getElementById("new-form");
  const hint = document.getElementById("category-hint");
  const submit = document.getElementById("new-submit");
  const notesBox = document.getElementById("new-notes");
  const errorBox = document.getElementById("new-error");

  form.elements.categoryId.insertAdjacentHTML(
    "beforeend",
    Forum.catalog.CATEGORIES.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("")
  );
  form.elements.categoryId.value = Forum.ui.param("category") || "";

  document.getElementById("game-options").innerHTML = Forum.catalog.GAMES.map(
    (g) => '<label class="f-check"><input type="checkbox" name="gameIds" value="' + esc(g.id) + '"> ' + esc(g.name) + "</label>"
  ).join("");
  const preselectedGame = Forum.ui.param("game");
  if (preselectedGame) {
    const box = form.querySelector('input[name="gameIds"][value="' + CSS.escape(preselectedGame) + '"]');
    if (box) box.checked = true;
  }

  Forum.ui.drawLabelOptions(document.getElementById("label-options"), user);
  Forum.ui.wireSourceField(form, document.getElementById("source-field"));
  form.elements.anonymous.checked = Boolean(user && user.settings.anonymousByDefault);

  function showHint() {
    const category = Forum.catalog.category(form.elements.categoryId.value);
    hint.textContent = category ? category.blurb : "";
  }
  form.elements.categoryId.addEventListener("change", showHint);
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
    const draft = {
      categoryId: form.elements.categoryId.value,
      title: form.elements.title.value,
      body: form.elements.body.value,
      label: form.elements.label.value,
      sourceUrl: form.elements.label.value === "info" ? form.elements.sourceUrl.value : "",
      gameIds: Array.from(form.querySelectorAll('input[name="gameIds"]:checked')).map((box) => box.value),
      anonymous: form.elements.anonymous.checked
    };
    if (!draft.categoryId) {
      errorBox.textContent = "Please choose a category.";
      form.elements.categoryId.focus();
      return;
    }
    if (draft.title.trim().length < 4) {
      errorBox.textContent = "Please add a title (at least 4 characters).";
      form.elements.title.focus();
      return;
    }
    if (draft.body.trim().length < 2) {
      errorBox.textContent = "Please write something before posting.";
      form.elements.body.focus();
      return;
    }
    if (!(await Forum.ui.confirmSafety(form, notesBox, submit, draft))) return;
    try {
      const saved = await Forum.store.createThread(draft);
      location.href = "thread.html?id=" + encodeURIComponent(saved.id);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });
})();
