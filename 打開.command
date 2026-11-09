#!/bin/bash
cd "$(dirname "$0")"
PORT=5500
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  osascript -e 'display alert "找不到 Python" message "請先安裝 Python 3，或直接雙擊 index.html（面板／鍵盤可用；鏡頭功能需本機伺服器）。"'
  open "index.html"
  exit 1
fi
"$PY" -m http.server "$PORT" >/tmp/pop-chord-device-server.log 2>&1 &
PID=$!
sleep 0.8
open "http://127.0.0.1:${PORT}/"
echo "伺服器執行中（PID $PID）。關閉此視窗不會自動停伺服器；結束可用：kill $PID"
wait $PID
