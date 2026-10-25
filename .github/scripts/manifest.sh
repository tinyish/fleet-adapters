#!/bin/sh
# manifest.json for a release, on stdout: <name> <version> <dist>, where
# dist holds fleet-<name>-<target> for each target fleet ships. The
# protocol comes from the Linux x86_64 binary itself, so the manifest
# cannot disagree with it.
set -eu
name=$1 version=$2 dist=$3
targets="aarch64-apple-darwin x86_64-apple-darwin aarch64-unknown-linux-musl x86_64-unknown-linux-musl"
sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    else
        shasum -a 256 "$1" | cut -d ' ' -f 1
    fi
}
hashes='{}'
for t in $targets; do
    bin=$dist/fleet-$name-$t
    if [ ! -f "$bin" ]; then
        echo "no build for $t: $bin is missing" >&2
        exit 1
    fi
    hashes=$(printf '%s' "$hashes" | jq --arg t "$t" --arg h "$(sha256 "$bin")" '. + {($t): $h}')
done
protocol=$(echo '{}' | "$dist/fleet-$name-x86_64-unknown-linux-musl" protocol 2>/dev/null |
    jq -e '.protocol | numbers' 2>/dev/null) || {
    echo "could not read its protocol from fleet-$name-x86_64-unknown-linux-musl" >&2
    exit 1
}
jq -n --arg name "$name" --arg version "$version" --argjson protocol "$protocol" \
    --argjson targets "$hashes" \
    '{name: $name, version: $version, protocol: $protocol, targets: $targets}'
