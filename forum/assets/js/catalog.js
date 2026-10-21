/*
 * Shared lists the forum uses: categories, post labels, training areas and games.
 *
 * TRAINING_AREAS follow the goals in the onboarding questionnaire (brief, question 1).
 * GAMES is a placeholder until Charvik's game library publishes its real IDs.
 * Swap in his list here and every game tag in the forum follows.
 */
window.Forum = window.Forum || {};

Forum.catalog = (function () {
  const CATEGORIES = [
    {
      id: "welcome",
      name: "Introductions",
      blurb: "Say hello and share only what you are comfortable sharing."
    },
    {
      id: "experiences",
      name: "Sharing experiences",
      blurb: "Personal stories about recovery and everyday life after treatment."
    },
    {
      id: "games",
      name: "Games and activities",
      blurb: "How activities felt: difficulty, enjoyment, accessibility and tips."
    },
    {
      id: "ask-a-professional",
      name: "Ask a professional",
      blurb: "General questions answered by verified professionals. Not personal medical advice."
    },
    {
      id: "app-help",
      name: "Using Chemoasis",
      blurb: "Questions about finding your way around the app."
    },
    {
      id: "ideas",
      name: "Ideas and feedback",
      blurb: "Suggest new activities or changes to the questionnaire and the app."
    }
  ];

  // Every post carries one label so readers can tell stories from information from guidance.
  const LABELS = [
    {
      id: "experience",
      name: "Personal experience",
      hint: "Something that happened to you. Others may experience it differently."
    },
    {
      id: "info",
      name: "General information",
      hint: "Educational information. Add a source link so others can check it."
    },
    {
      id: "professional",
      name: "Professional guidance",
      hint: "Only verified professionals can use this label. It is general guidance, not advice for one person."
    }
  ];

  const TRAINING_AREAS = [
    { id: "memory", name: "Memory" },
    { id: "focus", name: "Focus and attention" },
    { id: "speed", name: "Thinking speed" },
    { id: "planning", name: "Planning and problem-solving" },
    { id: "hand", name: "Hand coordination" },
    { id: "movement", name: "Movement and coordination" },
    { id: "balance", name: "Balance-related activities" }
  ];

  // Placeholder games. Replace with the game library's real IDs and names.
  const GAMES = [
    { id: "placeholder-pair-match", name: "Pair Match", areas: ["memory"] },
    { id: "placeholder-word-recall", name: "Word Recall", areas: ["memory"] },
    { id: "placeholder-spot-the-change", name: "Spot the Change", areas: ["focus"] },
    { id: "placeholder-quick-tap", name: "Quick Tap", areas: ["speed", "focus"] },
    { id: "placeholder-route-planner", name: "Route Planner", areas: ["planning"] },
    { id: "placeholder-trace-the-path", name: "Trace the Path", areas: ["hand"] },
    { id: "placeholder-seated-stretch", name: "Seated Stretch Flow", areas: ["movement"] },
    { id: "placeholder-steady-stance", name: "Steady Stance", areas: ["balance"] }
  ];

  const REPORT_REASONS = [
    { id: "unsafe-medical", name: "Unsafe medical claim" },
    { id: "misinformation", name: "Misinformation" },
    { id: "harassment", name: "Harassment or unkindness" },
    { id: "privacy", name: "Shares someone's private information" },
    { id: "spam", name: "Spam or advertising" },
    { id: "other", name: "Something else" }
  ];

  function byId(list, id) {
    return list.find((item) => item.id === id) || null;
  }

  return {
    CATEGORIES,
    LABELS,
    TRAINING_AREAS,
    GAMES,
    REPORT_REASONS,
    category: (id) => byId(CATEGORIES, id),
    label: (id) => byId(LABELS, id),
    area: (id) => byId(TRAINING_AREAS, id),
    game: (id) => byId(GAMES, id),
    reportReason: (id) => byId(REPORT_REASONS, id)
  };
})();
