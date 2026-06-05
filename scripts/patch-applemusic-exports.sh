#!/usr/bin/env bash
# Patches the applemusic-api package.json to export the AxiosManager module
# so catunes can access the internal cookiejar for cookie injection.
set -euo pipefail

find_pkg() {
  # Locate the real (non-symlink) directory of the installed package.
  local link
  link="$(readlink -f packages/client/node_modules/applemusic-api 2>/dev/null)" || return 1
  [ -d "$link" ] || return 1
  echo "$link"
}

PKG_DIR="$(find_pkg)"
if [ -z "$PKG_DIR" ]; then
  echo "applemusic-api not installed, skipping patch" >&2
  exit 0
fi

PKG_JSON="$PKG_DIR/package.json"
if [ ! -f "$PKG_JSON" ]; then
  echo "package.json not found at $PKG_JSON" >&2
  exit 1
fi

# Check if the export already exists.
if grep -q './dist/utils/AxiosManager.js' "$PKG_JSON" 2>/dev/null; then
  echo "applemusic-api exports already patched."
  exit 0
fi

# Apply the patch using python3 (more reliable than sed for JSON).
python3 -c "
import json, sys
with open('$PKG_JSON') as f:
    pkg = json.load(f)
exp = pkg.setdefault('exports', {})
exp['./dist/utils/AxiosManager.js'] = {
    'types': './dist/utils/AxiosManager.d.ts',
    'import': './dist/utils/AxiosManager.js'
}
with open('$PKG_JSON', 'w') as f:
    json.dump(pkg, f, indent=2)
    f.write('\n')
" && echo "Patched applemusic-api exports successfully."
