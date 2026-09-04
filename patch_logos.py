import re

with open('renderer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Official SVG for ChatGPT (OpenAI logo)
chatgpt_svg = '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0976 5.9847 5.9847 0 0 0 .5157 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.033 6.033 0 0 0 5.7718-4.2272 5.9894 5.9894 0 0 0 3.9882-2.9001 6.051 6.051 0 0 0-.738-7.0516Zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944ZM2.5797 14.1172a4.504 4.504 0 0 1 2.7479-3.1415v5.5779c0 .2852.152.5487.3975.6813l4.821 2.7867-2.02 1.1686a.071.071 0 0 1-.071.0143l-4.84-2.7963a4.4993 4.4993 0 0 1-1.0354-4.291ZM16.3267 4.9961a4.4993 4.4993 0 0 1 2.7479 3.1415v-.0048L19.07 8.1376v-5.5826a.071.071 0 0 0-.071-.0143l-4.84 2.7962a4.4945 4.4945 0 0 0 2.1677 7.2343l2.02-1.1686a.7948.7948 0 0 0 .3927-.6813V4.9961ZM6.388 5.7891a4.4755 4.4755 0 0 1 2.8764 1.0408l-.1419.0804-4.7783 2.7583a.7948.7948 0 0 0-.3927.6813v6.7369l-2.02-1.1686a.071.071 0 0 1-.038-.052v-5.5826A4.504 4.504 0 0 1 6.388 5.7891Zm11.0253 4.0934a4.504 4.504 0 0 1-2.7479 3.1415v-5.5779a.7948.7948 0 0 0-.3975-.6813l-4.821-2.7867 2.02-1.1686a.071.071 0 0 1 .071-.0143l4.84 2.7962a4.4993 4.4993 0 0 1 1.0354 4.2911Zm-9.845 2.1338L9.58 10.8524l2.42-1.3976 2.42 1.3976v2.7858l-2.42 1.3976-2.42-1.3976v-2.7858Zm-4.991 1.7061a4.4945 4.4945 0 0 1-2.1677-7.2343l-2.02 1.1686a.7948.7948 0 0 0-.3927.6813v5.7252Z" fill="#10A37F"/>
</svg>'''

# Official SVG for Gemini
gemini_svg = '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11.5173 1.83984C11.6666 4.90807 12.8315 7.78166 14.8058 10.0528C16.8996 12.4554 19.8654 13.9113 23.0135 14.0727C19.9576 14.238 17.0097 15.698 14.9312 18.0967C12.9467 20.3703 11.7779 23.2505 11.6375 26.3312C11.4883 23.2629 10.3234 20.3894 8.34907 18.1182C6.25528 15.7157 3.28945 14.2597 0.141357 14.0984C3.19725 13.933 6.14522 12.473 8.22368 10.0743C10.2082 7.80076 11.377 4.92053 11.5173 1.83984Z" fill="url(#paint0_linear)"/>
<defs>
<linearGradient id="paint0_linear" x1="0.141357" y1="14.0855" x2="23.0135" y2="14.0855" gradientUnits="userSpaceOnUse">
<stop stop-color="#4285F4"/>
<stop offset="0.32" stop-color="#9B72CB"/>
<stop offset="0.72" stop-color="#D96570"/>
<stop offset="1" stop-color="#F2BD42"/>
</linearGradient>
</defs>
</svg>'''

# Official SVG for Meta AI (infinity logo approximation)
meta_svg = '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M19.14 7.64c-2.3-1.04-4.8-.62-6.55.93-1.74-1.55-4.24-1.97-6.54-.93-3.66 1.66-3.8 6.55-.4 8.44 2.82 1.57 6.04.14 6.94-2.12.9 2.26 4.12 3.69 6.94 2.12 3.4-1.89 3.26-6.78-.4-8.44zm-14.8 5.7c-1.8-1-1.63-3.6.43-4.52 1.74-.79 3.42-.14 4.5 1.13-.53 1.4-2.18 3.84-4.93 3.39zm10.15 1.13c1.08-1.27 2.76-1.92 4.5-1.13 2.06.92 2.23 3.52.43 4.52-2.75.45-4.4-2-4.93-3.39z" fill="#0081FB"/>
</svg>'''

# Official SVG for Canva
canva_svg = '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.3 14.5c-1.34 1.13-3.23 1.25-4.8.44-1.88-1-2.95-3.05-2.65-5.1.33-2.1 2.15-3.8 4.3-4 1.95-.18 3.8.72 4.7 2.42.33.64.12 1.44-.5 1.8-.6.37-1.4.15-1.76-.48-.5-.85-1.52-1.3-2.48-1.13-1.32.22-2.3 1.4-2.4 2.73-.08 1.16.56 2.24 1.6 2.7 1.1.48 2.3.28 3.12-.44.5-.45 1.3-.4 1.75.1.47.53.4 1.35-.12 1.8L15.3 16.5z" fill="#00C4CC"/>
</svg>'''

html = re.sub(r'<div class="integration-icon brand-chatgpt".*?</svg></div>', f'<div class="integration-icon brand-chatgpt" aria-hidden="true">{chatgpt_svg}</div>', html, flags=re.DOTALL)
html = re.sub(r'<div class="integration-icon brand-gemini".*?</svg></div>', f'<div class="integration-icon brand-gemini" aria-hidden="true">{gemini_svg}</div>', html, flags=re.DOTALL)
html = re.sub(r'<div class="integration-icon brand-meta".*?</svg></div>', f'<div class="integration-icon brand-meta" aria-hidden="true">{meta_svg}</div>', html, flags=re.DOTALL)
html = re.sub(r'<div class="integration-icon brand-canva".*?</svg></div>', f'<div class="integration-icon brand-canva" aria-hidden="true">{canva_svg}</div>', html, flags=re.DOTALL)

# Also replace auth-brand-logo for Gemini
html = re.sub(r'<div id="auth-brand-logo" class="auth-brand-logo brand-gemini".*?</svg></div>', f'<div id="auth-brand-logo" class="auth-brand-logo brand-gemini" aria-hidden="true">{gemini_svg}</div>', html, flags=re.DOTALL)

with open('renderer/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("Logos replaced successfully!")
