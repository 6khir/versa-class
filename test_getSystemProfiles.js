const fs = require('fs');
const path = require('path');
const os = require('os');
const userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
const localStatePath = path.join(userDataDir, 'Local State');
const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
const infoCache = localState?.profile?.info_cache || {};
console.log("infoCache keys:", Object.keys(infoCache));

const profiles = [];
for (const [key, info] of Object.entries(infoCache)) {
  console.log("Testing key:", key);
  if (!/^(Default|Profile \d+)$/i.test(key)) {
     console.log("Regex failed for:", key);
     continue;
  }
  const profileDir = path.join(userDataDir, key);
  const hasCookies = [
    path.join(profileDir, 'Network', 'Cookies'),
    path.join(profileDir, 'Cookies')
  ].some((p) => fs.existsSync(p));
  console.log("hasCookies:", hasCookies, "for", key);
  if (!hasCookies) continue;
  profiles.push(key);
}
console.log("Profiles found:", profiles);
