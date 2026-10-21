/*
 * Gentle checks run on a post before it goes up. They never diagnose anything.
 * They show a short note, and a possible unsafe medical claim is held for a moderator.
 * No page code here, so this file can move to the React Native app unchanged.
 */
window.Forum = window.Forum || {};

Forum.safety = (function () {
  const CHECKS = [
    {
      id: "crisis",
      // Shown first and never blocks posting: the person may need support right now.
      patterns: [/suicid/i, /kill myself/i, /end my life/i, /self[- ]?harm/i, /want to die/i, /don'?t want to (be here|live)/i],
      level: "support",
      message:
        "It sounds like you might be going through something really hard. You don't have to face it alone. In the US you can call or text 988 to reach the 988 Suicide & Crisis Lifeline any time, or call 911 in an emergency.",
      link: { href: "https://988lifeline.org/", text: "988 Suicide & Crisis Lifeline" }
    },
    {
      id: "urgent",
      patterns: [/chest pain/i, /can'?t breathe/i, /trouble breathing/i, /high fever/i, /passed out/i, /fainted/i],
      level: "warning",
      message:
        "If you have new, severe or worsening symptoms, please contact your care team now, or call 911 in an emergency. The forum can't respond quickly enough to help with that."
    },
    {
      id: "unsafe-medical",
      patterns: [
        /\bcure[sd]?\b/i,
        /\bstop (taking |going to |seeing )?(your |my |the )?(chemo|chemotherapy|medication|meds|treatment|doctor|oncologist)/i,
        /instead of (chemo|chemotherapy|treatment|your doctor|your oncologist|medication)/i,
        /\b(guaranteed|proven) to (heal|fix|cure|reverse)/i,
        /\brevers(e|es|ed) (neuropathy|chemo brain|nerve damage)/i,
        /\bdon'?t need (a |your )?(doctor|oncologist|treatment)/i
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
      if (check.patterns.some((pattern) => pattern.test(text))) notes.push(check);
    });

    return {
      notes,
      hold: notes.some((note) => note.level === "hold")
    };
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

  return { review, isValidSourceUrl };
})();
