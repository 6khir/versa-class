import re

with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Only inject if not already present
if 'theme-toggle-button' not in html:
    toggle_btn = '''
<button id="theme-toggle-button" class="theme-toggle-button" aria-label="Toggle Dark Mode" style="margin-left:8px; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.05); border:1px solid var(--border); cursor:pointer; color: var(--text);">
  <svg class="sun-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
  <svg class="moon-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
</button>
'''

    script_block = '''
<script>
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
</script>
</body>
'''

    # Inject button right before the closing </div> of topbar-actions
    html = re.sub(r'(<button id="launch-browser-button"[^>]*>Manage Gemini login</button>\s*)(</div>)', r'\1' + toggle_btn + r'\2', html, count=1)
    
    # Inject script right before closing </body>
    html = html.replace('</body>', script_block)

    with open('renderer/index.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("Dark mode HTML/JS injected!")
else:
    print("Dark mode HTML already present.")

