#!/bin/sh
#
# The bd pin, measured: the release this pack's adapter was measured against
# beside what `bd version` answers, for the bd the adapter runs.
#
# TWO readings, and the check reports which one it got:
#
#   holds   bd answered and its first line carries the pinned version as a
#           whole token.
#   broken  bd did not run, or answered another version, or the seam names a
#           bd the adapter would refuse. The first and the last are a store
#           whose every call fails; the second one whose verbs still run, on
#           answers nobody measured. All exit 1, and all point at beads' own
#           installation docs, naming the pin to install.
#
# PINNED IS A COPY of the adapter's `PINNED` (adapters/store/bd/lib/bd.ts),
# because a script cannot import a TypeScript constant. The adapter's own
# suite (test/doctor_test.ts) reads this line and fails until the two agree,
# so a pin move that forgets it is refused at the suite.
#
# BUILT ON SHELL BUILTINS ALONE: the absence reading is taken with bd off
# PATH, and a check that needs its own tools on that same PATH cannot tell an
# absent bd from an absent grep.
#
# THE SEAM IS THE ADAPTER'S: FLEET_BD_BIN, where it is set, is an absolute
# path to the bd to run, and otherwise it is the first `bd` on PATH. A value
# that is not an absolute path is refused by the adapter, naming it, and
# never falls back to PATH — so it is broken here too, and this check does
# not run a bd the adapter never would.
#
# THE INSTALL IS BEADS' OWN PAGE, not a command: bd installs several ways
# (Homebrew, npm, a script, go install with or without cgo) and which one fits
# is the machine's. The page is read at the pin's tag, so it describes the
# release named, and a pin move checks the page is still at that path there.

set -u

PINNED=1.3.0
DOCS="https://github.com/gastownhall/beads/blob/v$PINNED/docs/getting-started/installation.md"
INSTALL="Install the pinned bd $PINNED by beads' own instructions: $DOCS"

case ${FLEET_BD_BIN:-} in
'') bin=bd ;;
/*) bin=$FLEET_BD_BIN ;;
*)
	echo "bd-version: pinned bd $PINNED"
	echo "bd-version: broken — FLEET_BD_BIN names \`$FLEET_BD_BIN\`, which is not an absolute path, and the adapter refuses every call over it. Name the bd by its absolute path, or unset it for the \`bd\` on PATH. $INSTALL"
	exit 1
	;;
esac

# Read from the command's own status, never through a pipe: a bd that is
# absent exits 127 here and a bd that is broken exits its own code, and both
# are reported as what they are.
reported=$("$bin" version 2>/dev/null)
rc=$?
if [ "$rc" -ne 0 ] || [ -z "$reported" ]; then
	echo "bd-version: pinned bd $PINNED"
	echo "bd-version: broken — \`$bin version\` did not answer (exit $rc); no bd answers there, so every verb that reads the work graph fails at the exec. $INSTALL"
	exit 1
fi

# The first line only, which is where bd prints its own version.
IFS='
'
# shellcheck disable=SC2086 # split on the newline IFS names, on purpose
set -- $reported
unset IFS
first=$1

# A whole token, never a substring: 1.3.0 is not a match for 11.3.01, and the
# leading-v form is the same version written the other way.
found=no
for token in $first; do
	if [ "$token" = "$PINNED" ] || [ "$token" = "v$PINNED" ]; then
		found=yes
	fi
done

echo "bd-version: pinned bd $PINNED; \`$bin version\` answers: $first"
if [ "$found" = yes ]; then
	echo "bd-version: holds"
	exit 0
fi

echo "bd-version: broken — this bd is not the pinned $PINNED, so the answers fleet's store reads were not measured on it; the verbs still run. $INSTALL"
exit 1
