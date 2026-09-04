import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/renderer/styles.css"
with open(filepath, "r") as f:
    content = f.read()

# Make sure brand icons don't shrink and overlap
fix_css = """
/* Anti-overlap / Flex shrink fixes */
svg, .brand-icon, .method-icon, .integration-icon, .auth-mark, .icon-button, .sidebar-nav button svg {
  flex-shrink: 0;
}
.brand-block h1.brand-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
"""

if "/* Anti-overlap" not in content:
    content = content + "\n" + fix_css
    
    with open(filepath, "w") as f:
        f.write(content)
    print("Fixed UI overlapping issues.")
else:
    print("Already fixed.")
