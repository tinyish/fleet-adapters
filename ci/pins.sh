#!/bin/sh
#
# The versions CI installs, each read from the one place it is pinned, as
# `name=value` lines — the shape `$GITHUB_OUTPUT` takes:
#
#   fleet_source=<git URL>   versions.toml [fleet] source
#   fleet_commit=<sha>       versions.toml [fleet] commit
#   deno=<version>           runtimes/ts/pack.toml [runtime] version
#   bd=<version>             adapters/store/bd/doctor/bd-version/run.sh PINNED
#
# A pin that does not read is an error, never an empty value.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

# One key of one TOML table, for the flat `key = "value"` lines these files
# hold; a TOML parser would be a dependency for four lines.
key() {
	awk -v table="[$2]" -v key="$3" '
		/^[[:space:]]*\[/ { inside = ($0 == table); next }
		inside {
			line = $0
			sub(/#.*/, "", line)
			if (line ~ "^[[:space:]]*" key "[[:space:]]*=") {
				sub(/^[^=]*=[[:space:]]*/, "", line)
				sub(/[[:space:]]*$/, "", line)
				gsub(/^"|"$/, "", line)
				print line
				exit
			}
		}
	' "$1"
}

pin() {
	if [ -z "$2" ]; then
		echo >&2 "pins: $1 does not read — $3"
		exit 1
	fi
	echo "$1=$2"
}

pin fleet_source "$(key "$root/versions.toml" fleet source)" "versions.toml names no [fleet] source"
pin fleet_commit "$(key "$root/versions.toml" fleet commit)" "versions.toml names no [fleet] commit"
pin deno "$(key "$root/runtimes/ts/pack.toml" runtime version)" "runtimes/ts/pack.toml names no [runtime] version"
pin bd "$(sed -n 's/^PINNED=//p' "$root/adapters/store/bd/doctor/bd-version/run.sh")" "the bd-version check carries no PINNED line"
