(() => {
  const view = document.createElement('section');
  view.id = 'experience-view';
  view.hidden = true;
  document.body.append(view);

  const launch = document.createElement('button');
  launch.className = 'launch-experience';
  launch.textContent = 'Explore six worlds →';
  document.body.append(launch);

  const games = [
    ['lumen', 'Lumen Garden', 'Working memory', '✿'],
    ['starling', 'Starling Observatory', 'Processing speed', '✧'],
    ['cloudpath', 'Cloudpath Cartographer', 'Planning', '⌁'],
    ['echo', 'Story Echo', 'Verbal memory', '☷'],
    ['rhythm', 'Finger Rhythm', 'Hand coordination', '◉'],
    ['signal', 'Signal Match', 'Mental flexibility', '◇']
  ];

  function close() {
    view.hidden = true;
    document.body.style.overflow = '';
    launch.focus();
  }

  function library() {
    view.innerHTML = `<nav class="experience-nav"><b>✣ chemoasis</b><button class="return-home" id="home">← Return home</button></nav>
      <header class="experience-hero atlas"><div><p class="eyebrow">The Quiet Atlas</p><h2>Six worlds,<br><em>your pace.</em></h2></div><p>Short games inspired by tasks used in research with people after cancer treatment. Start gentle, or switch on a challenge that adapts as you improve. Research results so far are mixed, and these games haven't been studied themselves.</p></header>
      <section class="experience-section"><p class="eyebrow">Featured worlds</p><div class="activity-grid">${games.map(([id, name, area, icon]) => `<article class="activity-card atlas-card ${id}"><button data-game="${id}" aria-label="Play ${name}"></button><i class="activity-icon">${icon}</i><span class="activity-area">${area}</span><h4>${name}</h4><p>A few minutes · pause any time</p></article>`).join('')}</div></section>`;
    view.querySelector('#home').onclick = close;
  }

  launch.onclick = () => {
    view.hidden = false;
    document.body.style.overflow = 'hidden';
    library();
  };
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !view.hidden) close();
  });
})();
