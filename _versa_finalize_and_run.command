#!/bin/bash
P="/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )"
Q="$HOME/Desktop/VERSA_SHADOWS_QUARANTINE/$(date +%Y%m%d-%H%M%S)-extra"
LOG="$P/_versa_finalize.log"
mkdir -p "$Q"
{
echo "== quarantining named shadows =="
for f in book_app.asar versa_app.asar book_app.asar.unpacked versa_app.asar.unpacked; do
  if [ -e "$HOME/tpt_patches/$f" ]; then mv "$HOME/tpt_patches/$f" "$Q/" && echo "moved tpt_patches/$f"; fi
done
if [ -d "$HOME/copilot-worktrees/VERSA SOFTWARE ( TPT )" ]; then
  mv "$HOME/copilot-worktrees/VERSA SOFTWARE ( TPT )" "$Q/copilot-worktree-clone" && echo "moved copilot worktree clone"
fi
echo "== done =="
} > "$LOG" 2>&1
echo "Finalize log: $LOG"
echo "=== Launching VERSA CLASS from SOURCE (npm start) ==="
cd "$P" || exit 1
export ELECTRON_ENABLE_LOGGING=1
exec npm start
