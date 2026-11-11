#!/usr/bin/env bash
set -euo pipefail
mkdir -p artifacts
export QT_QPA_PLATFORM=xcb QT_OPENGL=software LIBGL_ALWAYS_SOFTWARE=1
export QT_DEBUG_PLUGINS=1 QTWEBENGINE_DISABLE_SANDBOX=1
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
colors=$(convert artifacts/open-doc-window.png -resize 100x100! -colors 16 -format %k info:)
echo "screenshot_colors=$colors"
if [ "$colors" -lt 3 ]; then echo 'FAIL: blank or uniform window'; exit 1; fi
echo 'PASS: packaged executable opened a nonuniform window'
