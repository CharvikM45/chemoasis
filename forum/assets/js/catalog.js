/*
 * Shared lists the forum uses: categories, post labels, training areas and games.
 *
 * GAMES and TRAINING_AREAS match the six games in the library (the GAMES list in
 * account/assets/js/recommender.js, same ids and areas). If a game is added or renamed
 * there, change it here too; forum/tests/forum.test.js checks that the two lists agree.
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
      // The id stays the same so older conversations keep their category. It was "Ask a
      // professional" until there's a real way to check a professional's credentials.
      id: "ask-a-professional",
      name: "Questions for the community",
      blurb: "Ask what has worked for others. Answers come from members, not medical professionals: your care team is the place for advice about you."
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
    { id: "words", name: "Words and language" },
    { id: "focus", name: "Focus and attention" },
    { id: "speed", name: "Thinking speed" },
    { id: "planning", name: "Planning and problem-solving" },
    { id: "hand", name: "Hand coordination" }
  ];

  // The six games, with the same ids as the games and the recommender.
  const GAMES = [
    { id: "lumen", name: "Lumen Garden", areas: ["memory"] },
    { id: "starling", name: "Starling Observatory", areas: ["focus"] },
    { id: "cloudpath", name: "Cloudpath Cartographer", areas: ["planning"] },
    { id: "echo", name: "Story Echo", areas: ["words", "memory"] },
    { id: "rhythm", name: "Finger Rhythm", areas: ["hand"] },
    { id: "signal", name: "Signal Match", areas: ["speed", "focus"] }
  ];

  // "support" never hides a post. It asks a moderator to check on the person who wrote it.
  const REPORT_REASONS = [
    { id: "support", name: "Someone may need support" },
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
