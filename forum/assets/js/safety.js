/*
 * Gentle checks run on a post before it goes up. They never diagnose anything.
 * They show a short note. A possible unsafe medical claim is held for a moderator, and
 * a post that sounds like someone may be in crisis goes up as normal but is put at the
 * top of the moderators' queue, so a person checks on it.
 * No page code here, so this file can move to the React Native app unchanged.
 *
 * forum/tests/forum.test.js has phrases each list must catch, and everyday sentences it
 * must leave alone. Add to both when you change a list.
 * These phrase lists are a starting point, not a clinical tool. A qualified person
 * should review them before the forum opens to the public.
 */
window.Forum = window.Forum || {};

Forum.safety = (function () {
  // ['’] accepts the curly apostrophe phones type ("can’t") as well as the straight one.
  const CHECKS = [
    {
      id: "crisis",
      // Shown first and never blocks posting: the person may need support right now.
      // `alert` also puts the post at the top of the moderators' queue.
      patterns: [
        /suicid/i,
        /\bkill(ing)? myself/i,
        /\bend(ing)? (my life|it all)\b/i,
        /\bself[- ]?harm/i,
        /\b(hurt(ing)?|harm(ing)?|cut(ting)?) myself/i,
        /\bwant(ed|ing)? to die\b/i,
        /\bwish(ed)? i (was|were) dead\b/i,
        /\bbetter off (dead|without me)\b/i,
        /\bno reason to (live|go on|keep going)\b/i,
        /\bnot worth living\b/i,
        /\bcan['’]?t go on\b/i,
        /\bdon['’]?t want to (be here|live|wake up)/i,
        /\boverdos(e|ed|ing)\b/i,
        /\btak(e|ing) my (own )?life\b/i,
        /\b(do ?n['’]?t|do not|no longer) want to (be alive|exist|keep living|live anymore)\b/i,
        /\bno (point|reason) (in|to) (living|being alive|life|going on)\b/i,
        /\bun-?aliv(e|ing) myself\b/i,
        /\bkms\b/i,
        /\b(rather|better) be dead\b/i,
        /\bwant(ed|ing)? (it all|everything|my life|it) to (all )?end\b/i
      ],
      level: "support",
      alert: true,
      message:
        "It sounds like you might be going through something really hard. You don't have to face it alone. In the US you can call or text 988 to reach the 988 Suicide & Crisis Lifeline any time, or call 911 in an emergency.",
      link: { href: "https://988lifeline.org/", text: "988 Suicide & Crisis Lifeline" }
    },
    {
      // During chemotherapy a fever can be the only sign of a serious infection (CDC).
      id: "fever",
      level: "warning",
      message:
        "During chemotherapy, a temperature of 100.4°F (38°C) or higher can be a medical emergency. The CDC says to call your doctor right away, even in the middle of the night. Please don't wait for replies here.",
      link: { href: "https://www.cdc.gov/cancer/features/preventing-infections.html", text: "CDC: preventing infections during chemotherapy" }
    },
    {
      id: "urgent",
      patterns: [/chest pain/i, /can['’]?t breathe/i, /trouble breathing/i, /passed out/i, /fainted/i], // fevers have their own check above
      level: "warning",
      message:
        "If you have new, severe or worsening symptoms, please contact your care team now, or call 911 in an emergency. The forum can't respond quickly enough to help with that."
    },
    {
      id: "unsafe-medical",
      patterns: [
        // A claim that something cures, not every mention of a cure ("I hope they find a cure").
        /\b(cured|cures) (my|your|his|her|their|our|the|it|chemo|neuropathy|brain fog|cancer)\b/i,
        /\b(will|can|could|would|helps?|this|that) cure\b/i,
        /\b(is|was|are|it['’]?s) (a|the|my) (natural |real )?cure (for|of)\b/i,
        /\bstop (taking |going to |seeing )?(your |my |the )?(chemo|chemotherapy|medication|meds|treatment|doctor|oncologist)/i,
        /instead of (chemo|chemotherapy|treatment|your doctor|your oncologist|medication)/i,
        /\b(guaranteed|proven) to (heal|fix|cure|reverse)/i,
        /\brevers(e|es|ed) (neuropathy|chemo brain|nerve damage)/i,
        /\bdon['’]?t need (a |your )?(doctor|oncologist|treatment)/i
      ],
      level: "hold",
      message:
        "This post may read as medical advice or a promise that something works. Personal stories are welcome, but no game or tip should replace a care team. If you post it as is, a moderator will review it before others can see it."
    },
    {
      id: "privacy",
      patterns: [
        /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
        /[\w.+-]+@[\w-]+\.[\w.]+/,
        /\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln)\b/i
      ],
      level: "warning",
      message:
        "It looks like this might include a phone number, email or address. Posts are visible to the community, so consider removing personal details."
    },
    {
      id: "no-source",
      level: "info",
      message:
        "You labeled this as general information. Adding a source link (for example a cancer center or government health page) helps others trust and check it."
    }
  ];

  // Returns the notes that apply to a draft. `hold` is true when a moderator must review it first.
  function review(draft) {
    const text = [draft.title || "", draft.body || ""].join("\n");
    const notes = [];

    CHECKS.forEach((check) => {
      if (check.id === "no-source") {
        if (draft.label === "info" && !draft.sourceUrl) notes.push(check);
        return;
      }
      if (check.id === "fever") {
        if (mentionsFever(text)) notes.push(check);
        return;
      }
      if (check.patterns.some((pattern) => pattern.test(text))) notes.push(check);
    });

    return {
      notes,
      hold: notes.some((note) => note.level === "hold"),
      alert: notes.some((note) => note.alert)
    };
  }

  /*
   * True for the word "fever", or a temperature of 100.4°F / 38°C or higher:
   * "101.2", "38.5 C", "temp of 100.6". A bare number needs a unit or a nearby
   * "temp"/"temperature", so "I slept 100 hours" doesn't count.
   */
  function mentionsFever(text) {
    if (/\bfever(s|ish)?\b/i.test(text)) return true;
    const reading = /(\btemp(erature)?\b[^.\d]{0,20})?\b(\d{2,3}(?:\.\d)?)\s*(°|º|degrees?\b|deg\b)?\s*([fc])?\b/gi;
    let match;
    while ((match = reading.exec(text))) {
      const value = parseFloat(match[3]);
      const unit = (match[5] || "").toLowerCase();
      const hasContext = Boolean(match[1] || match[4] || unit);
      if (!hasContext) continue;
      if (unit === "c" || (!unit && value < 45)) {
        if (value >= 38 && value <= 43) return true;
      } else if (value >= 100.4 && value <= 110) {
        return true;
      }
    }
    return false;
  }

  function isValidSourceUrl(url) {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch (error) {
      return false;
    }
  }

  return { review, isValidSourceUrl, mentionsFever };
})();
