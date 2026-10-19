@echo off
rem Stop pinboard. Since it runs hidden there is no window to close, so use this.
rem It kills the whole node chain (tsx cli + its loader child), not just the port 7788 owner.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pinboard.ps1" stop
if errorlevel 1 pause
exit /b %ERRORLEVEL%
