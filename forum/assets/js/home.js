/* Forum home: categories, filters and the list of conversations. */
(async function () {
  const { esc, param, threadCard } = Forum.ui;
  const { CATEGORIES, GAMES, TRAINING_AREAS } = Forum.catalog;

  await Forum.ui.renderHeader();
  if (Forum.ui.pageBlocked()) return;

  const form = document.getElementById("filters");
  const list = document.getElementById("threads");
  const heading = document.getElementById("threads-heading");
  const count = document.getElementById("result-count");
  const categoryList = document.getElementById("categories");

  const state = {
    categoryId: param("category") || "",
    gameId: param("game") || "",
    area: param("area") || "",
    query: param("q") || "",
    sort: param("sort") || "recent"
  };

  form.elements.game.insertAdjacentHTML("beforeend", GAMES.map((g) => '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>").join(""));
  form.elements.area.insertAdjacentHTML("beforeend", TRAINING_AREAS.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.name) + "</option>").join(""));
  form.elements.q.value = state.query;
  form.elements.game.value = state.gameId;
  form.elements.area.value = state.area;
  form.elements.sort.value = state.sort;

  async function drawCategories() {
    const counts = await Forum.store.categoryCounts();
    const item = (id, name, blurb, total) =>
      '<li><a href="index.html' + (id ? "?category=" + encodeURIComponent(id) : "") + '"' + (state.categoryId === id ? ' aria-current="true"' : "") + ">" +
      '<span class="f-categories__name">' + esc(name) + '</span><span class="f-categories__count">' + total + "</span></a>" +
      (blurb ? '<p class="f-categories__blurb">' + esc(blurb) + "</p>" : "") + "</li>";
    const all = Object.values(counts).reduce((a, b) => a + b, 0);
    categoryList.innerHTML = item("", "All conversations", "", all) + CATEGORIES.map((c) => item(c.id, c.name, c.blurb, counts[c.id] || 0)).join("");
  }

  async function drawThreads() {
    const threads = await Forum.store.listThreads(state);
    const category = Forum.catalog.category(state.categoryId);
    heading.textContent = category ? category.name : "All conversations";
    count.textContent = threads.length + (threads.length === 1 ? " conversation" : " conversations");
    list.innerHTML = threads.length
      ? threads.map(threadCard).join("")
      : '<li class="f-empty">Nothing here yet. <a href="new.html' + (state.categoryId ? "?category=" + encodeURIComponent(state.categoryId) : "") + '">Start the first conversation</a>.</li>';
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.categoryId) params.set("category", state.categoryId);
    if (state.gameId) params.set("game", state.gameId);
    if (state.area) params.set("area", state.area);
    if (state.query) params.set("q", state.query);
    if (state.sort !== "recent") params.set("sort", state.sort);
    history.replaceState(null, "", "index.html" + (params.toString() ? "?" + params : ""));
  }

  let typing;
  form.addEventListener("input", (event) => {
    state.query = form.elements.q.value;
    state.gameId = form.elements.game.value;
    state.area = form.elements.area.value;
    state.sort = form.elements.sort.value;
    clearTimeout(typing);
    typing = setTimeout(() => {
      syncUrl();
      drawThreads();
    }, event.target.name === "q" ? 200 : 0);
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  await drawCategories();
  await drawThreads();
})();
