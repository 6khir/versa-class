import re

with open('renderer/styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Define the color replacements as variables
replacements = {
    # Panels & Backgrounds
    r'#ffffff': 'var(--solid-white, #ffffff)',
    r'#FFF': 'var(--solid-white, #FFF)',
    r'#fff': 'var(--solid-white, #fff)',
    r'#F3F8FC': 'var(--app-bg, #F3F8FC)',
    r'#F7FBFE': 'var(--app-bg-soft, #F7FBFE)',
    
    # Text colors
    r'#102433': 'var(--text-dark, #102433)',
    r'#17324A': 'var(--text-main, #17324A)',
    r'#5E7A8C': 'var(--text-muted, #5E7A8C)',
    r'#06281a': 'var(--text-green-dark, #06281a)',
    
    # Specific RGBA panels
    r'rgba\(8,\s*16,\s*40,\s*0\.94\)': 'var(--topbar-bg, rgba(8, 16, 40, 0.94))',
    r'rgba\(7,\s*16,\s*40,\s*0\.88\)': 'var(--sidebar-bg, rgba(7, 16, 40, 0.88))',
    r'rgba\(10,\s*26,\s*31,\s*0\.82\)': 'var(--stage-card-bg, rgba(10, 26, 31, 0.82))',
    r'rgba\(236,\s*247,\s*252,\s*0\.95\)': 'var(--hero-bg, rgba(236, 247, 252, 0.95))',
    r'rgba\(243,\s*248,\s*252,\s*0\.96\)': 'var(--strip-bg, rgba(243, 248, 252, 0.96))',
    r'rgba\(243,\s*248,\s*252,\s*0\.72\)': 'var(--strip-bg-alpha, rgba(243, 248, 252, 0.72))',
    r'rgba\(236,\s*247,\s*252,\s*0\.72\)': 'var(--nav-bg, rgba(236, 247, 252, 0.72))',
}

# Apply the replacements (be careful not to replace inside existing vars)
for old, new_var in replacements.items():
    # Only replace if not already part of a var()
    # Negative lookbehind to ensure we aren't replacing something already wrapped
    css = re.sub(rf'(?<!var\(--solid-white, ){old}', new_var, css, flags=re.IGNORECASE)

# Ensure the dark theme overrides exist at the top
dark_theme_css = '''
body.dark-theme {
  /* Core Overrides */
  --bg: #0D1117 !important;
  --panel: #161B22 !important;
  --panel-strong: #21262D !important;
  --panel-soft: #0D1117 !important;
  --border: #30363D !important;
  --border-hover: #8B949E !important;
  --text: #C9D1D9 !important;
  --text-bright: #F0F6FC !important;
  --muted: #8B949E !important;
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.6) !important;
  color-scheme: dark !important;
  
  /* Hardcoded Refactor Overrides */
  --solid-white: #161B22 !important;
  --app-bg: #0D1117 !important;
  --app-bg-soft: #0D1117 !important;
  --text-dark: #F0F6FC !important;
  --text-main: #C9D1D9 !important;
  --text-muted: #8B949E !important;
  --text-green-dark: #d1fae5 !important;
  
  --topbar-bg: rgba(13, 17, 23, 0.94) !important;
  --sidebar-bg: rgba(13, 17, 23, 0.88) !important;
  --stage-card-bg: rgba(22, 27, 34, 0.82) !important;
  --hero-bg: rgba(22, 27, 34, 0.95) !important;
  --strip-bg: rgba(13, 17, 23, 0.96) !important;
  --strip-bg-alpha: rgba(13, 17, 23, 0.72) !important;
  --nav-bg: rgba(22, 27, 34, 0.72) !important;
}
'''

# Prepend the dark theme CSS just after the first :root block
css = re.sub(r'(:root\s*\{[^}]*\})', r'\1\n' + dark_theme_css, css, count=1)

with open('renderer/styles.css', 'w', encoding='utf-8') as f:
    f.write(css)

print("styles.css refactored with CSS variables!")

# Remove dark-theme.css from index.html
with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace('    <link rel="stylesheet" href="./dark-theme.css">', '')
with open('renderer/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
