/*
 * Review queue (studio-review.html), for the people in MODERATOR_EMAILS. Each submission shows
 * everything the creator entered, the automatic checks with the studies' abstracts, the advisory
 * read, the mock-up and the prototype in its sandbox. A person decides: publish, ask for
 * changes or reject (with a note), or take a published activity down.
 */
(function () {
  const { api, el, AREAS, STATUS, date, creatorCard, safeUrl } = window.Studio;
  const $ = (id) => document.getElementById(id);
  const ICON = { pass: "✓", warn: "!", fail: "✕" };
  const SUPPORT = { yes: "The studies appear to support the claim.", partly: "The studies partly support the claim.", no: "The studies don't appear to support the claim.", unclear: "Can't tell from the titles and abstracts." };

  function message(text) {
    $("message").textContent = text || "";
    $("message").hidden = !text;
  }

  const row = (label, value) => (value ? el("div", { class: "rs-dl__row" }, el("dt", { text: label }), el("dd", { class: "rs-pre", text: value })) : null);

  function checkList(checks) {
    if (!checks) return el("p", { class: "rs-note", text: "No checks have run." });
    const items = checks.items.map((item) => el("li", { class: "rs-check-item rs-check-item--" + item.status },
      el("span", { class: "rs-check-item__icon", "aria-hidden": "true", text: ICON[item.status] }),
      el("div", {}, el("p", { class: "rs-check-item__label", text: item.label }), el("p", { text: item.message }))));
    checks.research.forEach((study, i) => items.push(el("li", { class: "rs-check-item rs-check-item--" + study.status },
      el("span", { class: "rs-check-item__icon", "aria-hidden": "true", text: ICON[study.status] }),
      el("div", {},
        el("p", { class: "rs-check-item__label", text: `Study ${i + 1}: ${study.message}` }),
        study.title ? el("p", {}, safeUrl(study.url) ? el("a", { href: study.url, rel: "noopener", target: "_blank", text: study.title + " ↗" }) : study.title, ` ${study.journal || ""} ${study.year ? "(" + study.year + ")" : ""}`) : el("p", { text: study.link }),
        study.note ? el("p", { class: "rs-muted", text: "Creator's note: " + study.note }) : null,
        study.abstract ? el("details", {}, el("summary", { text: "Abstract" }), el("p", { class: "rs-pre", text: study.abstract })) : null))));
    return el("ul", { class: "rs-checklist" }, items);
  }

  function advisory(ai) {
    if (!ai || ai.status === "off") return el("p", { class: "rs-note", text: "The advisory read is off (no API key)." });
    if (ai.status !== "done") return el("p", { class: "rs-note", text: "The advisory read didn't run for this submission (" + ai.status + ")." });
    return el("div", { class: "rs-advisory" },
      el("p", { class: "rs-advisory__label", text: "Advisory read · not a decision" }),
      el("p", { text: ai.summary }),
      el("p", { class: "rs-muted", text: SUPPORT[ai.researchSupportsClaim] || "" }),
      ai.concerns.length ? el("ul", {}, ai.concerns.map((c) => el("li", {}, el("b", { text: c.topic + ": " }), c.detail))) : el("p", { class: "rs-muted", text: "No concerns listed." }));
  }

  function card(s) {
    const { activity, creator } = s.data;
    const note = el("textarea", { maxlength: "1000", rows: "3", "aria-label": "Note to the creator" });
    const frame = el("iframe", { class: "rs-frame", title: "Prototype of " + (activity.title || "this activity"), sandbox: "allow-scripts", hidden: true });
    const decide = (decision, label) => el("button", {
      class: decision === "publish" ? "button primary" : "button", type: "button", text: label, disabled: s.own,
      onclick: async (event) => {
        const button = event.currentTarget;
        if (decision !== "publish" && note.value.trim().length < 5) { message("Add a note so the creator knows why."); note.focus(); return; }
        if (decision === "publish" && !confirm(`Publish "${activity.title}" with ${creator.name}'s credit?`)) return;
        button.disabled = true;
        try {
          // submittedAt says which version this reviewer read, so a newer one can't be decided unseen.
          await api("POST", "/review/" + s.id, { decision, note: note.value, submittedAt: s.submittedAt });
          message(`Done: "${activity.title}" is now ${STATUS[{ publish: "published", changes: "changes", reject: "rejected", unpublish: "changes" }[decision]].toLowerCase()}.`);
          await load();
        } catch (error) {
          message(error.message);
          if (error.status === 409) await load(); // it changed: show the current version
          else button.disabled = false;
        }
      }
    });

    return el("article", { class: "rs-review" },
      el("header", { class: "rs-review__head" },
        el("div", {},
          el("p", { class: "rs-game__area", text: (AREAS[activity.area] || "No area") + " · sent " + date(s.submittedAt) }),
          el("h3", { text: activity.title || "Untitled" })),
        el("span", { class: "rs-chip rs-chip--" + s.status, text: STATUS[s.status] })),
      creatorCard({ ...creator, verified: false, orcidUrl: "", institution: creator.institution, location: creator.location }),
      el("dl", { class: "rs-dl" },
        row("Account email", s.accountEmail),
        row("ORCID iD", creator.orcid),
        row("NPI number", creator.npi),
        row("Website", creator.website),
        row("Shows institution / location", `${creator.showInstitution ? "yes" : "no"} / ${creator.showLocation ? "yes" : "no"}`)),
      el("dl", { class: "rs-dl" },
        row("Short description", activity.summary),
        row("How it's played", activity.howToPlay),
        row("Who it's for", activity.audience),
        row("What the research supports", activity.claim),
        row("What it doesn't show", activity.limitations),
        s.data.prototypeKind === "spec" ? row("Written plan", s.data.spec) : null),
      el("h4", { text: "Automatic checks" }), checkList(s.checks),
      el("h4", { text: "Advisory read" }), advisory(s.checks && s.checks.ai),
      s.data.sketch ? el("figure", { class: "rs-sketch" }, el("img", { src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s.data.sketch), alt: "The creator's mock-up" }), el("figcaption", { text: "Mock-up" })) : null,
      s.hasCode ? el("div", { class: "actions" }, el("button", { class: "button", type: "button", text: "Try the prototype in the sandbox", onclick: () => { frame.src = `/api/studio/review/${s.id}/prototype?t=${Date.now()}`; frame.hidden = false; } })) : null,
      frame,
      s.own ? el("p", { class: "rs-banner rs-banner--note", text: "This is your own submission, so another reviewer has to decide on it." }) : null,
      el("div", { class: "rs-decide" },
        el("label", { class: "rs-field" }, s.status === "published" ? "Why it's being taken down" : "Note to the creator (needed to ask for changes or reject)", note),
        el("div", { class: "actions" }, s.status === "published"
          ? [decide("unpublish", "Take it down")]
          : [decide("publish", "Publish"), decide("changes", "Ask for changes"), decide("reject", "Reject")])));
  }

  async function load() {
    const { submissions } = await api("GET", "/review");
    const waiting = submissions.filter((s) => s.status === "review");
    const published = submissions.filter((s) => s.status === "published");
    $("queue").replaceChildren(...waiting.map(card));
    $("published").replaceChildren(...published.map(card));
    $("emptyQueue").hidden = waiting.length > 0;
    $("emptyPublished").hidden = published.length > 0;
  }

  (async function start() {
    try {
      const status = await api("GET", "/status");
      if (!status.reviewer) { $("notReviewer").hidden = false; return; }
      $("queueView").hidden = false;
      await load();
    } catch (error) {
      $("notReviewer").hidden = false;
      message(error.message);
    }
  })();
})();
