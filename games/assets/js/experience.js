(() => {
  const view = document.createElement('section');
  view.id = 'experience-view';
  view.hidden = true;
  document.body.append(view);

  const launch = document.createElement('button');
  launch.className = 'launch-experience';
  launch.textContent = 'Explore six worlds →';
  document.body.append(launch);

  // [id, name, area, icon, how to play in one line, has a 3D world]
  const games = [
    ['lumen', 'Lumen Garden', 'Working memory', '✿', 'Watch the flowers light up, then tap them in order.', true],
    ['starling', 'Starling Observatory', 'Processing speed', '✧', 'Spot the symbol that flashes in the middle.', true],
    ['cloudpath', 'Cloudpath Cartographer', 'Planning', '⌁', 'Move the lanterns to match the goal, in few moves.', true],
    ['echo', 'Story Echo', 'Verbal memory', '☷', 'Remember a list of words, then pick them out.'],
    ['rhythm', 'Finger Rhythm', 'Hand coordination', '◉', 'Tap the pad that lights up, with a light touch.'],
    ['signal', 'Signal Match', 'Mental flexibility', '◇', 'Sort each shape by the rule shown on top.']
  ];

  function close() {
    view.hidden = true;
    document.body.style.overflow = '';
    launch.focus();
  }

  function library() {
    // The site's own top bar stays above the library (see brain-games.css), so it has no bar of its own.
    view.innerHTML = `<header class="experience-hero atlas"><div><p class="eyebrow">The Quiet Atlas</p><h2>Six worlds,<br><em>your pace.</em></h2><button class="button" id="home">← Back to home</button></div><p>Short games for memory, focus and hand coordination, during chemo or after it. Each is inspired by tasks used in research with people after cancer treatment, though results so far are mixed and these games haven't been studied themselves. Open one to see how to play.</p></header>
      <section class="experience-section"><p class="eyebrow">Featured worlds</p><div class="activity-grid">${games.map(([id, name, area, icon, how, has3D]) => `<article class="activity-card atlas-card ${id}"><button data-game="${id}" aria-label="Play ${name}"></button><i class="activity-icon">${icon}</i><span class="activity-area">${area}</span><h4>${name}</h4><p>${how}</p><small class="activity-meta">A few minutes · pause any time${has3D ? ' · <b>2D or 3D</b>' : ''}</small></article>`).join('')}</div></section>`;
    view.querySelector('#home').onclick = close;
  }

  // The top bar's logo goes back to the top of the home page, so it closes the library too.
  document.querySelector('.nav .brand')?.addEventListener('click', () => { if (!view.hidden) close(); });

  launch.onclick = () => {
    view.hidden = false;
    document.body.style.overflow = 'hidden';
    library();
  };
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !view.hidden) close();
  });
})();
