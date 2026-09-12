#!/bin/bash
P="/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )"
LOG="$P/_versa_wipe.log"
Q="$HOME/Desktop/VERSA_SHADOWS_QUARANTINE/projects-db-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$Q"
{
echo "== quitting running dev app =="
pkill -f "VERSA SOFTWARE ( TPT )/node_modules/electron" 2>/dev/null && echo "  app quit" || echo "  not running"
sleep 2
echo "== locating projects DB (tpt-books.sqlite) =="
found=0
while IFS= read -r -d '' f; do
  found=1
  cp "$f" "$Q/$(basename "$f")" 2>/dev/null
  mv "$f" "$Q/removed-$(basename "$f")" 2>/dev/null && echo "  backed up + cleared: $f"
done < <(find "$HOME/Library/Application Support" -maxdepth 4 -name 'tpt-books.sqlite*' -print0 2>/dev/null)
[ "$found" = "0" ] && echo "  no tpt-books.sqlite found (already clean)"
echo "== backup at: $Q =="
echo "== login cookies/sessions left untouched =="
} > "$LOG" 2>&1
echo "Wipe log: $LOG"
echo "=== relaunching clean from source ==="
cd "$P" || exit 1
export ELECTRON_ENABLE_LOGGING=1
exec npm start
