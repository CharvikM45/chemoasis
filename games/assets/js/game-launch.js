(() => {
  const launch = document.querySelector('.launch-experience');
  if (!launch) return;
  launch.classList.add('corner-launch');
  document.body.append(launch);
})();
