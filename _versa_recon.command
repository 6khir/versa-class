#!/bin/bash
P="/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )"
OUT="$P/_versa_recon.txt"
{
echo "==== VERSA SHADOW RECON  $(date) ===="
echo
echo "### 1. RUNNING versa/electron processes ###"
ps aux | grep -iE 'versa class|com.versa.class|[e]lectron .|npm start' | grep -v grep
echo
echo "### 2. Spotlight: VERSA CLASS.app bundles anywhere ###"
mdfind -name "VERSA CLASS.app" 2>/dev/null
mdfind "kMDItemKind == 'Application'" 2>/dev/null | grep -i versa
echo
echo "### 3. ~/Applications and /Applications ###"
ls -dl ~/Applications/*ERSA* /Applications/*ERSA* 2>/dev/null
echo
echo "### 4. Candidate shadow folders (repo clones / worktrees / backups) ###"
for d in "$HOME/copilot-worktrees" "$HOME/tpt_automation" "$HOME/tpt_patches" "$HOME/Antigravity-Migration-Backup" "$HOME/OpenJarvis"; do
  echo "--- $d ---"; ls -la "$d" 2>/dev/null | head -15
done
echo
echo "### 5. Other copies of this app on Desktop/Downloads (by marker files) ###"
find "$HOME/Desktop" "$HOME/Downloads" -maxdepth 3 \( -name "*.app" -o -name "main.cjs" \) 2>/dev/null | grep -iE 'versa|VERSA' | grep -v "/Desktop/VERSA SOFTWARE ( TPT )/" | head -40
echo
echo "### 6. This project's own stale build ###"
ls -dl "$P/dist/mac-arm64/VERSA CLASS.app" 2>/dev/null
echo "==== DONE ===="
} > "$OUT" 2>&1
echo "recon written to $OUT"
