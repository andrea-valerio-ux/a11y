@echo off
REM Removes what "Install launcher (Windows).bat" added to the registry.
reg delete "HKCU\Software\Classes\a11y-checklist" /f >nul 2>&1
echo.
echo   Removed the launcher.
echo.
pause
