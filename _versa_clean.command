#!/bin/bash
P="/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )"
TS=$(date +%Y%m%d-%H%M%S)
Q="$HOME/Desktop/VERSA_SHADOWS_QUARANTINE/$TS"
LOG="$P/_versa_clean.log"
mkdir -p "$Q"
{
echo "==== VERSA SHADOW CLEAN  $(date) ===="
echo "Quarantine folder: $Q"; echo
echo "### RUNNING before ###"
ps aux | grep -iE 'VERSA CLASS.app|com.versa.class' | grep -v grep
echo
echo "### Quitting any running BUILT VERSA CLASS app (com.versa.class) ###"
osascript -e 'tell application id "com.versa.class" to quit' 2>/dev/null && echo "  quit sent" || echo "  not running / no quit"
pkill -f "VERSA CLASS.app/Contents/MacOS" 2>/dev/null && echo "  pkill matched" || echo "  pkill none"
echo
echo "### All built 'VERSA CLASS.app' bundles on this Mac (Spotlight) ###"
mdfind -name "VERSA CLASS.app" 2>/dev/null | tee /tmp/_versa_apps.txt
echo
echo "### Quarantining built .app bundles (reversible move) ###"
while IFS= read -r app; do
  [ -z "$app" ] && continue
  case "$app" in
    "$P/"*) tag="project-dist" ;;
    *) tag="ext" ;;
  esac
  base=$(echo "$app" | sed 's#/#_#g')
  if mv "$app" "$Q/${tag}__${base}" 2>/dev/null; then
    echo "  MOVED: $app"
  else
    echo "  COULD NOT MOVE (perm/SIP?): $app"
  fi
done < /tmp/_versa_apps.txt
echo
echo "### Project stale build dir (dist) ###"
if [ -d "$P/dist" ]; then mv "$P/dist" "$Q/project-dist-folder" 2>/dev/null && echo "  moved $P/dist" || echo "  could not move dist"; else echo "  no dist"; fi
echo
echo "### SOURCE-FOLDER clones for your review (NOT moved) ###"
for d in "$HOME/copilot-worktrees" "$HOME/tpt_automation" "$HOME/tpt_patches" "$HOME/Antigravity-Migration-Backup" "$HOME/OpenJarvis"; do
  echo "--- $d ---"; ls -la "$d" 2>/dev/null | head -12
done
echo
find "$HOME/Desktop" "$HOME/Downloads" -maxdepth 3 -name "main.cjs" 2>/dev/null | grep -v "$P/" | while read m; do
  if grep -q 'com.versa.class\|versa-class' "$(dirname "$m")/../package.json" 2>/dev/null; then echo "  CLONE? $m"; fi
done
echo
echo "### RUNNING after ###"
ps aux | grep -iE 'VERSA CLASS.app|com.versa.class' | grep -v grep || echo "  none"
echo "==== DONE ===="
} > "$LOG" 2>&1
echo "VERSA clean complete. Log: $LOG"
echo "Quarantine: $Q"
