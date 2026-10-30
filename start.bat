@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:3000
  node server.js
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:3000
  python serve.py
  goto :eof
)
echo 没有找到 Node.js 或 Python。请先安装 Node.js： https://nodejs.org  （装好后再双击 start.bat）
pause
