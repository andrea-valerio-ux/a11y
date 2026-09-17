#!/usr/bin/env bash
# Removes the helper app that "Install launcher (Mac).command" created.
APP="$HOME/Applications/Accessibility Checklist Scanner Launcher.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -d "$APP" ]; then "$LSREG" -u "$APP" >/dev/null 2>&1; rm -rf "$APP"; echo ""; echo "  Removed $APP"; else echo ""; echo "  The launcher was not installed."; fi
echo ""; echo "  Press any key to close."; read -n 1 -s
