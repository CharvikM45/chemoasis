/*
 * Your studio (studio-submit.html): a creator's activities, and the five-part form for one of
 * them. Drafts save to the server; "Send for review" runs the automatic checks there and shows
 * the results. Nothing is public until a reviewer publishes it.
 */
(function () {
  const { api, el, STATUS, date } = window.Studio;
  const $ = (id) => document.getElementById(id);
  const form = $("editor");
  const EDITABLE = ["draft", "changes", "rejected", "withdrawn"];
  const MAX_CODE = 300 * 1024;
  const MAX_STUDIES = 5;

  let current = null; // the open submission as the server last returned it (null: not saved yet)
  let code = ""; // the prototype file's contents
  let sketch = ""; // the saved mock-up (SVG)
  let dirty = false;

  function message(text) {
    $("message").textContent = text || "";
    $("message").hidden = !text;
  }

  function show(view) {
    for (const id of ["signedOut", "unavailable", "listView", "editor"]) $(id).hidden = id !== view;
    message("");
  }

  // ---------- the list ----------

  async function showList() {
    show("listView");
    history.replaceState(null, "", location.pathname);
    const { submissions } = await api("GET", "/mine");
    const list = $("list");
    list.replaceChildren(...submissions.map((s) => el("li", { class: "rs-list__item" },
      el("div", {},
        el("p", { class: "rs-list__title", text: s.title || "Untitled activity" }),
        el("p", { class: "rs-list__meta" },
          el("span", { class: "rs-chip rs-chip--" + s.status, text: STATUS[s.status] || s.status }),
          " Updated " + date(s.updatedAt))),
      el("div", { class: "rs-list__actions" },
        s.status === "published" ? el("a", { class: "button", href: "studio-play.html?id=" + encodeURIComponent(s.id), text: "View" }) : null,
        el("button", { class: "button", type: "button", text: EDITABLE.includes(s.status) ? "Continue" : "Open", onclick: () => open(s.id) })))));
    $("emptyList").hidden = submissions.length > 0;
  }

  // ---------- the form ----------

  function field(name) {
    return form.querySelector(`[name="${name}"]`);
  }

  function studyRow(study) {
    const index = $("studies").children.length + 1;
    const row = el("li", { class: "rs-study" },
      el("label", { class: "rs-field" }, "DOI or PubMed link",
        el("input", { class: "study-link", maxlength: "300", value: study.link || "", placeholder: "https://doi.org/10.… or https://pubmed.ncbi.nlm.nih.gov/…" })),
      el("label", { class: "rs-field" }, "What this study found, in a sentence",
        el("input", { class: "study-note", maxlength: "500", value: study.note || "" })),
      el("button", { class: "rs-link", type: "button", text: "Remove study " + index, onclick: () => { row.remove(); renumber(); markDirty(); } }));
    $("studies").append(row);
    renumber();
  }

  function renumber() {
    [...$("studies").children].forEach((row, i) => { row.querySelector(".rs-link").textContent = "Remove study " + (i + 1); });
    $("addStudy").hidden = $("studies").children.length >= MAX_STUDIES;
  }

  function fill(submission) {
    current = submission;
    const data = submission ? submission.data : { activity: {}, creator: {}, research: [], prototypeKind: "spec" };
    for (const input of form.querySelectorAll("[name]")) {
      const [group, key] = input.name.split(".");
      const value = key ? (data[group] || {})[key] : data[group];
      if (input.type === "checkbox") input.checked = value === true;
      else if (input.type === "radio") input.checked = input.value === (value || "spec");
      else input.value = value || "";
    }
    $("studies").replaceChildren();
    (data.research && data.research.length ? data.research : [{}]).forEach(studyRow);
    code = (submission && submission.code) || "";
    sketch = data.sketch || "";
    $("prototypeFile").value = "";
    $("previewFrame").hidden = true;
    $("sketchFigure").hidden = true;
    showSketch();
    showPrototype();
    showStatus();
    showChecks(submission && submission.checks);
    $("missing").hidden = true;
    dirty = false;
    $("saveState").textContent = submission ? "Saved " + date(submission.updatedAt) : "Not saved yet";
  }

  function collect() {
    const data = { activity: {}, creator: {}, research: [] };
    for (const input of form.querySelectorAll("[name]")) {
      const [group, key] = input.name.split(".");
      if (input.type === "radio" && !input.checked) continue;
      const value = input.type === "checkbox" ? input.checked : input.value;
      if (key) data[group][key] = value; else data[group] = value;
    }
    data.research = [...$("studies").children]
      .map((row) => ({ link: row.querySelector(".study-link").value, note: row.querySelector(".study-note").value }))
      .filter((s) => s.link.trim() || s.note.trim());
    data.sketch = sketch;
    return data;
  }

  function showStatus() {
    const status = current ? current.status : "draft";
    const editable = EDITABLE.includes(status);
    $("statusChip").textContent = STATUS[status] || status;
    $("statusChip").className = "rs-chip rs-chip--" + status;
    for (const fieldset of form.querySelectorAll("fieldset")) fieldset.disabled = !editable;
    $("saveButton").hidden = !editable;
    $("submitButton").hidden = !editable;
    $("submitButton").textContent = status === "draft" ? "Send for review" : "Send for review again";
    $("withdrawButton").hidden = !(current && (status === "review" || status === "published"));
    $("deleteButton").hidden = !current;

    const note = $("decisionNote");
    const decision = current && current.decision;
    note.replaceChildren();
    if (status === "published") {
      note.append(el("p", { text: "Published " + date(current.publishedAt) + ". To change it, withdraw it first; it will be reviewed again." }),
        el("a", { href: "studio-play.html?id=" + encodeURIComponent(current.id), text: "See it as players do →" }));
    } else if (status === "review") {
      note.append(el("p", { text: "A reviewer is looking at this. You'll see their decision here." }));
    } else if (decision && decision.note && (status === "changes" || status === "rejected")) {
      note.append(el("p", { class: "rs-banner__label", text: status === "rejected" ? "Not accepted" : "Changes requested" }), el("p", { text: decision.note }));
    }
    note.hidden = !note.childElementCount;
  }

  function showChecks(checks) {
    $("checks").hidden = !checks;
    if (!checks) return;
    $("checksWhen").textContent = "From " + date(checks.ranAt) + ". A reviewer sees these too.";
    const icon = { pass: "✓", warn: "!", fail: "✕" };
    const items = checks.items.map((item) => el("li", { class: "rs-check-item rs-check-item--" + item.status },
      el("span", { class: "rs-check-item__icon", "aria-hidden": "true", text: icon[item.status] }),
      el("div", {}, el("p", { class: "rs-check-item__label", text: item.label + (item.status === "fail" ? " (needs fixing)" : "") }), el("p", { text: item.message }))));
    checks.research.forEach((study, i) => items.push(el("li", { class: "rs-check-item rs-check-item--" + study.status },
      el("span", { class: "rs-check-item__icon", "aria-hidden": "true", text: icon[study.status] }),
      el("div", {},
        el("p", { class: "rs-check-item__label", text: "Study " + (i + 1) + (study.status === "fail" ? " (needs fixing)" : "") }),
        el("p", { text: study.title ? `${study.title}${study.journal ? ", " + study.journal : ""}${study.year ? " (" + study.year + ")" : ""}` : study.message })))));
    $("checkItems").replaceChildren(...items);
  }

  function showSketch() {
    $("savedSketch").hidden = !sketch;
    if (sketch) $("savedSketchImage").src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sketch);
  }

  function showPrototype() {
    const kind = form.querySelector('[name="prototypeKind"]:checked').value;
    $("htmlPrototype").hidden = kind !== "html";
    $("specField").hidden = kind !== "spec";
    $("prototypeInfo").textContent = code ? `A file is attached (${Math.ceil(code.length / 1024)} KB).` : "No file attached yet.";
    $("previewButton").hidden = !code;
  }

  function markDirty() {
    dirty = true;
    $("saveState").textContent = "Unsaved changes";
  }

  async function save() {
    const body = { data: collect(), code };
    const result = current ? await api("PUT", "/mine/" + current.id, body) : await api("POST", "/mine", body);
    fill(result.submission);
    history.replaceState(null, "", "?id=" + encodeURIComponent(result.submission.id));
    return result.submission;
  }

  async function open(id) {
    try {
      const { submission } = await api("GET", "/mine/" + encodeURIComponent(id));
      show("editor");
      fill(submission);
      history.replaceState(null, "", "?id=" + encodeURIComponent(id));
      window.scrollTo(0, 0);
    } catch (error) {
      message(error.message);
    }
  }

  // Runs a button's action with the button disabled and any error shown.
  function busy(button, label, action) {
    return async () => {
      const before = button.textContent;
      button.disabled = true;
      button.textContent = label;
      try { await action(); } catch (error) { message(error.message); window.scrollTo(0, 0); }
      finally { button.disabled = false; button.textContent = before; if (button === $("submitButton")) showStatus(); }
    };
  }

  // ---------- wiring ----------

  form.addEventListener("input", markDirty);
  form.addEventListener("change", (event) => { if (event.target.name === "prototypeKind") showPrototype(); });
  form.addEventListener("submit", (event) => event.preventDefault());
  window.addEventListener("beforeunload", (event) => { if (dirty && !form.hidden) event.preventDefault(); });

  $("newButton").addEventListener("click", () => { show("editor"); fill(null); window.scrollTo(0, 0); });
  $("backButton").addEventListener("click", () => {
    if (dirty && !confirm("Leave without saving your changes?")) return;
    dirty = false;
    showList().catch((error) => message(error.message));
  });
  $("addStudy").addEventListener("click", () => { studyRow({}); markDirty(); });

  $("saveButton").addEventListener("click", busy($("saveButton"), "Saving…", async () => { message(""); await save(); }));

  $("submitButton").addEventListener("click", busy($("submitButton"), "Checking…", async () => {
    message("");
    $("missing").hidden = true;
    const saved = await save();
    try {
      const { submission } = await api("POST", `/mine/${saved.id}/submit`);
      fill(submission);
      message(submission.status === "review"
        ? "Sent. The automatic checks are below, and a reviewer will look at it next."
        : "The automatic checks found something to fix. See below, then send it again.");
      window.scrollTo(0, 0);
    } catch (error) {
      if (!error.missing) throw error;
      $("missing").replaceChildren(el("p", { class: "rs-banner__label", text: error.message }), el("ul", {}, error.missing.map((m) => el("li", { text: m }))));
      $("missing").hidden = false;
      $("missing").scrollIntoView({ block: "center" });
    }
  }));

  $("withdrawButton").addEventListener("click", busy($("withdrawButton"), "Withdrawing…", async () => {
    const live = current.status === "published";
    if (!confirm(live ? "Take this activity down? Players won't see it until it's published again." : "Withdraw this from review?")) return;
    await api("POST", `/mine/${current.id}/withdraw`);
    await open(current.id);
    message(live ? "Taken down. You can change it and send it for review again." : "Withdrawn. You can change it and send it again.");
  }));

  $("deleteButton").addEventListener("click", busy($("deleteButton"), "Deleting…", async () => {
    if (!current || !confirm("Delete this activity for good? This can't be undone.")) return;
    await api("DELETE", "/mine/" + current.id);
    dirty = false;
    await showList();
    message("Deleted.");
  }));

  $("prototypeFile").addEventListener("change", async () => {
    const file = $("prototypeFile").files[0];
    if (!file) return;
    if (file.size > MAX_CODE) { message("That file is over 300 KB. Please make it smaller, or describe the activity in the written plan."); $("prototypeFile").value = ""; return; }
    code = await file.text();
    $("previewFrame").hidden = true;
    showPrototype();
    markDirty();
  });

  $("previewButton").addEventListener("click", busy($("previewButton"), "Loading…", async () => {
    if (dirty || !current) await save();
    const frame = $("previewFrame");
    frame.src = `/api/studio/mine/${current.id}/prototype?t=${Date.now()}`;
    frame.hidden = false;
  }));

  $("sketchButton").addEventListener("click", busy($("sketchButton"), "Sketching…", async () => {
    message("");
    const prompt = $("sketchPrompt").value.trim() || [field("activity.summary").value, field("activity.howToPlay").value].join(" ").trim();
    const result = await api("POST", "/sketch", { description: prompt });
    $("sketchImage").src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(result.svg);
    $("sketchImage").dataset.svg = result.svg;
    $("sketchNotes").textContent = result.notes;
    $("sketchFigure").hidden = false;
  }));
  $("useSketch").addEventListener("click", () => {
    sketch = $("sketchImage").dataset.svg || "";
    $("sketchFigure").hidden = true;
    showSketch();
    markDirty();
  });
  $("removeSketch").addEventListener("click", () => { sketch = ""; showSketch(); markDirty(); });

  // ---------- start ----------

  (async function start() {
    let status;
    try {
      status = await api("GET", "/status");
    } catch (_) {
      show("unavailable");
      return;
    }
    if (!status.signedIn) { show("signedOut"); return; }
    $("reviewLink").hidden = !status.reviewer;
    if (!status.assistant) {
      $("assistantText").textContent = "The design assistant isn't switched on yet. Until it is, describe the screen in the written plan, or attach your own mock-up as a playable file.";
      $("sketchButton").disabled = true;
      $("sketchPrompt").disabled = true;
    }
    const id = new URLSearchParams(location.search).get("id");
    if (id) await open(id);
    else await showList().catch((error) => message(error.message));
  })();
})();
