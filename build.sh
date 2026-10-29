#!/usr/bin/env bash
# Linux equivalent of build.bat: update from GitHub (when safe), install deps, build.
# Usage: ./build.sh            build only
#        ./build.sh --run      build, then open Chrome/Chromium with the extension loaded
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
    echo "Checking GitHub for updates..."
    if git fetch --quiet; then
        behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
        if [ "$behind" = "0" ]; then
            echo "Already up to date."
        elif [ -n "$(git status --porcelain --untracked-files=no)" ]; then
            echo "$behind new commit(s), but you have uncommitted changes; not pulling."
        else
            git pull --ff-only && echo "Updated." || echo "Pull failed, building current version."
        fi
    else
        echo "Could not reach GitHub, skipping update."
    fi
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Install Node.js 20+ (e.g. 'sudo apt install nodejs npm' or https://nodejs.org) and re-run." >&2
    exit 1
fi
echo "Node.js: $(node --version)"

npm install
npm run build
echo "Build done -> $(pwd)/dist"

if [ "${1:-}" = "--run" ]; then
    for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
        if command -v "$b" >/dev/null 2>&1; then
            echo "Launching $b with the extension..."
            exec "$b" --user-data-dir="$HOME/.cache/cvla-profile" --load-extension="$(pwd)/dist"
        fi
    done
    echo "No Chrome/Chromium/Edge found. Load $(pwd)/dist manually via chrome://extensions (Developer mode > Load unpacked)." >&2
fi
