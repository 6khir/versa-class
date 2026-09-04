import re

with open('renderer/styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Strip out the CSS variables block because we'll handle them manually
css = re.sub(r':root\s*\{[^}]*\}', '', css)

# Color replacements mapping (Light -> Dark)
replacements = {
    # Whites and light backgrounds
    r'#ffffff': '#161B22',
    r'#FFF': '#161B22',
    r'#fff': '#161B22',
    r'#F3F8FC': '#0D1117',
    r'#F7FBFE': '#0D1117',
    r'rgba\(255,\s*255,\s*255,\s*0\.035\)': 'rgba(255, 255, 255, 0.05)', # keep light overlays
    
    # Texts
    r'#102433': '#F0F6FC',
    r'#17324A': '#C9D1D9',
    r'#5E7A8C': '#8B949E',
    r'#06281a': '#d1fae5', # Dark green text in badges -> light green
    
    # Specific panels
    r'rgba\(8,\s*16,\s*40,\s*0\.94\)': 'rgba(13, 17, 23, 0.94)', # Topbar
    r'rgba\(7,\s*16,\s*40,\s*0\.88\)': 'rgba(13, 17, 23, 0.88)', # Sidebar
    r'rgba\(10,\s*26,\s*31,\s*0\.82\)': 'rgba(22, 27, 34, 0.82)', # Stage card
    r'rgba\(236,\s*247,\s*252,\s*0\.95\)': 'rgba(22, 27, 34, 0.95)', # Hero transport
    r'rgba\(243,\s*248,\s*252,\s*0\.96\)': 'rgba(13, 17, 23, 0.96)', # Command strip
    r'rgba\(243,\s*248,\s*252,\s*0\.72\)': 'rgba(13, 17, 23, 0.72)',
    r'rgba\(236,\s*247,\s*252,\s*0\.72\)': 'rgba(22, 27, 34, 0.72)', # Nav
}

for old, new in replacements.items():
    # Case insensitive replacement for hex codes
    css = re.sub(old, new, css, flags=re.IGNORECASE)

# Now prefix every CSS selector with `body.dark-theme `
# A simple regex to find selectors:
# We look for lines that have a '{' and aren't @keyframes or @media
lines = css.split('\n')
out_lines = []
in_keyframes = False
for line in lines:
    stripped = line.strip()
    if stripped.startswith('@keyframes'):
        in_keyframes = True
        out_lines.append(line)
        continue
    if in_keyframes and stripped == '}':
        in_keyframes = False
        out_lines.append(line)
        continue
    
    if in_keyframes:
        out_lines.append(line)
        continue
        
    if '{' in line and not stripped.startswith('@'):
        # This is a selector line. It might have multiple comma-separated selectors.
        parts = line.split('{')
        selectors_part = parts[0]
        rules_part = '{' + parts[1]
        
        selectors = [s.strip() for s in selectors_part.split(',') if s.strip()]
        new_selectors = []
        for s in selectors:
            if s == 'body' or s == 'html' or s == 'html, body':
                new_selectors.append(f"body.dark-theme")
            elif s.startswith('::-webkit'):
                new_selectors.append(s) # Don't prefix scrollbars
            else:
                new_selectors.append(f"body.dark-theme {s}")
        
        out_lines.append(", ".join(new_selectors) + " " + rules_part)
    else:
        out_lines.append(line)

final_css = "\n".join(out_lines)

# Write to a new file
with open('renderer/dark-theme.css', 'w', encoding='utf-8') as f:
    f.write('''
/* AUTO-GENERATED FLAWLESS DARK THEME */
body.dark-theme {
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
}
''')
    f.write(final_css)
print("dark-theme.css generated!")
