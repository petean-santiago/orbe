#!/usr/bin/env bash
# Build Orbe's Linux installers (AppImage + .deb) inside Docker, from any OS.
# Needs Docker running. Output lands in scripts/linux/out/.
#   bash scripts/linux/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src" scripts/linux/out
# Tracked and new files only: no node_modules or target folders from this OS.
git ls-files -co --exclude-standard -z | tar --null -T - -cf - | tar -xf - -C "$work/src"
cp scripts/linux/Dockerfile "$work/Dockerfile"
docker build -t orbe-linux-build "$work"
out="$(pwd)/scripts/linux/out"
command -v cygpath >/dev/null && out="$(cygpath -w "$out")"
MSYS_NO_PATHCONV=1 docker run --rm -v "$out:/out" orbe-linux-build
echo "Done: scripts/linux/out/"
