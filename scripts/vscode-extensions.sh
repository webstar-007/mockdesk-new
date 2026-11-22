#!/usr/bin/env bash
# Installs every VS Code extension this project recommends (the list lives in .vscode/extensions.json).
#   ./scripts/vscode-extensions.sh            install them
#   ./scripts/vscode-extensions.sh --list     only show the list
# Needs the "code" command. In VS Code: Ctrl+Shift+P > "Shell Command: Install 'code' command in PATH" (macOS) .
cd "$(dirname "$0")/.." || exit 1
FILE=".vscode/extensions.json"
[ -f "$FILE" ] || { echo "Cannot find $FILE"; exit 1; }
LIST=$(grep -o '"[a-zA-Z0-9-]*\.[a-zA-Z0-9.-]*"' "$FILE" | tr -d '"')
if [ "${1:-}" = "--list" ]; then echo "$LIST"; exit 0; fi
command -v code >/dev/null 2>&1 || { echo "The 'code' command was not found. Install VS Code first (https://code.visualstudio.com), then run this again."; exit 1; }
FAILED=0
for ext in $LIST; do
  if code --list-extensions 2>/dev/null | grep -qix "$ext"; then echo "  [ OK ]  $ext (already installed)"; continue; fi
  if code --install-extension "$ext" --force >/dev/null 2>&1; then echo "  [ OK ]  $ext installed"; else echo "  [FAIL]  $ext could not be installed"; FAILED=$((FAILED+1)); fi
done
echo; [ $FAILED -eq 0 ] && echo "All extensions are ready. Restart VS Code if it was open." || { echo "$FAILED extension(s) failed. Check your internet connection and try again."; exit 1; }
