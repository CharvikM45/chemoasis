/*
 * The 10-question onboarding questionnaire. Data only, no page code, so the
 * recommender tests (and later the React Native app) can load it as is.
 *
 * Every question can be skipped. Options with `when` only show for some ages.
 */
window.Account = window.Account || {};

Account.questions = (function () {
  const isMinor = (a) => a.age === "u13" || a.age === "13-17";
  const isAdult = (a) => Boolean(a.age) && !isMinor(a);

  const QUESTIONS = [
    {
      id: "age",
      part: 1,
      type: "single",
      title: "What is your age?",
      options: [
        { id: "u13", label: "Under 13" },
        { id: "13-17", label: "13 to 17" },
        { id: "18-29", label: "18 to 29" },
        { id: "30-44", label: "30 to 44" },
        { id: "45-59", label: "45 to 59" },
        { id: "60-74", label: "60 to 74" },
        { id: "75+", label: "75+" }
      ]
    },
    {
      id: "cancer",
      part: 1,
      type: "single",
      title: "What type of cancer is your treatment for?",
      options: [
        { id: "breast", label: "Breast" },
        { id: "blood", label: "Blood (leukemia, lymphoma, myeloma)" },
        { id: "brain", label: "Brain or spinal cord" },
        { id: "sarcoma", label: "Bone or soft tissue (sarcoma)" },
        { id: "colorectal", label: "Colorectal" },
        { id: "lung", label: "Lung" },
        { id: "gyn", label: "Ovarian or gynecologic" },
        { id: "other", label: "Other" },
        { id: "no-say", label: "Prefer not to say" }
      ]
    },
    {
      id: "drugs",
      part: 1,
      type: "multi",
      title: "Which chemotherapy drugs have you received?",
      help: "Select all that apply.",
      exclusive: ["unsure"],
      options: [
        { id: "platinum", label: "Platinum-based (cisplatin, oxaliplatin, carboplatin)" },
        { id: "taxane", label: "Taxanes (paclitaxel, docetaxel)" },
        { id: "anthracycline", label: "Anthracyclines (doxorubicin)" },
        { id: "vinca", label: "Vinca alkaloids (vincristine)" },
        { id: "methotrexate", label: "Methotrexate" },
        { id: "unsure", label: "Not sure" },
        { id: "other", label: "Other" }
      ]
    },
    {
      id: "status",
      part: 1,
      type: "single",
      title: "What is your current treatment status?",
      options: [
        { id: "active", label: "Currently in chemo" },
        { id: "lt6m", label: "Finished within the last 6 months" },
        { id: "6-12m", label: "Finished 6 to 12 months ago" },
        { id: "gt1y", label: "Finished over a year ago" },
        { id: "maintenance", label: "On maintenance or hormone therapy" }
      ]
    },
    {
      id: "diagnoses",
      part: 1,
      type: "multi",
      title: "Has a doctor told you that you have any of the following?",
      help: "Select all that apply.",
      exclusive: ["none", "unsure"],
      options: [
        { id: "anemia", label: "Anemia (low red blood cells)" },
        { id: "neuropathy", label: "Peripheral neuropathy" },
        { id: "thyroid", label: "Thyroid issues" },
        { id: "b12d", label: "Low vitamin B12 or D" },
        { id: "growth", label: "Growth or development concerns", when: (a) => !isAdult(a) },
        { id: "hormone", label: "Hormone changes from treatment, e.g., early menopause, low testosterone", when: (a) => !isMinor(a) },
        { id: "none", label: "None" },
        { id: "unsure", label: "Not sure" }
      ]
    },
    {
      id: "meds",
      part: 1,
      type: "multi",
      title: "Are you currently taking any medications that can affect focus or energy?",
      help: "Select all that apply.",
      exclusive: ["none", "unsure"],
      options: [
        { id: "pain", label: "Pain medication" },
        { id: "nausea", label: "Anti-nausea medication" },
        { id: "sleep", label: "Sleep aids" },
        { id: "steroids", label: "Steroids" },
        { id: "mood", label: "Antidepressants or anti-anxiety medication" },
        { id: "none", label: "None" },
        { id: "unsure", label: "Not sure" }
      ]
    },
    {
      id: "sleepEnergy",
      part: 1,
      type: "sleepEnergy",
      title: "How are your sleep and energy on a typical day?",
      sleep: [
        { id: "lt5", label: "Under 5 hours" },
        { id: "5-7", label: "5 to 7" },
        { id: "7-9", label: "7 to 9" },
        { id: "gt9", label: "Over 9" }
      ],
      energy: [
        { id: 1, label: "1", hint: "Exhausted" },
        { id: 2, label: "2" },
        { id: 3, label: "3" },
        { id: 4, label: "4" },
        { id: 5, label: "5", hint: "Normal for me" }
      ]
    },
    {
      id: "rankCog",
      part: 2,
      type: "rank",
      title: "Rank these thinking and memory symptoms from most to least bothersome.",
      help: "Tap them in order, starting with the one that bothers you most. You can leave out any that don't bother you.",
      options: [
        { id: "memory", label: "Forgetting recent conversations or events" },
        { id: "words", label: "Trouble finding words" },
        { id: "focus", label: "Difficulty concentrating" },
        { id: "speed", label: "Slower thinking or processing" },
        { id: "planning", label: "Losing track of tasks halfway through" }
      ]
    },
    {
      id: "rankPhys",
      part: 2,
      type: "rank",
      title: "Rank these physical symptoms from most to least bothersome.",
      help: "Tap them in order, starting with the one that bothers you most. You can leave out any that don't bother you.",
      options: [
        { id: "numb", label: "Numbness or tingling in hands or feet" },
        { id: "grip", label: "Weak grip or trouble with small objects" },
        { id: "balance", label: "Poor balance or coordination" },
        { id: "fatigue", label: "Muscle weakness or fatigue" },
        { id: "reaction", label: "Slower reaction time" }
      ]
    },
    {
      id: "rankLife",
      part: 2,
      type: "rank",
      title: "Rank which areas of daily life are most affected right now.",
      help: "Tap them in order, starting with the most affected. You can leave out any that aren't affected.",
      options: [
        { id: "school", label: "School", when: isMinor },
        { id: "homework", label: "Homework and studying", when: isMinor },
        { id: "sports", label: "Sports or physical activities", when: isMinor },
        { id: "work", label: "Work or school", when: (a) => !isMinor(a) },
        { id: "household", label: "Household tasks", when: (a) => !isMinor(a) },
        { id: "driving", label: "Driving or getting around", when: (a) => !isMinor(a) },
        { id: "hobbies", label: "Hobbies and things I enjoy" },
        { id: "social", label: "Friends and social life", when: isMinor },
        { id: "relationships", label: "Relationships and social life", when: (a) => !isMinor(a) }
      ]
    }
  ];

  const PARTS = {
    1: { name: "Treatment and health background", note: "These help us suggest gentler or shorter games when treatment may affect your energy or hands. Skip anything you'd rather not answer." },
    2: { name: "Your most troubling symptoms", note: "This part matters most for your suggestions." }
  };

  // Options that apply to this person's age. Unanswered age shows everything that isn't age-specific.
  function optionsFor(question, answers) {
    const a = answers || {};
    return (question.options || []).filter((o) => !o.when || o.when(a));
  }

  // Drops answers that no longer apply, e.g. after someone changes their age.
  function clean(answers) {
    const a = Object.assign({}, answers);
    for (const q of QUESTIONS) {
      if (!q.options) continue;
      const valid = new Set(optionsFor(q, a).map((o) => o.id));
      if (q.type === "single" && a[q.id] && !valid.has(a[q.id])) a[q.id] = null;
      if ((q.type === "multi" || q.type === "rank") && Array.isArray(a[q.id])) a[q.id] = a[q.id].filter((id) => valid.has(id));
    }
    return a;
  }

  function label(questionId, optionId) {
    const q = QUESTIONS.find((x) => x.id === questionId);
    const o = q && q.options && q.options.find((x) => x.id === optionId);
    return o ? o.label : optionId;
  }

  return { QUESTIONS, PARTS, optionsFor, clean, label, isMinor };
})();
