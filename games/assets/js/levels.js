/*
 * Shared level screens for the six home-page games.
 *   GameLevels.pick({ host, game, title, kicker, levels, about, onPick, onExit })
 *     shows "Choose a level"; levels are [{ name, desc }]. Every level is open; finished ones
 *     get a tick and the first unfinished one is marked "Up next". `about` ({ text, cite, href,
 *     more }) says what the exercise practises and which research inspired it; `more` is an
 *     optional list of extra { cite, href } sources.
 *   GameLevels.done({ host, game, level, levels, message, details, onPick, onLevels, onExit, extra })
 *     records the level as finished and shows "Level N complete" with Next / Again / All levels.
 *     `details` (optional list of strings) sit behind a "Show details" toggle.
 * Progress is kept in this browser (localStorage), per game, and on the account when signed in.
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
  function complete(game, index) {
    const all = load();
    all[game] = [...new Set([...(all[game] || []), index])];
    saveAll(all);
    if (window.Account && Account.auth) Account.auth.recordLevel(game, index);
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
  function upNext(game, count) {
    const done = finished(game);
    for (let i = 0; i < count; i++) if (!done.has(i)) return i;
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

  function pick({ host, game, title, kicker, levels, about, onPick, onExit }) {
    const done = finished(game);
    const next = upNext(game, levels.length);
    const el = overlay(host, `<p class="level-kicker">${escape(kicker)}</p>
      <h2>${escape(title)}</h2>
      <p class="level-lede">Choose a level. It adjusts as you play: harder when you're doing well, easier when you're not.</p>
      ${about ? `<p class="level-about">${escape(about.text)} ${[about, ...(about.more || [])].map((s) => `<a href="${escape(s.href)}" target="_blank" rel="noreferrer">${escape(s.cite)} ↗</a>`).join(' · ')}<small>Inspired by tasks used in research. Not yet clinically reviewed, and not a treatment.</small></p>` : ''}
      <ol class="level-grid">${levels.map((level, i) => `<li><button data-level="${i}" class="${done.has(i) ? 'is-done' : ''} ${i === next ? 'is-next' : ''}">
        <span class="level-num">Level ${i + 1}</span><b>${escape(level.name)}</b><small>${escape(level.desc)}</small>
        <em>${done.has(i) ? '✓ Completed' : i === next ? 'Up next' : ''}</em></button></li>`).join('')}</ol>
      <div class="level-actions"><button data-exit>Exit game</button></div>`);
    el.querySelectorAll('[data-level]').forEach((button) => button.onclick = () => { close(host); onPick(+button.dataset.level); });
    el.querySelector('[data-exit]').onclick = () => { close(host); onExit(); };
    if (next >= 0) el.querySelector(`[data-level="${next}"]`).focus({ preventScroll: true });
  }

  function done({ host, game, level, levels, message, details = [], onPick, onLevels, onExit, extra = [] }) {
    complete(game, level);
    const hasNext = level + 1 < levels.length;
    const el = overlay(host, `<p class="level-kicker">Level ${level + 1} · ${escape(levels[level].name)}</p>
      <h2>Level ${level + 1} <em>complete.</em></h2>
      <p class="level-lede">${escape(message)}</p>
      ${details.length ? `<details class="level-details"><summary>Show details</summary><ul>${details.map((d) => `<li>${escape(d)}</li>`).join('')}</ul></details>` : ''}
      <div class="level-actions">
        ${hasNext ? `<button data-go="next" class="level-primary">Next level →</button>` : ''}
        <button data-go="again">Play again</button>
        ${extra.map((x, i) => `<button data-extra="${i}">${escape(x.label)}</button>`).join('')}
        <button data-go="levels">All levels</button>
        <button data-exit>Exit game</button>
      </div>
      ${hasNext ? '' : '<p class="level-note">You have finished every level. Play any of them again whenever you like.</p>'}`);
    const go = (fn) => () => { close(host); fn(); };
    el.querySelector('[data-go="next"]')?.addEventListener('click', go(() => onPick(level + 1)));
    el.querySelector('[data-go="again"]').onclick = go(() => onPick(level));
    el.querySelector('[data-go="levels"]').onclick = go(onLevels);
    el.querySelector('[data-exit]').onclick = go(onExit);
    el.querySelectorAll('[data-extra]').forEach((button) => button.onclick = go(extra[+button.dataset.extra].onClick));
  }

  window.GameLevels = { pick, done, close, complete, finished };
})();
