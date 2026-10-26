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
        /\bdon['’]?t want to (be here|live|wake up)/i,
        /\boverdos(e|ed|ing)\b/i,
        /\btak(e|ing) my (own )?life\b/i,
        /\b(do ?n['’]?t|do not|no longer) want to (be alive|exist|keep living|live anymore)\b/i,
        /\bno (point|reason) (in|to) (living|being alive|life|going on)\b/i,
        /\bun-?aliv(e|ing) myself\b/i,
        /\bkms\b/i,
        /\b(rather|better) be dead\b/i,
        /\bwant(ed|ing)? (it all|everything|my life|it) to (all )?end\b/i,
        // Everyday ways of saying it that the lines above miss (re-audit, 2026-10-26).
        /\b(wanna|ready to|wish i could|wish i would) die\b/i,
        /\b(want(ed|ing)? to|wanna|going to|gonna|ready to|plan(ning)? to|think(ing)? (about|of)) end(ing)? (it|things|everything)( all)?\s*([.!?,;]|$)/im,
        /\b(do ?n['’]?t|do not|can['’]?t|can ?not|could ?n['’]?t) (want to )?(go on|keep going)( like this)?( anymore| any more)?\s*([.!?,;]|$)/im,
        /\bbetter off (if|when|once) i (was|were|wasn['’]?t|weren['’]?t|am|died|die|was gone|were gone)\b/i,
        /\b(wish|want|hope|pray|think(ing)? about)\b[^.!?\n]{0,20}(\bnot|\bnever|n['’]?t) (to )?wak(e|ing) up\b/i,
        /\bsleep and (not|never) wake up\b/i,
        /\b(sav(e|ing)|stockpil(e|ing)|hoard(ing)?) (up )?(all )?(my |of my )?(pills|meds|medication|medicine|tablets)\b/i,
        /\b(take|taking|swallow(ing)?) all (of )?my (pills|meds|medication|tablets)\b/i,
        /\b(i['’]?m|i am) done (fighting|living|with life|with everything)\b/i,
        /\bwant(ed|ing)? (it all|everything) to (just )?stop\b/i,
        /\b(do ?n['’]?t|can['’]?t) see the point (anymore|any more|in (anything|living|life|going on))\b/i,
        /\bdisappear (forever|for good|permanently)\b/i,
        /\bcan['’]?t do this any ?more\b/i,
        /\blet (it|death|the cancer|nature) (just )?(happen|take me|win|take its course)\b/i,
        // Missed in the ChatGPT audit (2026-10-26). These also run on a cleaned-up copy of the
        // text (see normalize below), so "k1ll my self", "kiII myself" and "want 2 d!e" count too.
        /\bend(ing)? my (own )?life\b/i,
        /\bun-?aliv(e|ing) (me|myself)\b/i,
        /\b(off|offing|delet(e|ing)) myself\b/i,
        /\b(do ?n['’]?t|do not|dont) want to (wake up|be here|live)\b/i,
        /\b(sleep|go to sleep) forever\b/i,
        /\b(happier|better|easier)( off)? (if|when|once) i (was|were|am|['’]m) (gone|dead|not here|not around)\b/i,
        /\bbetter( off)? without me\b/i,
        /\bthis is (my|a) (final |last )?goodbye\b/i,
        /\b(decided|going|gonna|plan(ning)?|want(ing)?|ready|feel like) (to )?end(ing)? (it|things|everything)( all)? (tonight|today|tomorrow|soon|now|rn|after)\b/i,
        /\b(cut|cutting|burn(ing)?|hurt(ing)?|scratch(ing)?) (my|myself)\b[^.!?\n]{0,30}\bon purpose\b/i,
        /\b(promise|sure)\b[^.!?\n]{0,20}\bkeep (myself|me) safe\b/i,
        /\bdo something\b[^.!?\n]{0,15}\b(to myself|permanent)\b/i,
        /\b(take|taking|swallow(ing)?) (every|all the) (pill|pills|tablet|tablets)( that)? (i have|i['’]ve got|in the house)\b/i,
        /\bstop existing\b/i,
        /\bwish i (was|were) (not|never) (alive|born|here)\b/i,
        /\bwish i (wasn['’]?t|weren['’]?t) (alive|born)\b/i
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
      // Fevers have their own check above.
      patterns: [
        /chest pain/i,
        /\bchest\b[^.!?\n]{0,25}\b(tight|heavy|pressure|crushing)\b/i,
        /\b(tight|heavy|crushing|pressure)\b[^.!?\n]{0,25}\bchest\b/i,
        /\b(can['’]?t|can ?not|could ?n['’]?t|unable to|struggling to|hard to|trouble|difficulty) (breathe|breathing|catch my breath)\b/i,
        /\bshort(ness)? of breath\b/i,
        /\bgasping\b/i,
        /\bblue lips\b/i,
        /\bpassed out\b/i,
        /\bfainted\b/i,
        /\b(lost|losing) consciousness\b/i,
        /\bblack(ed)? out\b/i
      ],
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
        /\b(stop|quit|ditch) (taking |going to |seeing )?(your |my |the )?([\w'’-]+ ){0,2}?(chemo|chemotherapy|medications?|meds|treatment|doctor|oncologist)/i,
        /\b(do ?n['’]?t|no need to|never) (take|bother taking) (your|the) ([\w'’-]+ ){0,2}?(medications?|meds|pills|steroids)/i,
        // Advice to someone else ("your"), not a story about one's own schedule ("I had to delay my cycle").
        /\b(skip|skipping|delay|delaying|postpone|cancel|push back) (your|their) (next )?(chemo |infusion )?(cycles?|doses?|infusions?|rounds?|treatments?)\b/i,
        /instead of (chemo|chemotherapy|treatment|your doctor|your oncologist|medication)/i,
        /\b(guaranteed|proven) to (heal|fix|cure|reverse)/i,
        /\brevers(e|es|ed) (neuropathy|chemo brain|nerve damage)/i,
        /\bdon['’]?t need (a |your )?(doctor|oncologist|treatment)/i,
        /\bcancer (disappears|goes away|vanishes|melts away)\b/i
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
      const texts = check.id === "crisis" ? [text, normalize(text)] : [text];
      if (check.patterns.some((pattern) => texts.some((t) => pattern.test(t)))) notes.push(check);
      else if (check.id === "unsafe-medical" && givesRiskyAdvice(text)) notes.push(check);
    });

    return {
      notes,
      hold: notes.some((note) => note.level === "hold"),
      alert: notes.some((note) => note.alert)
    };
  }

  /*
   * A copy of the text with common disguises undone, for the crisis check only: look-alike and
   * full-width letters, "my self", "k1ll", "kiII" (capital I for l), "d!e" and "want 2 die".
   */
  function normalize(text) {
    return String(text)
      .normalize("NFKC")
      .replace(/(?<=[a-z])I+/g, (m) => "l".repeat(m.length))
      .toLowerCase()
      .replace(/[а-яёіїυοα]/g, (c) => CONFUSABLE[c] || c)
      .replace(/(?<=[a-z])[1!|](?=[a-z])/g, "i")
      .replace(/(?<=[a-z])0(?=[a-z])/g, "o")
      .replace(/(?<=[a-z])3(?=[a-z])/g, "e")
      .replace(/\bmy self\b/g, "myself")
      .replace(/\b2 (die|live)\b/g, "to $1");
  }

  /*
   * Advice to change or stop treatment: "Double your dose", "Just skip the next chemo cycle",
   * "You do not need to take the pills your doctor gave you". Only sentences that tell someone
   * else what to do (they start with the instruction, or say "you"), so "My doctor reduced my
   * dose" or "We had to delay my next cycle" are left alone. A sentence that sends people to
   * their care team ("Ask your doctor before you change your dose") is fine, unless it says
   * not to ("without checking with your doctor", "don't tell your care team").
   */
  const RISKY_ADVICE = [
    /\b(skip|miss|postpone|delay|cancel|take a break from|stop|quit|discontinue|wean (yourself )?off)\b[^.!?\n]{0,40}\b(chemo|chemotherapy|infusions?|cycles?|rounds?|doses?|treatments?|appointments?|medicines?|medications?|meds|pills|tablets|steroids?|antibiotics|blood thinners?|prescriptions?)\b/i,
    /\bput (your |the )?(next )?(chemo(therapy)? )?(infusion|cycle|treatment|round|appointment)s? off\b/i,
    /\b(do ?n['’]?t|do not|never|no need to)\b[^.!?\n]{0,10}\b(take|bother taking|go to)\b[^.!?\n]{0,30}\b(pills?|meds|medications?|medicines?|steroids?|tablets?|chemo|chemotherapy|treatment|appointment|blood thinners?|antibiotics|prescriptions?)\b/i,
    /\b(double|triple|increase|reduce|cut|lower|raise|halve)\b[^.!?\n]{0,30}\b(dose|doses|dosage|medications?|medicines?|meds)\b/i,
    /\b(take|taking) (an extra|two|double|twice)\b[^.!?\n]{0,25}\b(dose|doses|pills?|tablets?|medications?|as much)\b/i,
    /\bcrush(ing)?\b[^.!?\n]{0,25}\b(chemo|chemotherapy|tablets?|pills?|capsules?)\b/i,
    /\b(share|borrow|lend)\b[^.!?\n]{0,30}\bprescription/i,
    /\breplace\b[^.!?\n]{0,30}\b(chemo|chemotherapy|treatment|medications?|medicines?|meds|prescri)/i,
    /\bflush\b[^.!?\n]{0,25}\b(pills?|meds|medications?|prescriptions?|tablets?)\b/i,
    /\b(do ?n['’]?t|do not|never)\b[^.!?\n]{0,5}\b(tell|ask|check with|call)\b[^.!?\n]{0,15}\b(care team|doctor|oncologist|nurse|pharmacist)\b/i
  ];
  const INSTRUCTION = /^(?:(?:just|simply|so|honestly|then|also|and|but|ok(?:ay)?)[,]?\s+)*(?:skip|miss|postpone|delay|cancel|take|stop|quit|discontinue|wean|put|do ?n['’]?t|do not|never|double|triple|increase|reduce|cut|lower|raise|halve|crush|share|borrow|lend|replace|flush)\b/i;
  const ASKS_CARE_TEAM = /\b(ask|check with|checking with|talk (to|with)|tell|call|speak (to|with))\b[^.!?\n]{0,20}\b(doctor|care team|oncologist|nurse|pharmacist)\b/i;
  const SKIPS_CARE_TEAM = /\b(without|instead of|do ?n['’]?t|do not|never|no need to)\b[^.!?\n]{0,15}\b(ask|check|talk|tell|call|speak)/i;
  // "Your oncologist may lower the dose" and "Don't skip your anti-nausea meds" are good advice.
  const CARE_TEAM_DECIDES = /\b(doctor|oncologist|care team|nurse|pharmacist)s?\b\s+(may|might|can|could|will|would|should|usually|often|sometimes)\b/i;
  const KEEP_GOING = /\b(do ?n['’]?t|do not|never|try not to)\s+(skip|miss|stop|quit|forget|delay|cancel|postpone|discontinue)\b/i;
  function givesRiskyAdvice(text) {
    return text.split(/[.!?\n]+/).some((raw) => {
      const sentence = raw.trim();
      if (!sentence) return false;
      if (!INSTRUCTION.test(sentence) && !/\byou(r|rself)?\b/i.test(sentence)) return false;
      if ((ASKS_CARE_TEAM.test(sentence) || CARE_TEAM_DECIDES.test(sentence)) && !SKIPS_CARE_TEAM.test(sentence)) return false;
      if (KEEP_GOING.test(sentence)) return false;
      return RISKY_ADVICE.some((pattern) => pattern.test(sentence));
    });
  }

  // Cyrillic and Greek letters that look like Latin ones (also used for forum names).
  const CONFUSABLE = { а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ї: "i", к: "k", м: "m", н: "h", т: "t", в: "b", ё: "e", υ: "u", ο: "o", α: "a" };

  /*
   * True for the word "fever", or a temperature of 100.4°F / 38°C or higher:
   * "101.2", "38.5 C", "temp of 100.6". A bare number needs a unit or a nearby
   * "temp"/"temperature", so "I slept 100 hours" doesn't count.
   */
  function mentionsFever(rawText) {
    // "No fever" and "fever-free" don't count; a reading later in the same post still does.
    const text = String(rawText).replace(/\b(no|without( a)?|not (running )?a|never had a)\s+(fever|temp|temperature)\b|\bfever[- ]free\b/gi, " ");
    // "fever" and its common typos ("fevr", "feever"), "febrile", and feeling hot with chills.
    if (/\bfe+ve?r(s|ish)?\b|\bfebrile\b|\bburning up\b|\brigou?rs\b/i.test(text)) return true;
    if (/\b(chills|shivering|shaking)\b/i.test(text) && /\b(chemo|chemotherapy|infusion|treatment)\b/i.test(text) && !/\bno (chills|shivering)\b/i.test(text)) return true;
    // Readings in words: "thirty eight degrees", "one hundred and one".
    if (/\b(thirty[- ]?(eight|nine)|forty) degrees\b/i.test(text)) return true;
    if (/\b(temp\w*|thermometer)\b[^.!?\n]{0,25}\b(thirty[- ]?(eight|nine)|one hundred( and)? (one|two|three|four|five))\b/i.test(text)) return true;
    // A weather report ("The forecast is 101 F today") isn't a body temperature.
    const weather = /\b(forecast|weather|outside|heat ?wave)\b/i.test(text) && !/\b(my|a|i have a|running a) (temp|temperature|fever)\b/i.test(text);
    // "Running a temperature" means a fever, unless a normal reading follows ("a temperature of 98.6" is checked below).
    if (/\b(running|run|ran|have|had|got|spik(e|ed|ing)) (a )?(high |slight |bit of a )?(temp|temperature)\b(?!\s*(of|at|was|is|reading)?\s*\d)/i.test(text)) return true;
    if (/\btemp(erature)? spike\b/i.test(text)) return true;
    if (weather) return false;
    // "38.5", "38,5 C", "100.45°F", "38.2 Celsius", "temperture 38.5", "thermometer says 101.2".
    const reading = /(\b(temp\w*|thermometer|reads|reading)\b[^.\d]{0,20})?\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(°|º|degrees?\b|deg\b)?\s*(celsius|centigrade|fahrenheit|[fc])?\b/gi;
    let match;
    while ((match = reading.exec(text))) {
      const value = parseFloat(match[3].replace(",", "."));
      const unit = (match[5] || "").toLowerCase().charAt(0);
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

  return { review, isValidSourceUrl, mentionsFever, normalize, CONFUSABLE };
})();
