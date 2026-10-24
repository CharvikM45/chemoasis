/*
 * Connects the home page to the account area:
 *   - ?play=<game id> opens that game (used by the "Play" buttons on recommendations)
 *   - real clicks on any game card are logged for the signed-in person's recommender
 * Runs before the game scripts (they're modules), so its listener sees clicks first.
 */
(() => {
  const GAMES = ['lumen', 'starling', 'cloudpath', 'echo', 'rhythm', 'signal'];

  window.addEventListener('click', (e) => {
    const card = e.isTrusted && e.target.closest && e.target.closest('[data-game]');
    if (card && window.Account && Account.auth) Account.auth.recordPlay(card.dataset.game);
  }, true);

  const params = new URLSearchParams(location.search);
  // ?games: open the games library (the "Games" link on other pages).
  if (params.has('games')) {
    window.addEventListener('load', () => {
      history.replaceState(null, '', location.pathname);
      const library = document.querySelector('.launch-experience');
      if (library) library.click();
    });
    return;
  }
  const id = params.get('play');
  if (!GAMES.includes(id)) return;
  window.addEventListener('load', () => {
    history.replaceState(null, '', location.pathname);
    const trigger = document.createElement('button');
    trigger.hidden = true;
    trigger.dataset.game = id;
    document.body.append(trigger);
    trigger.click(); // the game scripts listen for clicks on [data-game]
    trigger.remove();
  });
})();
