@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ELECTRA] Python 3 was not found in PATH.
  echo Install Python 3 or use any static HTTP server in this folder.
  echo.
  pause
  exit /b 1
)
echo [ELECTRA] Starting local server at http://127.0.0.1:5188
echo [ELECTRA] Close this window or press Ctrl+C to stop.
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:5188/"
python -m http.server 5188 --bind 127.0.0.1
endlocal
