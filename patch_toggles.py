import re

with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the engine toggle inline SVGs with the new PNG image tags
html = re.sub(r'<span class="engine-toggle-brand brand-chatgpt"[^>]*>.*?</span>', '<span class="engine-toggle-brand brand-chatgpt" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/chatgpt.png" alt="ChatGPT" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></span>', html, flags=re.DOTALL)
html = re.sub(r'<span class="engine-toggle-brand brand-gemini"[^>]*>.*?</span>', '<span class="engine-toggle-brand brand-gemini" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/gemini.png" alt="Gemini" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></span>', html, flags=re.DOTALL)
html = re.sub(r'<span class="engine-toggle-brand brand-meta"[^>]*>.*?</span>', '<span class="engine-toggle-brand brand-meta" aria-hidden="true" style="background:transparent;"><img src="../assets/brand/meta.png" alt="Meta AI" style="width:100%; height:100%; object-fit:contain; border-radius:22%;"></span>', html, flags=re.DOTALL)

with open('renderer/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("Toggle Images patched!")
