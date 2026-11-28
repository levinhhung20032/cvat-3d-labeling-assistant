#!/usr/bin/env bash
# Linux equivalent of build.bat: show version, update from GitHub (only when safe), install deps, build.
# Usage: ./build.sh            build only
#        ./build.sh --run      build, then open Chrome/Chromium/Edge with the extension loaded
set -uo pipefail

# Run from a temp copy: `git pull` may replace this very file while bash is still reading it
# (bash reads scripts incrementally, so a swapped file would run misaligned lines).
if [ "${1:-}" != "--copy" ]; then
    self="$(readlink -f "$0")"
    tmp="$(mktemp "${TMPDIR:-/tmp}/cvla-build.XXXXXX")" && cp "$self" "$tmp" \
        && exec bash "$tmp" --copy "$(dirname "$self")" "${@:1}"
else
    shift
fi
if [ "${1:-}" != "" ] && [ -d "$1" ]; then cd "$1"; shift; else cd "$(dirname "$(readlink -f "$0")")"; fi
[ "${1:-}" = "--copy" ] && shift
RUN=0; [ "${1:-}" = "--run" ] && RUN=1

# version [ref]: read "version" from package.json (working tree, or a git ref such as @{u}).
version() {
    local src
    if [ -z "${1:-}" ]; then src="$(cat package.json 2>/dev/null)"; else src="$(git show "$1:package.json" 2>/dev/null)"; fi
    printf '%s' "$src" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

# explain LOGFILE: show the git error and hint at a fix by error type.
explain() {
    echo
    echo "Could not fetch from GitHub. Git error:"
    cat "$1"
    if grep -qiE "dubious ownership|unsafe repository" "$1"; then
        echo
        echo "=> Git blocks this repo because the folder belongs to another user."
        echo "   Fix: git config --global --add safe.directory \"$(pwd)\""
        read -r -t 20 -p "   Add it now? [y/N] " ans || ans=""
        echo
        if [[ "$ans" =~ ^[Yy] ]]; then
            git config --global --add safe.directory "$(pwd)" && echo "   Added. Re-run build.sh."
        fi
    elif grep -qiE "Repository not found|Authentication failed|could not read Username|403" "$1"; then
        echo
        echo "=> The repo is private and git sent no (or the wrong) credentials."
        echo "   Run 'git fetch' once in this folder and sign in with the collaborator account, then re-run build.sh."
    elif grep -qiE "Could not resolve host|unable to access|timed out" "$1"; then
        echo
        echo "=> Cannot reach GitHub (network / proxy). Skipping update, building the current version."
    fi
}

cur="$(version)"
if [ -n "$cur" ]; then echo "Current version: $cur"; else echo "Current version: cannot read package.json"; fi

# Update check: only pull when git exists, this is a git repo and there are no local changes.
if [ ! -d .git ]; then
    echo "This folder is not a git repo (ZIP download?), skipping update."
elif ! command -v git >/dev/null 2>&1; then
    echo "git not found. Install git and re-run. Skipping update."
else
    echo "Checking GitHub for updates..."
    log="$(mktemp "${TMPDIR:-/tmp}/cvla-fetch.XXXXXX")"
    if git fetch >"$log" 2>&1; then
        behind="$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
        if [ "$behind" = "0" ]; then
            echo "Already up to date: $cur"
        else
            new="$(version '@{u}')"
            echo
            echo "=== New version on GitHub: $cur -> ${new:-?} ($behind commit(s)) ==="
            git log --oneline -n 10 'HEAD..@{u}'
            echo
            read -r -p "Update to ${new:-?} then build? [y/N] " ans || ans=""
            if [[ ! "$ans" =~ ^[Yy] ]]; then
                echo "Skipping update, building the current version $cur."
            else
                # Force update: discard whatever differs locally (edits, mode/CRLF noise, diverged commits) and match GitHub.
                if git reset --hard '@{u}'; then
                    cur="$(version)"
                    echo "Updated to: $cur"
                else
                    echo "Update failed. Skipping, building the current version $cur."
                fi
            fi
        fi
    else
        explain "$log"
    fi
    rm -f "$log"
fi

NODE_MIN=18
NODE_INSTALL=20   # LTS major to install when Node is missing or older than NODE_MIN

node_ok() {
    command -v node >/dev/null 2>&1 || return 1
    [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge "$NODE_MIN" ]
}

# install_node: install Node $NODE_INSTALL via nvm (user-level, no sudo, leaves the system Node alone).
install_node() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
        echo "Installing nvm..."
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash
        elif command -v wget >/dev/null 2>&1; then
            wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash
        else
            echo "Need curl or wget to install nvm. Install one (or Node $NODE_MIN+ from https://nodejs.org) and re-run." >&2
            return 1
        fi
    fi
    [ -s "$NVM_DIR/nvm.sh" ] || return 1
    set +u   # nvm.sh reads unset variables
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install "$NODE_INSTALL" && nvm use "$NODE_INSTALL" >/dev/null
    local rc=$?
    set -u
    return $rc
}

# build.mjs uses top-level await; old Node fails with "SyntaxError: Unexpected reserved word".
if ! node_ok; then
    if command -v node >/dev/null 2>&1; then
        echo "Node.js $(node --version) is too old (need $NODE_MIN+). Installing Node.js $NODE_INSTALL LTS..."
    else
        echo "Node.js is not installed. Installing Node.js $NODE_INSTALL LTS..."
    fi
    install_node || { echo "Could not install Node.js. Install Node $NODE_MIN+ from https://nodejs.org and re-run." >&2; exit 1; }
    hash -r
    node_ok || { echo "Node.js still not usable in this shell. Open a new terminal and re-run." >&2; exit 1; }
fi
echo "Node.js: $(node --version)"

echo "Installing dependencies (npm install)..."
npm install || { echo "npm install failed." >&2; exit 1; }

echo "Building (npm run build)..."
npm run build || { echo "Build failed." >&2; exit 1; }

echo
echo "Build done, version $(version) -> $(pwd)/dist. Edge: edge://extensions -> Reload."

if [ "$RUN" = "1" ]; then
    for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
        if command -v "$b" >/dev/null 2>&1; then
            echo "Launching $b with the extension..."
            exec "$b" --user-data-dir="$HOME/.cache/cvla-profile" --load-extension="$(pwd)/dist"
        fi
    done
    echo "No Chrome/Chromium/Edge found. Load $(pwd)/dist manually via chrome://extensions (Developer mode > Load unpacked)." >&2
fi
