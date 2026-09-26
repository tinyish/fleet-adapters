#!/bin/sh
#
# The bd pack's checks, against the fleet binary FLEET_BIN names — the steps
# CI runs, one per workflow step, so a person and the workflow run one thing:
#
#   FLEET_BIN=/path/to/fleet ci/check-bd.sh            every step
#   FLEET_BIN=/path/to/fleet ci/check-bd.sh test types  the steps named
#
# The steps, in the order they run:
#
#   pins         bd and deno are the ones the packs pin: the pack's own
#                bd-version check and ts's deno-version check, run as fleet
#                doctor runs them. Every later step's "measured on" rests on it.
#   fmt          deno fmt --check in the adapter
#   lint         deno lint in the adapter
#   test         deno task test in the adapter: the unit suites, and main_test
#                on a real bd board — which skips where no bd runs, and so
#                runs only after pins has said one does
#   types        deno task types regenerates contract.json and contract.d.ts
#                from FLEET_BIN's `fleet store schema`; git diff says whether
#                the committed ones are what that fleet prints
#   pack-check   fleet pack check over the pack, resolved above ts
#   store-check  fleet store check --adapter <the adapter's main.ts>: exit 0
#                and no FAIL line
#   smoke        ci/bd_test.ts: the pack installed into a scratch machine and
#                driven through fleet's fenced writes on a real board, and its
#                doctor check read through fleet doctor
#
# EVERY STEP RUNS, a red one included, and a summary names each; the exit is
# 1 when any step was red. Needs deno, bd and git on PATH.

set -u

: "${FLEET_BIN:?FLEET_BIN names the fleet binary these checks run against}"

root=$(cd "$(dirname "$0")/.." && pwd)
pack=$root/adapters/store/bd
adapter=$pack/adapters/store/bd

pins() {
	FLEET_PACK_DIR=$pack sh "$pack/doctor/bd-version/run.sh" &&
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

store_check() {
	# The first call of a fresh checkout compiles the adapter, and fleet
	# bounds every call at 60 seconds; one call first takes that cost where
	# it is timed and named, and not inside the check's first verb.
	started=$(date +%s)
	printf '{"schema_version":1,"root":"%s"}' "$root" |
		"$adapter/main.ts" capabilities >/dev/null ||
		return 1
	echo "store-check: the adapter's first call answered in $(($(date +%s) - started))s"

	out=$(mktemp)
	# The check's own exit, kept past the pipe that shows its lines as they
	# land: POSIX sh has no pipefail.
	{
		"$FLEET_BIN" store check --adapter "$adapter/main.ts"
		echo $? >"$out.rc"
	} | tee "$out"
	rc=$(cat "$out.rc")
	# Read from the check's own status, and the FAIL lines besides: the exit
	# is the contract, and a FAIL line under an exit 0 is a check that lied.
	failed=$(grep -c '^FAIL' "$out")
	rm -f "$out" "$out.rc"
	if [ "$rc" -ne 0 ] || [ "$failed" -ne 0 ]; then
		echo "store-check: fleet store check exited $rc with $failed FAIL line(s)"
		return 1
	fi
}

smoke() {
	deno test --allow-all "$root/ci/bd_test.ts"
}

all="pins fmt lint test types pack-check store-check smoke"
steps=${*:-$all}

red=
summary=
for step in $steps; do
	case $step in
	pins | fmt | lint | types | smoke) fn=$step ;;
	test) fn=test_ ;;
	pack-check) fn=pack_check ;;
	store-check) fn=store_check ;;
	*)
		echo >&2 "check-bd: no step named $step — the steps are: $all"
		exit 2
		;;
	esac
	echo "==> check-bd: $step"
	if $fn; then
		summary="$summary
  pass  $step"
	else
		summary="$summary
  FAIL  $step"
		red=yes
	fi
done

echo "==> check-bd, against $FLEET_BIN:$summary"
[ -z "$red" ]
