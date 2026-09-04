import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/renderer/renderer.js"
with open(filepath, "r") as f:
    content = f.read()

old_logic = """  const detectedIdentity = [detected.name, detected.email].filter(Boolean).join(' · ');
  elements.settingsChatgptProfile.textContent = connected
    ? (detectedIdentity || 'The Gemini session is valid. Add your preferred name and email above if Gemini does not expose them.')
    : 'Sign in or create an account, then verify the local session.';"""

new_logic = """  let detectedIdentity = [detected.name, detected.email].filter(Boolean).join(' · ');
  
  if (connected && state?.profileRotation?.enabled && state.profileRotation.profiles && state.profileRotation.profiles.length > 1) {
    const rotationCount = state.profileRotation.profiles.length;
    detectedIdentity = `${detectedIdentity || 'Valid Session'} (Auto-swapping between ${rotationCount} accounts)`;
  }
  
  elements.settingsChatgptProfile.textContent = connected
    ? (detectedIdentity || 'The Gemini session is valid. Add your preferred name and email above if Gemini does not expose them.')
    : 'Sign in or create an account, then verify the local session.';"""

if "Auto-swapping between" not in content:
    content = content.replace(old_logic, new_logic)
    with open(filepath, "w") as f:
        f.write(content)
    print("Patched settings UI for rotation count.")
else:
    print("Already patched.")
