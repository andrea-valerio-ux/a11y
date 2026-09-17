@echo off
title Accessibility Checklist Scanner
cd /d "%~dp0"
echo.
echo   Starting the Accessibility Checklist Scanner...
echo   Your browser will open in a moment. Leave this window open while you use the scanner.
echo   To stop, close this window or press Ctrl+C.
echo.
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" bin\a11y.js ui
) else (
  where node >nul 2>nul || (echo   Node.js is not installed yet. Go to https://nodejs.org, install the LTS version, then double-click this file again. & pause & exit /b 1)
  if not exist node_modules (echo   First run: installing dependencies... & call npm install --silent --no-audit --no-fund)
  node bin\a11y.js ui
)
if errorlevel 1 pause
