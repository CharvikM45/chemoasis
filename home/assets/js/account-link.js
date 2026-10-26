/*
 * Connects the home page to the account area:
 *   - ?play=<game id> opens that game (used by the "Play" buttons on recommendations)
 *   - ?games opens the games library
 * Plays are logged for the recommender by the games themselves (brain-games.js), once a session
 * starts, so opening a game and leaving straight away doesn't count as a play.
 */
(() => {
  const GAMES = ['lumen', 'starling', 'cloudpath', 'echo', 'rhythm', 'signal'];

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
