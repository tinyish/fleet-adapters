#!/bin/sh
#
# The tiny pack's checks, against the fleet binary FLEET_BIN names: its
# documents name only verbs that binary has, `fleet pack check` passes it with
# every slot, it lays over that binary's defaults and installs with ts, and
# its doctor entries and rituals are what they say they are.
#
#   FLEET_BIN=/path/to/fleet ci/check-tiny.sh
#
# Needs deno and git on PATH.

set -eu

: "${FLEET_BIN:?FLEET_BIN names the fleet binary these checks run against}"

root=$(cd "$(dirname "$0")/.." && pwd)

exec deno test --allow-all "$root/ci/tiny_test.ts"
