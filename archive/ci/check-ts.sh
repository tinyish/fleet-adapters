#!/bin/sh
#
# The ts pack's checks, against the fleet binary FLEET_BIN names: the runtime
# it pins and the doctor instance that measures it (ci/ts_test.ts), and the
# SDK's own suite (runtimes/ts/assets/sdk), whose arms run that binary.
#
#   FLEET_BIN=/path/to/fleet [FLEET_SOURCE=/path/to/fleet-checkout] ci/check-ts.sh
#
# FLEET_SOURCE is a checkout of fleet at the commit FLEET_BIN was built from.
# One arm of the SDK's suite reads fleet's source for the entry kinds core
# defines and the controller wakes on; without it, that arm is ignored and
# the run says so.
#
# Needs deno on PATH.

set -eu

: "${FLEET_BIN:?FLEET_BIN names the fleet binary these checks run against}"

root=$(cd "$(dirname "$0")/.." && pwd)

deno test --allow-all "$root/ci/ts_test.ts"

# The SDK's suite runs over tiny's takeoff, which reaches the SDK where fleet
# installs it: every pack in one directory, under its own name. This
# repository keeps ts under runtimes/, so the two are laid out that way in a
# scratch directory first.
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cp -R "$root/runtimes/ts" "$scratch/ts"
cp -R "$root/tiny" "$scratch/tiny"

if [ -z "${FLEET_SOURCE:-}" ]; then
	echo >&2 "check-ts: FLEET_SOURCE is unset, so the SDK arm that reads fleet's source is ignored"
fi

cd "$scratch/ts"
deno test --allow-all assets/sdk/
