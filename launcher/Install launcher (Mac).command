#!/usr/bin/env bash
# Double-click once, per computer. Installs a small helper app so the
# "Start the scanner" button on index.html can start the scanner.
# Undo it with "Uninstall launcher (Mac).command".
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"                  # the folder with the Start file and index.html
APP="$HOME/Applications/Accessibility Checklist Scanner Launcher.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

clear 2>/dev/null || true; echo ""; echo "  Installing the one-click launcher..."; echo ""
[ -f "$ROOT/Start Accessibility Checklist Scanner.command" ] || { echo "  Cannot find 'Start Accessibility Checklist Scanner.command' next to the launcher folder."; echo "  Press any key to close."; read -n 1 -s; exit 1; }
chmod +x "$ROOT/Start Accessibility Checklist Scanner.command" 2>/dev/null || true
chmod +x "$ROOT/runtime/bin/node" 2>/dev/null || true

mkdir -p "$HOME/Applications"
rm -rf "$APP"
# The scanner's folder is written into the helper, so moving the folder means running this again.
TMP="$(mktemp -d)"
ESCAPED="${ROOT//\"/\\\"}"
sed "s#__FOLDER__#${ESCAPED}#" "$HERE/launcher.applescript" > "$TMP/launcher.applescript"
osacompile -o "$APP" "$TMP/launcher.applescript"
rm -rf "$TMP"

PL="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.a11y-checklist.launcher" "$PL" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.a11y-checklist.launcher" "$PL"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string Accessibility Checklist Scanner" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string a11y-checklist" "$PL"
# Editing Info.plist breaks the signature osacompile made; sign it again, locally.
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
"$LSREG" -f "$APP"

echo "  Done. The Start button on index.html now starts the scanner."
echo "  The first time, the browser asks whether to open it; allow it."
echo ""
echo "  Installed: $APP"
echo "  Scanner folder: $ROOT"
echo ""
echo "  Press any key to close."; read -n 1 -s
