#!/bin/bash
cd "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )" || exit 1
pkill -f "VERSA SOFTWARE ( TPT )/node_modules/electron" 2>/dev/null; sleep 1
: > "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/_versa_boot.log"
nohup npm start > "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/_versa_boot.log" 2>&1 &
echo "launched pid $!"
