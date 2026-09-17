@echo off
REM Run by a11y-checklist:// links once "Install launcher (Windows).bat" has been
REM run. "a11y-checklist://stop" stops the scanner; any other link starts it, or
REM opens it if it is already running.
set "ARG=%~1"
if /i "%ARG%"=="a11y-checklist://stop" goto stop
if /i "%ARG%"=="a11y-checklist://stop/" goto stop
curl -s -o nul -m 1 http://127.0.0.1:4173/ping
if not errorlevel 1 (
  start "" http://127.0.0.1:4173/
  exit /b 0
)
cd /d "%~dp0.."
if exist "runtime\node.exe" (
  start "Accessibility Checklist Scanner" /min "runtime\node.exe" bin\a11y.js ui
) else (
  start "Accessibility Checklist Scanner" /min node bin\a11y.js ui
)
exit /b 0
:stop
taskkill /f /fi "WINDOWTITLE eq Accessibility Checklist Scanner*" >nul 2>&1
exit /b 0
