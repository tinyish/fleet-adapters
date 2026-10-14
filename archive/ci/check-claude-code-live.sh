#!/bin/sh
#
# The claude-code pack against Claude Code itself: the live half of its
# checks, which CI runs on demand and nightly and never on a push, because it
# costs model turns and needs a login.
#
#   FLEET_BIN=/path/to/fleet FLEET_LIVE_MODEL=<model> \
#     [FLEET_CLAUDE_BIN=/path/to/claude] [FLEET_LIVE_LOG=<dir>] \
#     ci/check-claude-code-live.sh [step ...]
#
# FLEET_LIVE_MODEL is the model every launch names, a vendor string passed
# through as given; the workflow names the cheapest the account has.
# FLEET_CLAUDE_BIN is the claude to run, as the adapter reads it; unset, the
# first claude on PATH. FLEET_LIVE_LOG is the directory each step's output is
# kept in, one <step>.log per step, and the versions each ran on in
# versions.log: the recorded measurement a re-pin cites. Unset, a temporary
# directory, named at the end. pins writes claude-at-pins.txt there too, the
# file the claude resolved to, which pin-held reads: name the same
# FLEET_LIVE_LOG for both where they run as separate calls, as CI runs them.
# FLEET_LIVE_TMUX, where set, is the tmux release pins requires.
#
# NEVER A LIVE FLEET: every step runs under a scratch FLEET_DIR and
# FLEET_HOME, fleet agent check starts its session in a scratch worktree
# under a scratch config dir on a scratch tmux socket (fleet-check-<pid>) and
# removes all three, and every claude runs with DISABLE_AUTOUPDATER=1, so no
# step can move the install it measures (lessons A1; fleet-rge6's incident).
# The login is the operator's: launch seeds each scratch config dir with the
# onboarding keys of $HOME/.claude.json, and the credential is the one the
# default config dir's keychain item holds.
#
# The steps, in the order they run:
#
#   pins         the claude the adapter runs is the release the pack pins
#                (its claude-code-version doctor check, run as fleet doctor
#                runs it), tmux answers the version FLEET_LIVE_TMUX names
#                where it is set, and deno is ts's pin
#   agent-check  fleet agent check --adapter <main.ts> --live --model
#                <FLEET_LIVE_MODEL>: every offline check, and a session
#                launched through the pack that comes up idle in a fresh
#                worktree (launch seeds its trust, so no dialog stops it),
#                reads busy on a typed turn and then idle, whose transcript
#                context finds where the pack reads it and counts the turn,
#                whose ended pane reads dead, and whose resume by the full
#                id comes back idle as the same session. Exit 0, no FAIL
#                line, and the summary naming the pinned release
#   doctor       ci/claude_code_test.ts's live arm: in a scratch fleet with
#                the pack installed, fleet doctor reports claude-code-version
#                and isolation-pair from the pack, and both hold. Starts no
#                session: claude --version and claude auth status
#   pin-held     after FLEET_LIVE_SETTLE seconds (60 unset), the claude the
#                adapter runs still answers the pinned release from the same
#                file it answered from at pins: the auto-updater stayed off
#
# EVERY STEP RUNS, a red one included, and a summary names each; the exit is
# 1 when any step was red. Needs deno, git and tmux on PATH.

set -u

: "${FLEET_BIN:?FLEET_BIN names the fleet binary these checks run against}"
: "${FLEET_LIVE_MODEL:?FLEET_LIVE_MODEL names the model the live session runs on}"

export DISABLE_AUTOUPDATER=1

root=$(cd "$(dirname "$0")/.." && pwd)
pack=$root/adapters/agent/claude-code
adapter=$pack/adapters/agent/claude-code
pinned=$(sed -n 's/^SUPPORTED=//p' "$pack/doctor/claude-code-version/run.sh")

log=${FLEET_LIVE_LOG:-$(mktemp -d)}
mkdir -p "$log"
log=$(cd "$log" && pwd)

case ${FLEET_CLAUDE_BIN:-} in
'') claude=$(command -v claude || echo claude) ;;
*) claude=$FLEET_CLAUDE_BIN ;;
esac

# Where the claude the adapter runs resolves to, through any link: the
# native installer's claude is a link into versions/<release>, and an
# auto-update re-points it.
resolved() {
	(
		cd "$(dirname "$claude")" 2>/dev/null || exit 1
		target=$(basename "$claude")
		while [ -L "$target" ]; do
			link=$(readlink "$target")
			cd "$(dirname "$link")" || exit 1
			target=$(basename "$link")
		done
		echo "$(pwd -P)/$target"
	)
}

version() {
	"$claude" --version 2>/dev/null | sed -n 1p
}

pins() {
	FLEET_PACK_DIR=$pack sh "$pack/doctor/claude-code-version/run.sh" || return 1
	if [ -n "${FLEET_LIVE_TMUX:-}" ]; then
		said=$(tmux -V)
		echo "pins: tmux answers \`$said\`; the live check runs on tmux $FLEET_LIVE_TMUX"
		[ "$said" = "tmux $FLEET_LIVE_TMUX" ] || return 1
	fi
	FLEET_PACK_DIR=$root/runtimes/ts sh "$root/runtimes/ts/doctor/deno-version/run.sh" || return 1
	resolved >"$log/claude-at-pins.txt"
	{
		echo "measured: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
		echo "claude: $claude -> $(cat "$log/claude-at-pins.txt")"
		echo "claude --version (at pins): $(version)"
		echo "tmux: $(tmux -V)"
		deno --version | sed -n 1p
		echo "fleet: $FLEET_BIN ($("$FLEET_BIN" --version))"
		echo "model: $FLEET_LIVE_MODEL"
		echo "os: $(uname -srm)"
	} >>"$log/versions.log"
}

agent_check() {
	scratch=$(mktemp -d)
	# The first call of a fresh checkout compiles the adapter, and on macOS a
	# freshly written executable's first run can wait on the system's policy
	# check; fleet bounds every call at 20 seconds.
	started=$(date +%s)
	printf '{"schema_version":1,"root":"%s"}' "$scratch" |
		"$adapter/main.ts" capabilities >/dev/null || {
		rm -rf "$scratch"
		return 1
	}
	echo "agent-check: the adapter's first call answered in $(($(date +%s) - started))s"

	out=$scratch/check.out
	# The check's own exit, kept past the pipe: POSIX sh has no pipefail.
	{
		env FLEET_DIR="$scratch/machine" FLEET_HOME="$scratch/home" \
			GIT_AUTHOR_NAME="fleet-packs checks" GIT_AUTHOR_EMAIL=checks@example.invalid \
			GIT_COMMITTER_NAME="fleet-packs checks" GIT_COMMITTER_EMAIL=checks@example.invalid \
			"$FLEET_BIN" agent check --adapter "$adapter/main.ts" --live --model "$FLEET_LIVE_MODEL"
		echo $? >"$out.rc"
	} | tee "$out"
	rc=$(cat "$out.rc")
	failed=$(grep -c '^FAIL' "$out")
	named=$(grep -c "^agent check: claude $pinned " "$out")
	rm -rf "$scratch"
	if [ "$rc" -ne 0 ] || [ "$failed" -ne 0 ] || [ "$named" -ne 1 ]; then
		echo "agent-check: fleet agent check --live exited $rc with $failed FAIL line(s), and its summary named claude $pinned $named time(s)"
		return 1
	fi
}

doctor() {
	FLEET_LIVE=1 deno test --allow-all --filter "fleet doctor" "$root/ci/claude_code_test.ts"
}

pin_held() {
	settle=${FLEET_LIVE_SETTLE:-60}
	echo "pin-held: waiting ${settle}s for an updater that was left on to act"
	sleep "$settle"
	now=$(version)
	at=$(resolved)
	before=$(cat "$log/claude-at-pins.txt" 2>/dev/null)
	echo "claude --version (after ${settle}s more): $now" >>"$log/versions.log"
	echo "pin-held: \`$claude --version\` answers $now, from $at (at pins: $before)"
	case " $now " in
	*" $pinned "*) ;;
	*)
		echo "pin-held: the claude the adapter runs no longer answers $pinned"
		return 1
		;;
	esac
	if [ "$at" != "$before" ]; then
		echo "pin-held: the claude the adapter runs resolves elsewhere than it did at pins"
		return 1
	fi
}

all="pins agent-check doctor pin-held"
steps=${*:-$all}

red=
summary=
for step in $steps; do
	case $step in
	pins | doctor) fn=$step ;;
	agent-check) fn=agent_check ;;
	pin-held) fn=pin_held ;;
	*)
		echo >&2 "check-claude-code-live: no step named $step — the steps are: $all"
		exit 2
		;;
	esac
	echo "==> check-claude-code-live: $step"
	# Each step's output to the terminal and to its own log; its status kept
	# past the pipe.
	{
		$fn 2>&1
		echo $? >"$log/.$step.rc"
	} | tee "$log/$step.log"
	if [ "$(cat "$log/.$step.rc")" -eq 0 ]; then
		summary="$summary
  pass  $step"
	else
		summary="$summary
  FAIL  $step"
		red=yes
	fi
	rm -f "$log/.$step.rc"
done

echo "==> check-claude-code-live, against $FLEET_BIN and $claude:$summary" | tee -a "$log/summary.log"
echo "==> the log: $log"
[ -z "$red" ]
