/* A member's public profile. On your own profile you also get the privacy settings. */
(async function () {
  const { esc, timeAgo, badge, threadCard, toast } = Forum.ui;
  const me = await Forum.ui.renderHeader();
  const profileId = Forum.ui.param("id") || (me && me.id);
  const box = document.getElementById("profile");
  const list = document.getElementById("profile-threads");

  let result;
  try {
    result = await Forum.store.getProfile(profileId);
  } catch (error) {
    box.innerHTML = '<div class="f-notice f-notice--warning" role="status">' + esc(error.message) + "</div>";
    return;
  }
  const { profile, threads } = result;
  document.title = profile.displayName + " · Chemoasis community";

  const pro = profile.professional;
  box.innerHTML =
    '<p class="eyebrow">' + (profile.isOwn ? "Your profile" : "Member profile") + "</p>" +
    '<h1 class="f-h1 f-h1--small">' + esc(profile.displayName) + "</h1>" +
    '<p class="f-post__byline">' + badge(profile) + ' <span class="f-muted">Joined ' + timeAgo(profile.createdAt) + "</span></p>" +
    (pro && pro.verified
      ? '<dl class="f-defs f-defs--inline"><dt>Credential</dt><dd>' + esc(pro.credential) + "</dd><dt>Specialty</dt><dd>" + esc(pro.specialty) + "</dd>" +
        (pro.location ? "<dt>Location</dt><dd>" + esc(pro.location) + "</dd>" : "") + "</dl>" +
        '<p class="f-hint">The badge confirms these credentials were checked. It doesn\'t vouch for every post.</p>'
      : "") +
    (profile.type === "creator" ? '<p class="f-hint">Activity creators make games for the library. Creator status is not a medical qualification.</p>' : "") +
    (profile.bio ? '<p class="f-lede">' + esc(profile.bio) + "</p>" : "") +
    (profile.isOwn && !profile.showBio && profile.bio ? '<p class="f-hint">Only you can see this. Turn on "Show About you" to make it public.</p>' : "");

  list.innerHTML = threads.length ? threads.map(threadCard).join("") : '<li class="f-empty">No public conversations yet.</li>';

  if (!profile.isOwn) return;

  const settings = document.getElementById("settings");
  const form = document.getElementById("profile-form");
  settings.hidden = false;
  form.elements.displayName.value = profile.displayName;
  form.elements.bio.value = profile.bio || "";
  form.elements.showBio.checked = Boolean(profile.showBio);
  form.elements.anonymousByDefault.checked = Boolean(me.settings.anonymousByDefault);
  form.elements.largeText.checked = Boolean(me.settings.largeText);

  // Larger text applies right away so people can see the difference.
  form.elements.largeText.addEventListener("change", () => {
    document.documentElement.classList.toggle("f-large-text", form.elements.largeText.checked);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById("profile-error");
    errorBox.textContent = "";
    try {
      await Forum.store.updateMyProfile({
        displayName: form.elements.displayName.value,
        bio: form.elements.bio.value,
        showBio: form.elements.showBio.checked
      });
      await Forum.store.updateMySettings({
        anonymousByDefault: form.elements.anonymousByDefault.checked,
        largeText: form.elements.largeText.checked
      });
      toast("Saved.");
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  document.getElementById("reset-demo").addEventListener("click", async () => {
    if (!confirm("Reset all demo posts, reports and settings in this browser?")) return;
    await Forum.store.resetDemo();
    location.href = "index.html";
  });
})();
