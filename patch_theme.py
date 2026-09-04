import re

with open('renderer/apple-vibrancy-theme.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Remove the old Dark Mode
css = re.sub(r'/\* Midnight Mode \(Dark Theme\).*', '', css, flags=re.DOTALL)

with open('renderer/apple-vibrancy-theme.css', 'w', encoding='utf-8') as f:
    f.write(css.strip())

