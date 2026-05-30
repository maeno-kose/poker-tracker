@echo off
REM Poker Hand Tracker — local server (PWA requires localhost or HTTPS)
REM PCのIPは ipconfig で確認。スマホから http://<PCのIP>:8088/ で開く
cd /d "%~dp0"
"C:\Users\user\AppData\Local\Programs\Python\Python313\python.exe" -m http.server 8088 --bind 0.0.0.0
