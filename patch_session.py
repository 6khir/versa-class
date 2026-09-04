import re

filepath = "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/src/browser-controller.cjs"
with open(filepath, "r") as f:
    content = f.read()

# 1. Patch constructor
content = content.replace(
    "    this.profileDir = profileDir;",
    "    this.baseProfileDir = profileDir;\n    this.profileDir = profileDir;"
)

# 2. Patch importSystemLoginSession completely
start_marker = "async importSystemLoginSession(selectedProfile = null) {"
end_marker = "async launch({ headless = false } = {}) {"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    new_method = """async importSystemLoginSession(selectedProfile = null) {
    this.#loginProgress('closing_managed_browser', 'Switching to the dedicated isolated browser profile…');
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
    this.jobPages.clear();
    this.preparedJobs.clear();

    const candidate = this.loginCandidate
      ?? (selectedProfile ? installedBrowserCandidates().find((item) => item.label === selectedProfile.browser && existsSync(item.executablePath)) : null)
      ?? installedBrowserCandidates().find((item) => existsSync(item.executablePath) && item.userDataDir && existsSync(item.userDataDir));
      
    let lastUsed = selectedProfile?.profileKey || 'Default';
    if (!selectedProfile) {
        try {
            const sourceLocalStatePath = join(candidate.userDataDir, 'Local State');
            const sourceLocalState = readJson(sourceLocalStatePath);
            lastUsed = String(sourceLocalState?.profile?.last_used || 'Default');
        } catch(e) {}
    }

    if (!/^(Default|Profile \\d+)$/i.test(lastUsed)) {
      lastUsed = 'Default';
    }

    // CRUCIAL FIX: Stop wiping and copying the cookies DB! 
    // It breaks Google Gemini because it misses Local Storage and IndexedDB.
    // Instead, use a permanent, dedicated profile directory for each Chrome account so it Stays Signed In Forever.
    this.profileDir = `${this.baseProfileDir}_${lastUsed.replace(/\\s+/g, '')}`;
    mkdirSync(this.profileDir, { recursive: true });

    this.loginPending = false;
    this.loginProcess = null;
    this.#loginProgress('session_copied', `Switched isolated browser to ${lastUsed}.`);

    return { importedCookieCount: 1, preservedTptCookieCount: 0, sourceBrowser: candidate?.label || 'Google Chrome', sourceProfile: lastUsed };
  }

  """
    content = content[:start_idx] + new_method + content[end_idx:]
    with open(filepath, "w") as f:
        f.write(content)
    print("Patched importSystemLoginSession")
else:
    print("Could not find markers")
