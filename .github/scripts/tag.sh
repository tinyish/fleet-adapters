#!/bin/sh
# A release tag, <name>-v<version>: prints name=, version= and dir= for
# GITHUB_OUTPUT, or says why it is not one and exits 1. The version is the
# agent's x.y.z the adapter is measured against, with -<n> (n from 2) for a
# fix of the adapter's own. Run from the repository root.
set -eu
tag=${1:-}
name=${tag%-v*}
version=${tag##*-v}
if [ "$name" = "$tag" ] ||
    ! printf '%s\n' "$name" | grep -Eq '^[a-z][a-z0-9-]*$' ||
    ! printf '%s\n' "$version" |
        grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-([2-9]|[1-9][0-9]+))?$'; then
    echo "$tag is not an adapter release tag (<name>-v<x.y.z>, or <name>-v<x.y.z>-<n> from n=2)" >&2
    exit 1
fi
dir=
for kind in agents trackers forges; do
    if [ -f "$kind/$name/Cargo.toml" ]; then dir=$kind/$name; fi
done
if [ -z "$dir" ]; then
    echo "no adapter called $name under agents/, trackers/ or forges/" >&2
    exit 1
fi
crate=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$dir/Cargo.toml" | head -n 1)
if [ "$crate" != "$version" ]; then
    echo "$dir is at ${crate:-the workspace version}, not $version" >&2
    exit 1
fi
printf 'name=%s\nversion=%s\ndir=%s\n' "$name" "$version" "$dir"
