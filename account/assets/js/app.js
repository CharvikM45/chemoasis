/* Sign in → 10-question questionnaire → three starting games. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const { QUESTIONS, PARTS, optionsFor, clean } = Account.questions;
  const R = Account.recommender;
  const auth = Account.auth;
  const TINT = { lumen: '#e9dcf3', starling: '#dce5f2', cloudpath: '#e2ebee', echo: '#f4e3c6', rhythm: '#dfe8d2', signal: '#f0dff6' };
  const VIEWS = ['signinView', 'introView', 'questionView', 'resultsView'];

  let user = null;
  let data = null;
  let answers = {};
  let qIndex = 0;
  let mode = 'create';

  function show(id) {
    for (const v of VIEWS) $(v).hidden = v !== id;
    window.scrollTo(0, 0);
  }

  const save = async (patch) => { data = await auth.saveData(patch); return data; };

  /* ---------- Sign in ---------- */

  function setMode(next) {
    mode = next;
    $('tabCreate').setAttribute('aria-selected', String(mode === 'create'));
    $('tabSignin').setAttribute('aria-selected', String(mode === 'signin'));
    $('nameField').hidden = mode !== 'create';
    $('passwordHint').hidden = mode !== 'create';
    $('authSubmit').textContent = mode === 'create' ? 'Create account' : 'Sign in';
    $('authForm').password.setAttribute('autocomplete', mode === 'create' ? 'new-password' : 'current-password');
    $('authError').textContent = '';
  }

  $('tabCreate').addEventListener('click', () => setMode('create'));
  $('tabSignin').addEventListener('click', () => setMode('signin'));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = $('authSubmit');
    btn.disabled = true;
    $('authError').textContent = '';
    try {
      const fields = { name: form.name.value, email: form.email.value, password: form.password.value };
      if (mode === 'create') await auth.createAccount(fields);
      else await auth.signIn(fields);
      form.reset();
      await afterSignIn();
    } catch (err) {
      $('authError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  async function afterSignIn() {
    user = await auth.currentUser();
    data = await auth.getData();
    answers = data.answers || {};
    $('who').hidden = false;
    $('whoName').textContent = user.name;
    // New accounts go straight to the questionnaire.
    if (!data.completedAt && !data.skippedAt) show('introView');
    else await renderResults();
  }

  async function signOut() {
    await auth.signOut();
    user = null;
    data = null;
    answers = {};
    $('who').hidden = true;
    setMode('signin');
    show('signinView');
  }
  $('signOutTop').addEventListener('click', signOut);

  /* ---------- Questionnaire ---------- */

  $('startQuiz').addEventListener('click', () => { qIndex = 0; show('questionView'); renderQuestion(); });
  $('skipQuiz').addEventListener('click', async () => { await save({ skippedAt: new Date().toISOString() }); await renderResults(); });

  function optionButton(opt, role, checked, extraClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'option ' + (extraClass || '');
    b.setAttribute('role', role);
    b.setAttribute(role === 'button' ? 'aria-pressed' : 'aria-checked', String(checked));
    b.innerHTML = '<span class="mark" aria-hidden="true"></span><span class="label"></span>';
    b.querySelector('.label').textContent = opt.label;
    return b;
  }

  function singleGroup(options, value, onPick, labelledBy) {
    const box = document.createElement('div');
    box.className = 'options';
    box.setAttribute('role', 'radiogroup');
    if (labelledBy) box.setAttribute('aria-labelledby', labelledBy);
    for (const opt of options) {
      const b = optionButton(opt, 'radio', value === opt.id);
      if (opt.hint) b.insertAdjacentHTML('beforeend', `<small>${opt.hint}</small>`);
      b.addEventListener('click', () => {
        onPick(opt.id);
        for (const c of box.children) c.setAttribute('aria-checked', String(c === b));
      });
      box.appendChild(b);
    }
    return box;
  }

  function renderQuestion() {
    const q = QUESTIONS[qIndex];
    const total = QUESTIONS.length;
    $('qPart').textContent = `Part ${q.part} · ${PARTS[q.part].name}`;
    $('qCount').textContent = `Question ${qIndex + 1} of ${total}`;
    $('qBar').style.width = `${(qIndex / total) * 100}%`;
    const firstOfPart = qIndex === 0 || QUESTIONS[qIndex - 1].part !== q.part;
    $('qPartNote').hidden = !firstOfPart;
    $('qPartNote').textContent = PARTS[q.part].note;
    $('qTitle').textContent = q.title;
    $('qHelp').textContent = q.help || (q.type === 'single' ? 'Choose one.' : '');
    $('qNext').textContent = qIndex === total - 1 ? 'See my games' : 'Next';

    const body = $('qBody');
    body.innerHTML = '';

    if (q.type === 'single') {
      body.appendChild(singleGroup(optionsFor(q, answers), answers[q.id], (id) => { answers[q.id] = id; updateNote(q); }, 'qTitle'));
    }

    if (q.type === 'multi') {
      const box = document.createElement('div');
      box.className = 'options';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-labelledby', 'qTitle');
      const opts = optionsFor(q, answers);
      const paint = () => {
        const chosen = answers[q.id] || [];
        [...box.children].forEach((b, i) => b.setAttribute('aria-checked', String(chosen.includes(opts[i].id))));
      };
      for (const opt of opts) {
        const b = optionButton(opt, 'checkbox', false, 'multi');
        b.addEventListener('click', () => {
          let chosen = (answers[q.id] || []).slice();
          if (chosen.includes(opt.id)) chosen = chosen.filter((id) => id !== opt.id);
          else if ((q.exclusive || []).includes(opt.id)) chosen = [opt.id];
          else chosen = chosen.filter((id) => !(q.exclusive || []).includes(id)).concat(opt.id);
          answers[q.id] = chosen;
          paint();
        });
        box.appendChild(b);
      }
      body.appendChild(box);
      paint();
    }

    if (q.type === 'sleepEnergy') {
      body.insertAdjacentHTML('beforeend', '<p class="sub-q" id="sleepLabel">Sleep on a typical night</p>');
      body.appendChild(singleGroup(q.sleep, answers.sleep, (id) => { answers.sleep = id; }, 'sleepLabel'));
      body.insertAdjacentHTML('beforeend', '<p class="sub-q" id="energyLabel">Energy on a typical day, from 1 (exhausted) to 5 (normal for me)</p>');
      const energy = singleGroup(q.energy, answers.energy, (id) => { answers.energy = id; }, 'energyLabel');
      energy.className = 'options energy';
      body.appendChild(energy);
    }

    if (q.type === 'rank') {
      const box = document.createElement('div');
      box.className = 'options rank-list';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-labelledby', 'qTitle');
      const opts = optionsFor(q, answers);
      const paint = () => {
        const order = answers[q.id] || [];
        [...box.children].forEach((b, i) => {
          const pos = order.indexOf(opts[i].id) + 1;
          b.setAttribute('aria-pressed', String(pos > 0));
          b.querySelector('.mark').textContent = pos || '';
          b.setAttribute('aria-label', opts[i].label + (pos ? `, ranked ${pos}` : ', not ranked'));
        });
      };
      for (const opt of opts) {
        const b = optionButton(opt, 'button', false, 'rank');
        b.addEventListener('click', () => {
          const order = (answers[q.id] || []).slice();
          const at = order.indexOf(opt.id);
          if (at >= 0) order.splice(at, 1);
          else order.push(opt.id);
          answers[q.id] = order;
          paint();
        });
        box.appendChild(b);
      }
      body.appendChild(box);
      const tools = document.createElement('div');
      tools.className = 'rank-tools';
      tools.innerHTML = '<button type="button" class="link-btn">Start this ranking over</button>';
      tools.firstChild.addEventListener('click', () => { answers[q.id] = []; paint(); });
      body.appendChild(tools);
      paint();
    }

    updateNote(q);
    $('qTitle').focus();
  }

  function updateNote(q) {
    const note = $('qNote');
    note.hidden = !(q.id === 'age' && answers.age === 'u13');
    note.textContent = 'If you are under 13, please answer these questions with a parent or guardian.';
  }

  async function step(delta, skip) {
    const q = QUESTIONS[qIndex];
    if (skip) {
      if (q.type === 'sleepEnergy') { answers.sleep = null; answers.energy = null; }
      else answers[q.id] = q.type === 'single' ? null : [];
    }
    answers = clean(answers);
    await save({ answers });
    if (delta > 0 && qIndex === QUESTIONS.length - 1) {
      await save({ completedAt: new Date().toISOString(), skippedAt: null });
      await renderResults();
      return;
    }
    if (delta < 0 && qIndex === 0) { show('introView'); return; }
    qIndex += delta;
    renderQuestion();
  }
  $('qNext').addEventListener('click', () => step(1));
  $('qSkip').addEventListener('click', () => step(1, true));
  $('qBack').addEventListener('click', () => step(-1));

  /* ---------- Recommendations ---------- */

  const answeredCount = () => QUESTIONS.filter((q) => {
    if (q.type === 'sleepEnergy') return answers.sleep || answers.energy;
    const v = answers[q.id];
    return Array.isArray(v) ? v.length : Boolean(v);
  }).length;

  async function renderResults(statusText) {
    data = await auth.getData();
    answers = data.answers || {};
    const ctx = await Account.context.gather(data);
    const model = data.model || R.newModel();
    R.train(model, answers, ctx);
    await save({ model });
    const result = R.recommend(answers, ctx, model);

    $('hello').textContent = `Hi, ${user.name}`;
    const answered = answeredCount();
    const lede = document.querySelector('.results-head .lede');
    lede.textContent = answered
      ? 'In order of priority, based on your answers and how you use Reframe. Start with the first, or whichever feels right today.'
      : 'You skipped the questions, so these are gentle starters for anyone. Answer them any time for suggestions that fit you better.';

    const heard = $('heard');
    heard.innerHTML = '';
    for (const text of result.heard) {
      const s = document.createElement('span');
      s.textContent = text;
      heard.appendChild(s);
    }

    const list = $('picks');
    list.innerHTML = '';
    for (const pick of result.picks) {
      const li = document.createElement('li');
      li.className = 'pick';
      li.style.setProperty('--tint', TINT[pick.game.id] || '#efe5d9');
      li.innerHTML = `
        <div class="pick-rank" aria-hidden="true"><b>${pick.rank}</b>${pick.game.icon}</div>
        <div class="pick-body">
          <p class="pick-area"></p>
          <h3></h3>
          <p class="pick-blurb"></p>
          <p class="why-title">Why this is suggested</p>
          <ul class="why"></ul>
          <div class="pick-notes"></div>
          <div class="pick-actions">
            <button class="primary" data-play>Play ${pick.game.name}</button>
            <button class="ghost" data-skip>Not for me</button>
          </div>
        </div>`;
      li.querySelector('.pick-area').textContent = `${ordinalWord(pick.rank)} · ${pick.game.area}`;
      li.querySelector('h3').textContent = pick.game.name;
      li.querySelector('.pick-blurb').textContent = pick.game.blurb;
      for (const r of pick.reasons) {
        const item = document.createElement('li');
        item.textContent = r;
        li.querySelector('.why').appendChild(item);
      }
      for (const n of pick.notes) {
        const p = document.createElement('p');
        p.className = 'pick-note';
        p.textContent = n;
        li.querySelector('.pick-notes').appendChild(p);
      }
      li.querySelector('[data-play]').addEventListener('click', () => play(pick.game.id));
      li.querySelector('[data-skip]').addEventListener('click', () => notForMe(pick.game));
      list.appendChild(li);
    }

    const notes = $('globalNotes');
    notes.innerHTML = '';
    for (const n of result.notes) {
      const p = document.createElement('p');
      p.textContent = n;
      notes.appendChild(p);
    }

    renderSignals(ctx, model, answered);
    $('resultsStatus').textContent = statusText || '';
    show('resultsView');
  }

  const ordinalWord = (n) => ['First', 'Second', 'Third'][n - 1] || `#${n}`;

  function renderSignals(ctx, model, answered) {
    const plays = model.events.filter((e) => e.kind === 'play').length;
    const skips = model.events.filter((e) => e.kind === 'skip').length;
    const topics = Object.keys(ctx.communityAreas).length;
    const rows = [
      [answered > 0, 'Answers', answered ? `${answered} of ${QUESTIONS.length} questions answered` : 'Questionnaire skipped'],
      [topics > 0, 'Community', topics ? 'Topics from public forum conversations in the last 30 days (counts only, no one’s posts are read)' : 'No recent community topics yet'],
      [data.useOwnPosts, 'Your posts', data.useOwnPosts ? `${ctx.ownPostCount} posts you wrote in the forum as ${ctx.forumName || 'your demo account'}` : 'Off'],
      [plays + skips > 0, 'Your choices', `${plays} game ${plays === 1 ? 'play' : 'plays'} and ${skips} “Not for me” so far. The model learns from these.`]
    ];
    const ul = $('signals');
    ul.innerHTML = '';
    for (const [on, name, text] of rows) {
      const li = document.createElement('li');
      li.innerHTML = `<b class="${on ? '' : 'off'}"></b><span></span>`;
      li.querySelector('b').textContent = name;
      li.querySelector('span').textContent = text;
      ul.appendChild(li);
    }
    $('ownPostsSwitch').setAttribute('aria-checked', String(Boolean(data.useOwnPosts)));
  }

  async function play(gameId) {
    const model = data.model || R.newModel();
    R.record(model, gameId, 'play');
    await save({ model });
    window.location.href = `../home/index.html?play=${encodeURIComponent(gameId)}`;
  }

  async function notForMe(game) {
    const model = data.model || R.newModel();
    R.record(model, game.id, 'skip');
    await save({ model });
    await renderResults(`Got it. We won't suggest ${game.name} for a while.`);
  }

  $('ownPostsSwitch').addEventListener('click', async () => {
    await save({ useOwnPosts: !data.useOwnPosts });
    await renderResults(data.useOwnPosts ? 'Now using your own forum posts.' : 'Stopped using your forum posts.');
  });
  $('editAnswers').addEventListener('click', () => { qIndex = 0; show('questionView'); renderQuestion(); });
  $('resetModel').addEventListener('click', async () => {
    await save({ model: R.newModel() });
    await renderResults('Personalization reset. Suggestions now come from your answers only.');
  });
  $('deleteAccount').addEventListener('click', async () => {
    if (!window.confirm('Delete your account, answers and play history from this browser? This can’t be undone.')) return;
    await auth.deleteAccount();
    await signOut();
    setMode('create');
  });

  /* ---------- Start ---------- */

  (async () => {
    user = await auth.currentUser();
    if (user) await afterSignIn();
    else { setMode('create'); show('signinView'); }
  })();
})();
