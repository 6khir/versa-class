import re

with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace with the new PNG images
html = re.sub(r'<div class="integration-icon brand-chatgpt"[^>]*>.*?</div>', '<div class="integration-icon brand-chatgpt" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/chatgpt.png" alt="ChatGPT" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></div>', html, flags=re.DOTALL)
html = re.sub(r'<div class="integration-icon brand-gemini"[^>]*>.*?</div>', '<div class="integration-icon brand-gemini" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/gemini.png" alt="Gemini" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></div>', html, flags=re.DOTALL)
html = re.sub(r'<div class="integration-icon brand-meta"[^>]*>.*?</div>', '<div class="integration-icon brand-meta" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/meta.png" alt="Meta AI" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></div>', html, flags=re.DOTALL)
html = re.sub(r'<div class="integration-icon brand-canva"[^>]*>.*?</div>', '<div class="integration-icon brand-canva" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/canva.png" alt="Canva" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></div>', html, flags=re.DOTALL)

# And for the auth logo
html = re.sub(r'<div id="auth-brand-logo" class="auth-brand-logo brand-gemini"[^>]*>.*?</div>', '<div id="auth-brand-logo" class="auth-brand-logo brand-gemini" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/gemini.png" alt="Gemini" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></div>', html, flags=re.DOTALL)

with open('renderer/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("PNG Images patched!")
