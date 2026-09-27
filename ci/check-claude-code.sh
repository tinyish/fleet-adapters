#!/bin/sh
#
# The claude-code pack's checks, offline, against the fleet binary FLEET_BIN
# names — the steps CI runs on every push, one per workflow step, so a person
# and the workflow run one thing:
#
#   FLEET_BIN=/path/to/fleet ci/check-claude-code.sh               every step
#   FLEET_BIN=/path/to/fleet ci/check-claude-code.sh agent-check    those named
#
# NO CLAUDE RUNS HERE. Nothing below starts Claude Code or needs one on PATH:
# the adapter's suite runs recorded listings and transcripts and scripts it
# writes, and fleet agent check runs under a PATH with no claude on it, so
# the adapter's version answers null (an answer, which fleet agent check
# counts as one offline). ci/check-claude-code-live.sh is the one against
# Claude Code itself.
#
# The steps, in the order they run:
#
#   pins         deno is the one the ts pack pins: its deno-version check, run
#                as fleet doctor runs it
#   fmt          deno fmt --check in the adapter
#   lint         deno lint in the adapter
#   test         deno task test in the adapter, with FLEET_BIN set, so the
#                arms that run fleet guard over the pack's [hook] and the
#                plugin's shim run too. From this checkout: the plugin arm
#                holds plugin/skills/ to the repository's tiny/skills/
#   types        deno task types regenerates contract.json and contract.d.ts
#                from FLEET_BIN's `fleet agent schema`; git diff says whether
#                the committed ones are what that fleet prints
#   pack-check   fleet pack check over the pack, resolved above ts
#   agent-check  fleet agent check --adapter <the adapter's main.ts>, offline:
#                exit 0 and no FAIL line — capabilities valid, each posture
#                launching, resume, read and context answering every fixture,
#                version answering null. Under a scratch HOME whose made-up
#                .claude.json carries the three onboarding keys launch copies,
#                and a PATH holding deno and git and no claude
#   hook         ci/claude_code_test.ts: the pack installed into a scratch
#                fleet, and a Claude Code PreToolUse payload the shell-trap
#                class refuses piped to fleet guard --adapter claude-code,
#                which prints the deny document the built-in prints
#
# EVERY STEP RUNS, a red one included, and a summary names each; the exit is
# 1 when any step was red. Needs deno and git on PATH.

set -u

: "${FLEET_BIN:?FLEET_BIN names the fleet binary these checks run against}"

root=$(cd "$(dirname "$0")/.." && pwd)
pack=$root/adapters/agent/claude-code
adapter=$pack/adapters/agent/claude-code

pins() {
	FLEET_PACK_DIR=$root/runtimes/ts sh "$root/runtimes/ts/doctor/deno-version/run.sh"
}

fmt() {
	(cd "$adapter" && deno fmt --check)
}

lint() {
	(cd "$adapter" && deno lint)
}

test_() {
	(cd "$adapter" && deno task test)
}

types() {
	# Outside a repository git diff does not refuse: it compares the two paths
	# with each other, --no-index, and reds or greens on that. So a checkout
	# git will not read is said to be one, and the step is red.
	if [ "$(git -C "$adapter" rev-parse --is-inside-work-tree 2>/dev/null)" != true ]; then
		echo "types: $adapter is in no git work tree git will read, so the regenerated contract cannot be diffed"
		return 1
	fi
	(cd "$adapter" && deno task types) &&
		git -C "$adapter" diff --exit-code -- contract.json contract.d.ts
}

pack_check() {
	"$FLEET_BIN" pack check "$pack" --over "$root/runtimes/ts"
}

agent_check() {
	scratch=$(mktemp -d)
	# The PATH the check runs under: the directories deno and git are in, and
	# the system's, and no claude. A claude found there anyway is said to be
	# one, and the step is red: this step's version answer rests on none.
	path=$(dirname "$(command -v deno)"):$(dirname "$(command -v git)"):/usr/bin:/bin
	if claude=$(PATH=$path command -v claude); then
		echo "agent-check: $claude is on the PATH this step runs under, so version would not answer null"
		rm -rf "$scratch"
		return 1
	fi
	# launch copies hasCompletedOnboarding, lastOnboardingVersion and
	# oauthAccount from the operator's .claude.json and refuses, exit 3,
	# without one; the operator here is made up, and nothing of anybody's
	# login is read.
	mkdir -p "$scratch/home"
	printf '%s\n' '{"hasCompletedOnboarding":true,"lastOnboardingVersion":"2.1.280","oauthAccount":{"accountUuid":"00000000-0000-0000-0000-000000000000"}}' \
		>"$scratch/home/.claude.json"
	run() {
		env -i PATH="$path" HOME="$scratch/home" TMPDIR="${TMPDIR:-/tmp}" "$@"
	}

	# The first call of a fresh checkout compiles the adapter, and on macOS a
	# freshly written executable's first run can wait on the system's policy
	# check; fleet bounds every call at 20 seconds. One call first takes that
	# cost where it is timed and named, and not inside the check's first verb.
	started=$(date +%s)
	printf '{"schema_version":1,"root":"%s"}' "$scratch" |
		run "$adapter/main.ts" capabilities >/dev/null ||
		{
			rm -rf "$scratch"
			return 1
		}
	echo "agent-check: the adapter's first call answered in $(($(date +%s) - started))s"

	out=$scratch/check.out
	# The check's own exit, kept past the pipe that shows its lines as they
	# land: POSIX sh has no pipefail.
	{
		run "$FLEET_BIN" agent check --adapter "$adapter/main.ts"
		echo $? >"$out.rc"
	} | tee "$out"
	rc=$(cat "$out.rc")
	# Read from the check's own status, and the FAIL lines besides: the exit
	# is the contract, and a FAIL line under an exit 0 is a check that lied.
	failed=$(grep -c '^FAIL' "$out")
	rm -rf "$scratch"
	if [ "$rc" -ne 0 ] || [ "$failed" -ne 0 ]; then
		echo "agent-check: fleet agent check exited $rc with $failed FAIL line(s)"
		return 1
	fi
}

hook() {
	deno test --allow-all "$root/ci/claude_code_test.ts"
}

all="pins fmt lint test types pack-check agent-check hook"
steps=${*:-$all}

red=
summary=
for step in $steps; do
	case $step in
	pins | fmt | lint | types | hook) fn=$step ;;
	test) fn=test_ ;;
	pack-check) fn=pack_check ;;
	agent-check) fn=agent_check ;;
	*)
		echo >&2 "check-claude-code: no step named $step — the steps are: $all"
		exit 2
		;;
	esac
	echo "==> check-claude-code: $step"
	if $fn; then
		summary="$summary
  pass  $step"
	else
		summary="$summary
  FAIL  $step"
		red=yes
	fi
done

echo "==> check-claude-code, against $FLEET_BIN:$summary"
[ -z "$red" ]
