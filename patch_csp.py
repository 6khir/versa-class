import re

with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace inline script with external script
html = re.sub(r'<script>\s*\(function\(\)\s*\{.*?\}\)\(\);\s*</script>', '<script src="./theme-toggle.js"></script>', html, flags=re.DOTALL)

with open('renderer/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("CSP fix applied!")
