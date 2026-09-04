import re

# 1. Revert styles.css
with open('renderer/styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

css = css.replace('var(--solid-white, #ffffff)', '#ffffff')
css = css.replace('var(--solid-white, #FFF)', '#FFF')
css = css.replace('var(--solid-white, #fff)', '#fff')
css = css.replace('var(--app-bg, #F3F8FC)', '#F3F8FC')
css = css.replace('var(--app-bg-soft, #F7FBFE)', '#F7FBFE')
css = css.replace('var(--text-dark, #102433)', '#102433')
css = css.replace('var(--text-main, #17324A)', '#17324A')
css = css.replace('var(--text-muted, #5E7A8C)', '#5E7A8C')
css = css.replace('var(--text-green-dark, #06281a)', '#06281a')
css = css.replace('var(--topbar-bg, rgba(8, 16, 40, 0.94))', 'rgba(8, 16, 40, 0.94)')
css = css.replace('var(--sidebar-bg, rgba(7, 16, 40, 0.88))', 'rgba(7, 16, 40, 0.88)')
css = css.replace('var(--stage-card-bg, rgba(10, 26, 31, 0.82))', 'rgba(10, 26, 31, 0.82)')
css = css.replace('var(--hero-bg, rgba(236, 247, 252, 0.95))', 'rgba(236, 247, 252, 0.95)')
css = css.replace('var(--strip-bg, rgba(243, 248, 252, 0.96))', 'rgba(243, 248, 252, 0.96)')
css = css.replace('var(--strip-bg-alpha, rgba(243, 248, 252, 0.72))', 'rgba(243, 248, 252, 0.72)')
css = css.replace('var(--nav-bg, rgba(236, 247, 252, 0.72))', 'rgba(236, 247, 252, 0.72)')

css = re.sub(r'body\.dark-theme\s*\{[^}]*\}\s*', '', css, flags=re.DOTALL)
with open('renderer/styles.css', 'w', encoding='utf-8') as f:
    f.write(css)

# 2. Revert index.html (remove the toggle button)
with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# The exact button injected
btn_regex = r'<button id="theme-toggle-button" class="theme-toggle-button".*?</button>'
html = re.sub(btn_regex, '', html, flags=re.DOTALL)

# The script inclusion
html = html.replace('<script src="./theme-toggle.js"></script>', '')

with open('renderer/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
