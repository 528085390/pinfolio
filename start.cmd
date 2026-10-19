@echo off
rem 2026-10-20: the user asked to stop keeping a foreground console window / run in background.
rem The server now runs inside run-pinboard.vbs with a hidden window (log: logs\pinboard.log).
rem This window only lives until startup finishes: poll /api/health until 200, open the browser,
rem then close itself. To stop: double-click stop.cmd (or tools\pinboard.ps1 stop).
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pinboard.ps1" start
if errorlevel 1 pause
exit /b %ERRORLEVEL%
