import re

with open('renderer/apple-vibrancy-theme.css', 'r', encoding='utf-8') as f:
    css = f.read()
# Strip the bad dark mode out entirely
css = re.sub(r'/\* -+ \*\/\n/\* MIDNIGHT MODE.*', '', css, flags=re.DOTALL)
with open('renderer/apple-vibrancy-theme.css', 'w', encoding='utf-8') as f:
    f.write(css.strip())

with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Add the link if not exists
if 'dark-theme.css' not in html:
    html = html.replace('<link rel="stylesheet" href="./styles.css">', '<link rel="stylesheet" href="./styles.css">\n    <link rel="stylesheet" href="./dark-theme.css">')
    with open('renderer/index.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("Linked dark-theme.css")

