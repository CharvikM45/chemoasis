/*
 * Shared level screens for the six home-page games.
 *   GameLevels.pick({ host, game, title, kicker, levels, how, views, lede, note, about, onPick, onExit })
 *     shows "Choose a level"; levels are [{ name, desc }]. Every level is open; finished ones
 *     get a tick and the first unfinished one is marked "Up next". `how` (a few short lines) is
 *     the "How to play" box at the top. `views` ({ current, off, onChange }) adds the 2D / 3D
 *     choice; `off` is the reason 3D can't be picked right now ('' when it can). `note` is the
 *     one-line honesty note under the levels, and `about` ({ text, cite, href, more }) says what
 *     the exercise practises and which research inspired it, behind "About the research".
 *   GameLevels.done({ host, game, level, levels, message, details, sync, low, onPick, onLevels, onExit, extra })
 *     records the level as finished and shows "Level N complete" with Next / Again / All levels.
 *     `low: true` (a hard session) shows "Session done" instead, suggests staying on the level and
 *     doesn't tick it, so "Up next" doesn't push someone on before they're ready.
 *     `details` (optional list of strings) sit behind a "Show details" toggle. sync: false keeps
 *     the tick in this browser only (the 3D worlds, which the account doesn't track).
 *   GameLevels.howBox(lines, meta) is the "How to play" box, shared with brain-games.js so it
 *     looks the same and sits in the same place on every screen.
 * Progress is kept in this browser (localStorage), per game, and on the account when signed in.
 * Ticks are saved by a level's id: its place in the list, or for a level that moved, the place its
 * `save` name gives it (Lumen's Backwards saves as L4, so its tick is 3), the same as its bests.
 */
(() => {
  const STORE = 'reframe.levels';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) { return {}; }
  }
  function finished(game) { return new Set(load()[game] || []); }
  function saveAll(all) {
    try { localStorage.setItem(STORE, JSON.stringify(all)); } catch (_) { /* storage unavailable */ }
  }
  function complete(game, index, sync = true) {
    const all = load();
    all[game] = [...new Set([...(all[game] || []), index])];
    saveAll(all);
    if (sync && window.Account && Account.auth) Account.auth.recordLevel(game, index);
  }
  // Signed in: bring in levels finished on other devices.
  if (window.Account && Account.auth) {
    Account.auth.levels().then((remote) => {
      if (!remote) return;
      const all = load();
      for (const [game, done] of Object.entries(remote)) all[game] = [...new Set([...(all[game] || []), ...done])];
      saveAll(all);
    });
  }
  // The id a level's tick is saved under (see the note at the top).
  const idOf = (level, i) => (level && /^L\d+$/.test(level.save || '') ? +level.save.slice(1) - 1 : i);
  function upNext(game, levels) {
    const done = finished(game);
    for (let i = 0; i < levels.length; i++) if (!done.has(idOf(levels[i], i))) return i;
    return -1;
  }

  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function overlay(host, html) {
    host.querySelector(':scope > .level-screen')?.remove();
    if (document.pointerLockElement) document.exitPointerLock();
    const el = document.createElement('div');
    el.className = 'level-screen';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="level-panel">${html}</div>`;
    // Keep clicks on the screen from reaching the game underneath.
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());
    host.append(el);
    el.querySelector('button')?.focus({ preventScroll: true });
    return el;
  }
  function close(host) { host.querySelector(':scope > .level-screen')?.remove(); }

  // `lines` and `meta` are written in the game code (they may hold <b>), never typed by a player.
  function howBox(lines, meta) {
    return `<section class="howto" aria-label="How to play"><h3>How to play</h3><ol>${lines.map((l) => `<li>${l}</li>`).join('')}</ol>${meta ? `<p class="howto-meta">${meta}</p>` : ''}</section>`;
  }
  const NOTE = 'Inspired by tasks used in research. Not yet clinically reviewed, and not a treatment.';

  function pick({ host, game, title, kicker, levels, how, views, lede = 'Each level adapts as you play.', note = NOTE, about, onPick, onExit, focusView }) {
    const done = new Set([...finished(game)].filter((id) => levels.some((l, i) => idOf(l, i) === id)).map((id) => levels.findIndex((l, i) => idOf(l, i) === id)));
    const next = upNext(game, levels);
    const view = (id, name, small, off) => `<button data-view="${id}" aria-pressed="${views.current === id}" ${off ? 'disabled' : ''}><b>${name}</b><small>${small}</small></button>`;
    const sources = about ? [about, ...(about.more || [])].filter((s) => s.href) : [];
    const el = overlay(host, `<p class="level-kicker">${escape(kicker)}</p>
      <h2>${escape(title)}</h2>
      ${how ? howBox(how) : ''}
      ${views ? `<div class="level-views" role="group" aria-label="Play in 2D or 3D">
        ${view('2d', '2D board', 'Tap or click. Easiest on the hands.')}
        ${view('3d', '3D world', 'Walk around with a keyboard and mouse.', views.off)}
      </div>${views.off ? `<p class="level-view-note">${escape(views.off)}</p>` : ''}` : ''}
      <h3 class="level-heading">Choose a level <small>${escape(lede)}</small></h3>
      <ol class="level-grid">${levels.map((level, i) => `<li><button data-level="${i}" class="${done.has(i) ? 'is-done' : ''} ${i === next ? 'is-next' : ''}">
        <span class="level-num">Level ${i + 1}</span><b>${escape(level.name)}</b><small>${escape(level.desc)}</small>
        <em>${done.has(i) ? '✓ Completed' : i === next ? 'Up next' : ''}</em></button></li>`).join('')}</ol>
      <p class="level-fine">${escape(note)}</p>
      ${about ? `<details class="level-about"><summary>About the research</summary><p>${escape(about.text)}</p>${sources.length ? `<p>${sources.map((s) => `<a href="${escape(s.href)}" target="_blank" rel="noreferrer">${escape(s.cite)} ↗</a>`).join(' · ')}</p>` : ''}</details>` : ''}
      <div class="level-actions"><button data-exit>Exit game</button></div>`);
    el.querySelectorAll('[data-level]').forEach((button) => button.onclick = () => { close(host); onPick(+button.dataset.level); });
    el.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => { if (button.dataset.view !== views.current) views.onChange(button.dataset.view); });
    el.querySelector('[data-exit]').onclick = () => { close(host); onExit(); };
    if (focusView) el.querySelector(`[data-view="${views.current}"]`)?.focus({ preventScroll: true });
    else if (next >= 0) el.querySelector(`[data-level="${next}"]`).focus({ preventScroll: true });
  }

  function done({ host, game, level, levels, message, details = [], sync = true, low = false, onPick, onLevels, onExit, extra = [] }) {
    if (!low) complete(game, idOf(levels[level], level), sync);
    const hasNext = level + 1 < levels.length;
    const el = overlay(host, `<p class="level-kicker">Level ${level + 1} · ${escape(levels[level].name)}</p>
      <h2>${low ? 'Session <em>done.</em>' : `Level ${level + 1} <em>complete.</em>`}</h2>
      ${low ? '<p class="level-lede">This level felt hard today, and that’s okay. Staying on it for another session or two often helps.</p>' : ''}
      <p class="level-lede">${escape(message)}</p>
      ${details.length ? `<details class="level-details"><summary>Show details</summary><ul>${details.map((d) => `<li>${escape(d)}</li>`).join('')}</ul></details>` : ''}
      <div class="level-actions">
        ${low ? '<button data-go="again" class="level-primary">Play this level again</button>' : ''}
        ${hasNext ? `<button data-go="next"${low ? '' : ' class="level-primary"'}>Next level →</button>` : ''}
        ${low ? '' : '<button data-go="again">Play again</button>'}
        ${extra.map((x, i) => `<button data-extra="${i}">${escape(x.label)}</button>`).join('')}
        <button data-go="levels">All levels</button>
        <button data-exit>Exit game</button>
      </div>
      ${hasNext || low ? '' : '<p class="level-note">You have finished every level. Play any of them again whenever you like.</p>'}`);
    const go = (fn) => () => { close(host); fn(); };
    el.querySelector('[data-go="next"]')?.addEventListener('click', go(() => onPick(level + 1)));
    el.querySelector('[data-go="again"]').onclick = go(() => onPick(level));
    el.querySelector('[data-go="levels"]').onclick = go(onLevels);
    el.querySelector('[data-exit]').onclick = go(onExit);
    el.querySelectorAll('[data-extra]').forEach((button) => button.onclick = go(extra[+button.dataset.extra].onClick));
  }

  window.GameLevels = { pick, done, close, complete, finished, howBox, idOf };
})();
