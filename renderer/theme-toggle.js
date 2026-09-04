(function() {
  const btn = document.getElementById('theme-toggle-button');
  if(!btn) return;
  const sun = btn.querySelector('.sun-icon');
  const moon = btn.querySelector('.moon-icon');
  const currentTheme = localStorage.getItem('theme');
  
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-theme');
    sun.style.display = 'none';
    moon.style.display = 'block';
  }
  
  btn.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    if (document.body.classList.contains('dark-theme')) {
      localStorage.setItem('theme', 'dark');
      sun.style.display = 'none';
      moon.style.display = 'block';
    } else {
      localStorage.setItem('theme', 'light');
      sun.style.display = 'block';
      moon.style.display = 'none';
    }
  });
})();
