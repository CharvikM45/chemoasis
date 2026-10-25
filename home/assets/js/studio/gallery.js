/*
 * The Open Research Studio page's "In the library" section: published activities with their
 * creators. It stays hidden when nothing is published yet, or the server isn't there.
 */
(function () {
  const { api, el, AREAS, creatorCard } = window.Studio;
  const section = document.getElementById("library");
  const list = document.getElementById("libraryList");
  if (!section || !list) return;

  api("GET", "/published").then(({ activities }) => {
    if (!activities.length) return;
    list.replaceChildren(...activities.map((a) => el("li", { class: "rs-preview rs-preview--live" },
      el("a", { class: "rs-game rs-game--link", href: "studio-play.html?id=" + encodeURIComponent(a.id) },
        el("p", { class: "rs-game__area", text: AREAS[a.area] || "Activity" }),
        el("p", { class: "rs-game__name", text: a.title }),
        el("p", { class: "rs-game__desc", text: a.summary }),
        el("p", { class: "rs-game__based", text: a.research.length ? `Based on ${a.research.length} published ${a.research.length === 1 ? "study" : "studies"} →` : "See the activity →" })),
      creatorCard(a.creator))));
    section.hidden = false;
  }).catch(() => { /* no server here: the section stays hidden */ });
})();
