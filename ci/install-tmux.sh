#!/bin/sh
#
# tmux at the release the claude-code pack's live check runs on, into a
# directory of its own:
#
#   ci/install-tmux.sh <version> <dir>      tmux ends up as <dir>/tmux
#
# The version is the minimum fleet declares (MINIMUM_TMUX in fleet's
# core/src/supported.rs, 3.7b) and the one lessons D8 was measured on. A tmux
# on PATH that answers exactly that version is linked and nothing is built;
# any other one, older or newer, is not the measured release, so the release
# tarball is fetched, held to the checksum below, and built from source. The
# build needs a C compiler, make, pkg-config, libevent and ncurses (and
# utf8proc on macOS, where configure is given --enable-utf8proc).
#
# The tarball's checksum was taken from the GitHub release on 2026-09-26; a
# version without a line here is refused, never built unchecked.

set -eu

version=${1:?the tmux version to install}
dir=${2:?the directory to install tmux into}

case $version in
3.7b) sha256=87f2e99e3b685973f2ca002ffd6ed7e51a5744f7009daae5a15670b6d532db96 ;;
*)
	echo >&2 "install-tmux: no checksum is pinned for tmux $version"
	exit 1
	;;
esac

mkdir -p "$dir"
dir=$(cd "$dir" && pwd)

if found=$(command -v tmux 2>/dev/null) && [ "$("$found" -V)" = "tmux $version" ]; then
	ln -sf "$found" "$dir/tmux"
	echo "install-tmux: $found answers tmux $version; linked, nothing built"
	exit 0
fi
[ -n "${found:-}" ] && echo "install-tmux: $found answers $("$found" -V), not tmux $version; building $version"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

tarball=$work/tmux-$version.tar.gz
curl -fsSL -o "$tarball" "https://github.com/tmux/tmux/releases/download/$version/tmux-$version.tar.gz"
if command -v sha256sum >/dev/null 2>&1; then
	got=$(sha256sum "$tarball" | cut -d' ' -f1)
else
	got=$(shasum -a 256 "$tarball" | cut -d' ' -f1)
fi
if [ "$got" != "$sha256" ]; then
	echo >&2 "install-tmux: tmux-$version.tar.gz is $got, not the pinned $sha256"
	exit 1
fi

tar -xzf "$tarball" -C "$work"
utf8=
[ "$(uname -s)" = Darwin ] && utf8=--enable-utf8proc
(
	cd "$work/tmux-$version"
	# shellcheck disable=SC2086 # empty on Linux, one flag on macOS
	./configure --quiet --prefix="$work/prefix" $utf8
	make -s -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
	make -s install
)
cp "$work/prefix/bin/tmux" "$dir/tmux"
said=$("$dir/tmux" -V)
if [ "$said" != "tmux $version" ]; then
	echo >&2 "install-tmux: the built tmux answers \`$said\`, not tmux $version"
	exit 1
fi
echo "install-tmux: built $said into $dir"
