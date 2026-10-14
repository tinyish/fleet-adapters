#!/bin/sh
#
# bd at one release, into one directory:
#
#   ci/install-bd.sh <version> <dir>
#
# BEADS' OWN INSTALLER'S STEPS, AT A PINNED TAG. beads' installation page
# (docs/getting-started/installation.md at the tag) names its install script
# for CI, and that script downloads the release archive for the platform from
# gastownhall/beads's GitHub release, checks it against the release's
# checksums.txt, and puts `bd` on the machine. It always installs the LATEST
# release, and CI pins one, so this is those same steps at the tag the pack's
# doctor check pins: the same archive, the same checksum refusal, no go
# install fallback and no PATH editing. The repository moved from
# steveyegge/beads to gastownhall/beads; the releases are served from the
# latter.
#
# Needs curl, tar, and sha256sum or shasum.

set -eu

version=${1:?the bd version to install, e.g. 1.3.0}
dir=${2:?the directory to put bd in}

case $(uname -s) in
Linux) os=linux ;;
Darwin) os=darwin ;;
*)
	echo >&2 "install-bd: no bd release archive for $(uname -s)"
	exit 1
	;;
esac
case $(uname -m) in
x86_64 | amd64) arch=amd64 ;;
aarch64 | arm64) arch=arm64 ;;
*)
	echo >&2 "install-bd: no bd release archive for $(uname -m)"
	exit 1
	;;
esac

archive="beads_${version}_${os}_${arch}.tar.gz"
release="https://github.com/gastownhall/beads/releases/download/v$version"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL --retry 3 -o "$work/$archive" "$release/$archive"
curl -fsSL --retry 3 -o "$work/checksums.txt" "$release/checksums.txt"

expected=$(awk -v target="$archive" '{ name = $2; sub(/^\*/, "", name); if (name == target) { print $1; exit } }' "$work/checksums.txt")
if [ -z "$expected" ]; then
	echo >&2 "install-bd: checksums.txt at v$version lists no $archive; refusing an unverified binary"
	exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
	actual=$(sha256sum "$work/$archive" | awk '{ print $1 }')
else
	actual=$(shasum -a 256 "$work/$archive" | awk '{ print $1 }')
fi
if [ "$expected" != "$actual" ]; then
	echo >&2 "install-bd: $archive does not match checksums.txt ($actual, not $expected); refusing it"
	exit 1
fi

tar -xzf "$work/$archive" -C "$work" bd
mkdir -p "$dir"
install -m 0755 "$work/bd" "$dir/bd"
"$dir/bd" version
