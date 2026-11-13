#!/usr/bin/env bash
set -euo pipefail
mkdir -p artifacts
# Exercise the installed launcher's own compatibility profile.
unset QT_QPA_PLATFORM QT_OPENGL QT_XCB_GL_INTEGRATION QT_QUICK_BACKEND
unset LIBGL_ALWAYS_SOFTWARE QTWEBENGINE_DISABLE_SANDBOX QTWEBENGINE_CHROMIUM_FLAGS
unset VELA_HARDWARE_ACCELERATION VELA_LINUX_COMPATIBILITY LD_PRELOAD
command -v open-doc
timeout 45s open-doc >artifacts/app.stdout.log 2>artifacts/app.stderr.log &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
found=0
for i in $(seq 1 25); do
  sleep 1
  if xdotool search --onlyvisible --name 'Open Doc|Open-Doc' >artifacts/window-ids.txt 2>/dev/null; then found=1; break; fi
done
if [ "$found" -ne 1 ]; then echo 'FAIL: no visible window'; exit 1; fi
id=$(head -n 1 artifacts/window-ids.txt)
sleep 8
import -window "$id" artifacts/open-doc-window.png
identify artifacts/open-doc-window.png >artifacts/image-info.txt
colors=$(convert artifacts/open-doc-window.png -gravity center -crop 80%x80%+0+0 -resize 100x100! -colors 16 -format %k info:)
echo "screenshot_colors=$colors"
if [ "$colors" -lt 3 ]; then echo 'FAIL: blank or uniform window'; exit 1; fi
echo 'PASS: packaged executable opened a nonuniform window'
