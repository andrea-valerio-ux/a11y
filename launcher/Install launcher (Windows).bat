@echo off
REM Double-click once, per computer. Lets the "Start the scanner" button on
REM index.html start the scanner. Writes only to your own user part of the
REM registry (HKCU); "Uninstall launcher (Windows).bat" removes it.
set "L=%~dp0launch.bat"
reg add "HKCU\Software\Classes\a11y-checklist" /ve /d "URL:Accessibility Checklist Scanner" /f >nul
reg add "HKCU\Software\Classes\a11y-checklist" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\a11y-checklist\shell\open\command" /ve /d "\"%L%\" \"%%1\"" /f >nul
echo.
echo   Done. The Start button on index.html now starts the scanner.
echo   The first time, the browser asks whether to open it - allow it.
echo.
pause
