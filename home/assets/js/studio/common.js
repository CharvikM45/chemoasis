/*
 * Open Research Studio pages: what the submit, review, play and Open Research Studio pages share.
 * Talks to /api/studio (server/studio.js). On a host without the server (plain files, a static
 * preview) every call fails with a friendly message, and the pages say the Studio isn't
 * available there.
 */
window.Studio = (function () {
  const AREAS = {
    memory: "Memory",
    words: "Words and language",
    focus: "Focus and attention",
    speed: "Thinking speed",
    planning: "Planning and problem-solving",
    hand: "Hand coordination"
  };

  const STATUS = {
    draft: "Draft",
    review: "With a reviewer",
    changes: "Needs changes",
    published: "Published",
    rejected: "Not accepted",
    withdrawn: "Withdrawn"
  };

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch("/api/studio" + path, {
        method,
        credentials: "same-origin",
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (_) {
      throw new Error("We can't reach the Open Research Studio right now. Check your connection and try again.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const error = new Error((data && data.error) || "The Open Research Studio isn't available here.");
      error.status = res.status;
      error.missing = data && data.missing;
      throw error;
    }
    return data;
  }

  // Builds an element: el("p", { class: "x", text: "Hi" }, child, ...). Text is always set as
  // text, never as HTML, so nothing a creator typed can become markup.
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  // Only links to https pages are made clickable.
  function safeUrl(url) {
    return /^https:\/\/[^\s<>"]+$/i.test(String(url || "")) ? url : null;
  }

  // The creator card players see under every published activity.
  function creatorCard(creator) {
    const initial = (creator.name || "?").replace(/^(dr\.?\s+)/i, "").charAt(0).toUpperCase();
    const meta = [creator.specialty, creator.institution, creator.location].filter(Boolean).join(" · ");
    const links = [];
    if (safeUrl(creator.orcidUrl)) links.push(el("a", { href: creator.orcidUrl, rel: "noopener", target: "_blank", text: "ORCID ↗" }));
    if (safeUrl(creator.website)) links.push(el("a", { href: creator.website, rel: "noopener nofollow", target: "_blank", text: "Website ↗" }));
    return el("div", { class: "rs-creator" },
      el("span", { class: "rs-avatar", "aria-hidden": "true", text: initial }),
      el("div", {},
        el("p", { class: "rs-creator__name" },
          creator.credentials && !(creator.name || "").includes(creator.credentials) ? creator.name + ", " + creator.credentials : creator.name,
          creator.verified ? el("span", { class: "rs-verified", title: "Credentials checked against a public registry", text: "✓ Verified" }) : null),
        meta ? el("p", { class: "rs-creator__meta", text: meta }) : null,
        links.length ? el("p", { class: "rs-creator__meta rs-creator__links" }, links) : null));
  }

  // A cited study as a link to its record.
  function studyItem(study) {
    const where = [study.journal, study.year].filter(Boolean).join(", ");
    return el("li", {},
      safeUrl(study.url) ? el("a", { href: study.url, rel: "noopener", target: "_blank", text: (study.title || study.url) + " ↗" }) : el("span", { text: study.title || "" }),
      where ? el("span", { class: "rs-study__where", text: where }) : null);
  }

  function date(value) {
    if (!value) return "";
    return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  return { AREAS, STATUS, api, el, safeUrl, creatorCard, studyItem, date };
})();
