/*
 * One published activity (studio-play.html?id=…): the game in its sandbox, how it's played, who
 * made it, and the research behind it. Feedback goes to the community.
 */
(function () {
  const { api, AREAS, creatorCard, studyItem } = window.Studio;
  const $ = (id) => document.getElementById(id);

  function message(text) {
    $("message").textContent = text;
    $("message").hidden = false;
  }

  (async function start() {
    const id = new URLSearchParams(location.search).get("id");
    if (!id) { message("No activity was chosen. Find one on the Research Studio page."); return; }
    let activity;
    try {
      ({ activity } = await api("GET", "/published/" + encodeURIComponent(id)));
    } catch (error) {
      message(error.status === 404 ? "This activity isn't published right now. Its creator may have taken it down." : error.message);
      return;
    }
    document.title = activity.title + " · Research Studio · Chemoasis";
    $("area").textContent = AREAS[activity.area] || "Activity";
    $("title").textContent = activity.title;
    $("summary").textContent = activity.summary;
    $("howToPlay").textContent = activity.howToPlay;
    if (activity.audience) { $("audience").textContent = "Made for: " + activity.audience; $("audience").hidden = false; }
    $("claim").textContent = activity.claim;
    $("limitations").textContent = activity.limitations;
    $("studies").replaceChildren(...activity.research.map(studyItem));
    $("creator").replaceChildren(creatorCard(activity.creator));
    if (activity.playable) {
      $("game").title = activity.title;
      $("game").src = "/api/studio/play/" + encodeURIComponent(activity.id);
      $("game").hidden = false;
    } else {
      $("noGame").hidden = false;
    }
    $("activity").hidden = false;
  })();
})();
