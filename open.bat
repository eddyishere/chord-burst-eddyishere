@echo off
cd /d "%~dp0"
set PORT=5500
where py >nul 2>&1
if %ERRORLEVEL%==0 (set PY=py& goto RUN)
where python >nul 2>&1
if %ERRORLEVEL%==0 (set PY=python& goto RUN)
where python3 >nul 2>&1
if %ERRORLEVEL%==0 (set PY=python3& goto RUN)
echo No Python. Opening PowerShell server...
start "" "http://127.0.0.1:%PORT%/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port %PORT%
pause
exit /b
:RUN
start "" "http://127.0.0.1:%PORT%/"
echo Server: http://127.0.0.1:%PORT%/
echo Keep this window open.
%PY% -m http.server %PORT%
pause
