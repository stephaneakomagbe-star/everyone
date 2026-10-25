@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Installe Node.js depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
if not exist node_modules\express (
  echo Installation...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue.
    pause
    exit /b 1
  )
)
node server.js
pause
