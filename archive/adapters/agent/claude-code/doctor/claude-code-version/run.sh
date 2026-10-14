#!/bin/sh
#
# The Claude Code pin, measured: the release this pack's adapter was measured
# against beside what `claude --version` answers, for the claude the adapter
# runs.
#
# TWO readings, and the check reports which one it got:
#
#   holds   claude answered and its first line carries the supported version
#           as a whole token.
#   broken  claude did not run, or answered another version, or the seam names
#           a claude the adapter would refuse. The first and the last are a
#           fleet that cannot start a seat; the second one that still reads
#           its seats, on shapes nobody measured. All exit 1, and all name the
#           line that installs the supported release.
#
# SUPPORTED IS A COPY of the adapter's `measured`, whose last entry is
# `PINNED` (adapters/agent/claude-code/lib/capabilities.ts), because a script
# cannot import a TypeScript constant. The adapter's own suite
# (test/doctor_test.ts) reads this line and fails until the two agree, so a
# pin move that forgets it is refused at the suite.
#
# BUILT ON SHELL BUILTINS ALONE: the absence reading is taken with claude off
# PATH, and a check that needs its own tools on that same PATH cannot tell an
# absent claude from an absent grep.
#
# THE SEAM IS THE ADAPTER'S: FLEET_CLAUDE_BIN, where it is set, is an absolute
# path to the claude to run, and otherwise it is the first `claude` on PATH. A
# value that is not an absolute path is refused by the adapter, naming it, and
# never falls back to PATH — so it is broken here too, and this check does not
# run a claude the adapter never would.
#
# THE AUTO-UPDATER IS OFF for the claude this runs, as for every claude the
# adapter runs: an interactive 2.1.280 once installed a newer release and
# re-pointed the operator's own claude under them (fleet-rge6's incident).
#
# TWO INSTALL LINES, because the upgrade one is the binary's own verb: a claude
# that answered takes `claude install <version>`, and a missing one takes the
# native installer with the same version.

set -u

SUPPORTED=2.1.280
INSTALL="claude install $SUPPORTED"
FRESH="curl -fsSL https://claude.ai/install.sh | bash -s $SUPPORTED"

case ${FLEET_CLAUDE_BIN:-} in
'') bin=claude ;;
/*) bin=$FLEET_CLAUDE_BIN ;;
*)
	echo "claude-code-version: supported Claude Code $SUPPORTED"
	echo "claude-code-version: broken — FLEET_CLAUDE_BIN names \`$FLEET_CLAUDE_BIN\`, which is not an absolute path, and the adapter refuses every call over it. Name the claude by its absolute path, or unset it for the \`claude\` on PATH. Install the supported release: $FRESH"
	exit 1
	;;
esac

# Read from the command's own status, never through a pipe: a claude that is
# absent exits 127 here and a claude that is broken exits its own code, and
# both are reported as what they are.
reported=$(DISABLE_AUTOUPDATER=1 "$bin" --version 2>/dev/null)
rc=$?
if [ "$rc" -ne 0 ] || [ -z "$reported" ]; then
	echo "claude-code-version: supported Claude Code $SUPPORTED"
	echo "claude-code-version: broken — \`$bin --version\` did not answer (exit $rc); no claude answers there, so fleet cannot start a seat. Install the supported release: $FRESH"
	exit 1
fi

# The first line only, which is where claude prints its own version.
IFS='
'
# shellcheck disable=SC2086 # split on the newline IFS names, on purpose
set -- $reported
unset IFS
first=$1

# A whole token, never a substring: 2.1.280 is not a match for 12.1.2800, and
# the leading-v form is the same version written the other way.
found=no
for token in $first; do
	if [ "$token" = "$SUPPORTED" ] || [ "$token" = "v$SUPPORTED" ]; then
		found=yes
	fi
done

echo "claude-code-version: supported Claude Code $SUPPORTED; \`$bin --version\` answers: $first"
if [ "$found" = yes ]; then
	echo "claude-code-version: holds"
	exit 0
fi

echo "claude-code-version: broken — this claude is not the supported $SUPPORTED, so the shapes the adapter reads were not measured on it; the controller still runs. Install the supported release: $INSTALL"
exit 1
