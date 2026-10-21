/*
 * Made-up demo data for the forum. Every person, post and report here is fictional.
 * Never replace this with real people's posts or health information.
 */
window.Forum = window.Forum || {};

Forum.seed = function () {
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();
  const daysAgo = (d) => hoursAgo(d * 24);

  const profiles = [
    {
      id: "u-river",
      displayName: "River (demo)",
      type: "member",
      bio: "Here mostly for the puzzle games on slower days.",
      showBio: true,
      createdAt: daysAgo(40)
    },
    {
      id: "u-alex",
      displayName: "Alex (demo)",
      type: "member",
      bio: "",
      showBio: false,
      createdAt: daysAgo(3)
    },
    {
      id: "u-june",
      displayName: "June (demo)",
      type: "member",
      bio: "I like short activities I can do sitting down.",
      showBio: true,
      createdAt: daysAgo(25)
    },
    {
      id: "u-sam",
      displayName: "Sam (demo creator)",
      type: "creator",
      bio: "I design calm puzzle activities for the library. Creator status is not a medical qualification.",
      showBio: true,
      createdAt: daysAgo(60)
    },
    {
      id: "u-nurse",
      displayName: "Demo Oncology Nurse",
      type: "professional",
      bio: "Demo profile used to show how verified professionals appear.",
      showBio: true,
      professional: {
        verified: true,
        credential: "Registered Nurse (demo, not a real credential)",
        specialty: "Oncology nursing",
        location: "Georgia, US"
      },
      createdAt: daysAgo(50)
    },
    {
      id: "u-jordan",
      displayName: "Jordan (demo)",
      type: "member",
      bio: "",
      showBio: false,
      createdAt: daysAgo(1)
    },
    {
      id: "u-mod",
      displayName: "Moderator (demo)",
      type: "moderator",
      bio: "Keeps the community safe and kind.",
      showBio: true,
      createdAt: daysAgo(90)
    }
  ];

  const threads = [
    {
      id: "t-hello",
      categoryId: "welcome",
      authorId: "u-alex",
      title: "Hi from a new member",
      body: "Hi everyone. I just found Chemoasis and wanted to say hello. I'm mostly looking for short activities for low-energy days.",
      label: "experience",
      gameIds: [],
      createdAt: daysAgo(3)
    },
    {
      id: "t-pair-match",
      categoryId: "games",
      authorId: "u-river",
      title: "Pair Match on the easiest level was a gentle start",
      body: "I tried Pair Match on the easiest setting with the larger text turned on. It took about five minutes and felt calm, not stressful. Has anyone tried the next level up?",
      label: "experience",
      gameIds: ["placeholder-pair-match"],
      createdAt: daysAgo(2)
    },
    {
      id: "t-notebook",
      categoryId: "experiences",
      authorId: "u-june",
      title: "Writing the day's plan down first thing",
      body: "Writing my plans down in the morning helps me feel less scattered. I'm not saying it works for everyone, just sharing what I do. What small habits help you?",
      label: "experience",
      gameIds: [],
      createdAt: daysAgo(5)
    },
    {
      id: "t-foggy",
      categoryId: "ask-a-professional",
      authorId: "u-alex",
      title: "Is it common to feel foggy some days and fine on others?",
      body: "Some days my focus feels fine and other days it really doesn't. Is that something other people notice too?",
      label: "experience",
      gameIds: [],
      createdAt: daysAgo(1.5)
    },
    {
      id: "t-quick-tap",
      categoryId: "games",
      authorId: "u-river",
      title: "Quick Tap feels too fast for me",
      body: "Is there a way to slow Quick Tap down? Even the first level moves faster than I'm comfortable with.",
      label: "experience",
      gameIds: ["placeholder-quick-tap"],
      createdAt: hoursAgo(20)
    },
    {
      id: "t-seated",
      categoryId: "ideas",
      authorId: "u-june",
      title: "Idea: a seated version of every movement activity",
      body: "It would help if every movement activity had a seated option, like Seated Stretch Flow does. Some days standing up for long isn't realistic.",
      label: "experience",
      gameIds: ["placeholder-seated-stretch"],
      createdAt: daysAgo(4)
    },
    {
      id: "t-change-answers",
      categoryId: "app-help",
      authorId: "u-alex",
      title: "How do I change my questionnaire answers?",
      body: "I answered the questions quickly when I signed up. Can I change them later?",
      label: "experience",
      gameIds: [],
      createdAt: hoursAgo(30)
    },
    {
      // Held automatically by the safety check, so only moderators see it.
      id: "t-held",
      categoryId: "games",
      authorId: "u-jordan",
      title: "This game cured my brain fog",
      body: "Spot the Change cured my brain fog completely. You can stop going to your doctor about it, just play this every day.",
      label: "experience",
      gameIds: ["placeholder-spot-the-change"],
      status: "pending",
      createdAt: hoursAgo(3)
    }
  ];

  const replies = [
    {
      id: "r-hello-1",
      threadId: "t-hello",
      authorId: "u-june",
      body: "Welcome! The games with a seated option have been my go-to on low-energy days.",
      label: "experience",
      createdAt: daysAgo(2.8)
    },
    {
      id: "r-hello-2",
      threadId: "t-hello",
      authorId: "u-mod",
      body: "Welcome, Alex. The community guidelines are linked at the top of every page if you'd like a quick read.",
      label: "info",
      createdAt: daysAgo(2.7)
    },
    {
      id: "r-pair-1",
      threadId: "t-pair-match",
      authorId: "u-june",
      body: "Same for me. I moved up a level after a week and it was still manageable.",
      label: "experience",
      createdAt: daysAgo(1.5)
    },
    {
      id: "r-notebook-1",
      threadId: "t-notebook",
      authorId: "u-river",
      body: "I set phone reminders for anything with a time attached. It means one less thing to hold in my head.",
      label: "experience",
      createdAt: daysAgo(4)
    },
    {
      id: "r-foggy-1",
      threadId: "t-foggy",
      authorId: "u-nurse",
      body: "Many people describe memory and concentration that changes from day to day during or after cancer treatment, and experiences vary. The National Cancer Institute has a plain-language page on it. If anything is new, severe or getting worse, please bring it to your care team, since they know your situation.",
      label: "professional",
      sourceUrl: "https://www.cancer.gov/about-cancer/treatment/side-effects/memory",
      createdAt: daysAgo(1)
    },
    {
      id: "r-quick-tap-1",
      threadId: "t-quick-tap",
      authorId: "u-sam",
      body: "Thanks for saying so. A slower starting speed is a fair request, and I've passed it on to the library team.",
      label: "experience",
      createdAt: hoursAgo(15)
    },
    {
      id: "r-quick-tap-2",
      threadId: "t-quick-tap",
      authorId: "u-jordan",
      body: "Buy my focus supplement at the link in my profile, 50% off today only!!",
      label: "experience",
      createdAt: hoursAgo(10)
    },
    {
      id: "r-change-answers-1",
      threadId: "t-change-answers",
      authorId: "u-mod",
      body: "Yes. The plan is that you can update your questionnaire answers at any time, and your recommendations will update too. That part of the app is still being built.",
      label: "info",
      createdAt: hoursAgo(26)
    }
  ];

  const reports = [
    {
      id: "rep-1",
      targetType: "thread",
      targetId: "t-held",
      reporterId: "system",
      reason: "unsafe-medical",
      note: "Held automatically: the post may tell people to skip medical care.",
      status: "open",
      createdAt: hoursAgo(3)
    },
    {
      id: "rep-2",
      targetType: "reply",
      targetId: "r-quick-tap-2",
      reporterId: "u-river",
      reason: "spam",
      note: "Advertising a supplement.",
      status: "open",
      createdAt: hoursAgo(9)
    }
  ];

  const helpful = {
    "t-pair-match": ["u-june", "u-alex"],
    "t-notebook": ["u-river", "u-alex", "u-sam"],
    "r-foggy-1": ["u-alex", "u-river", "u-june"],
    "r-hello-1": ["u-alex"]
  };

  return {
    version: 1,
    currentUserId: "u-river",
    profiles,
    threads: threads.map((t) => Object.assign({ status: "visible", anonymous: false }, t)),
    replies: replies.map((r) => Object.assign({ status: "visible", anonymous: false }, r)),
    reports,
    helpful,
    settings: {}
  };
};
