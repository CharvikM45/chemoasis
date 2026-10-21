# Sign in, questionnaire and starting games

Feature one from the concept brief: sign in, answer 10 questions, get 3 starting games in order of priority, each with the reasons it was suggested.

Open `account/index.html` (or `/account/` once deployed). The home page links to it as **Your games**.

## How it flows

1. **Sign in or create an account.** New accounts go straight to the questionnaire.
2. **10 questions,** one per screen. Every question can be skipped. Part 1 is treatment background, Part 2 is ranking symptoms by tapping them in order (no dragging). Age changes which options show (for example, school options for under-18s).
3. **Three starting games,** ranked, each with "Why this is suggested", safety notes where relevant, **Play** and **Not for me**.

## The recommender (`assets/js/recommender.js`)

A small, explainable learning model that runs in the browser:

- **Features** come from the answers (ranked symptoms weigh the most), plus app context: community topics from the forum (`Forum.store.topicSignals`, counts only), the person's own forum posts if they turn that on, and their play history.
- **Each game has a linear model.** Starting weights are hand-set from what each answer means, e.g. "trouble finding words" → Story Echo, hand numbness or platinum/taxane/vinca chemo → Finger Rhythm, low energy → away from longer games.
- **It learns per person** with online logistic regression: playing a game is a positive example, "Not for me" a negative one (and hides that game for 7 days). Learned weights are bounded and slowly decay back toward the starting weights.
- **The top 3 are kept varied,** so it doesn't suggest three memory games.
- The score means "fits your answers and choices." It is never shown, and never described as a chance of medical benefit.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page: sign in, questionnaire, results |
| `assets/js/questions.js` | The 10 questions and age rules (data only) |
| `assets/js/recommender.js` | Features, model, learning, ranking, reasons (no page code) |
| `assets/js/context.js` | Gathers forum and play context |
| `assets/js/auth.js` | Demo accounts and per-person storage. Swap the function bodies for Supabase later |
| `assets/js/app.js` | Page logic |
| `../home/assets/js/account-link.js` | `?play=<game>` deep links and logging plays from the home page |
| `tests/recommender.test.js` | `node account/tests/recommender.test.js`, 19 checks, no installs |

## Before launch

- **Real sign-in and storage** (Supabase). Today accounts live only in the browser and the password hashing is demo-grade.
- **Clinical review** of the questions and starting weights. The concept brief says not to ask for detailed treatment history "unless a clear, reviewed need exists"; Part 1 does ask, so it needs that review.
- **Under-13 users** need a parental-consent plan (for example COPPA in the US) before real accounts.
- **Linking accounts to the forum.** "Use my own forum posts" reads the forum's current demo account until real accounts connect the two.
