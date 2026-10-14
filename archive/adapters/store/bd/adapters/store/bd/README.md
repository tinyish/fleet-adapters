# bd

The store adapter for [beads](https://github.com/gastownhall/beads): bd 1.3.0
behind fleet's store contract, so a fleet reads and writes its work graph
through a beads board. The adapter is `adapters/store/bd/main.ts`, a Deno
program fleet runs once per call: `main.ts <verb>`, the request on stdin, the
answer on stdout, the exit by the contract's table, and stderr's last line for
people. It answers every verb of the contract (fleet's
[docs/store.md](https://github.com/bembot90/tinyfleet/blob/main/docs/store.md)).

The pack also carries a doctor check, `bd-version`, that says whether the bd the
adapter runs is the release it was measured against.

The pack is `adapters/store/bd/` in this repository, and the paths below are the
pack's, except `ci/`, which is the repository's. This file sits in the adapter's
own directory because a pack's top level holds `pack.toml` and the eight slots
and nothing else.

## What it needs

- **bd 1.3.0.** Every "measured on" claim in the adapter was taken on that
  release, and a bd at another version still runs every verb on answers nobody
  measured. Install it by
  [beads' own instructions](https://github.com/gastownhall/beads/blob/v1.3.0/docs/getting-started/installation.md).
- **Deno 2.9.7**, which the ts pack pins. This pack imports ts rather than
  pinning a runtime of its own, and `fleet pack add` installs the two together.

Both are found on the `PATH` fleet runs the adapter with, which is fleet's own
environment. A service's environment may not carry the directory a package
manager put bd in; name bd with `FLEET_BD_BIN` then (below).

## Installing it

Run `fleet create` on the machine first, then add the pack from this repository:

```sh
fleet pack add https://github.com/bembot90/fleet-packs//adapters/store/bd --version main
```

`--version` takes a tag, a branch, or `sha:` and a full commit. The pack imports
ts from `../../../runtimes/ts`, which this repository holds, so the one add
installs both, pinned at the same commit:

```text
added bd main at <commit> — <machine>/packs/bd
added ts main at <commit>, which bd imports — <machine>/packs/ts
pinned in <machine>/packs.lock
```

`<machine>` is the machine directory: `FLEET_DIR` when that is set, and
otherwise `.fleet` in your home directory.

## Using it

Name the adapter in the project's own file, `fleet.toml` for an embedded fleet
or `.fleet/project.toml` for a declared project, by the absolute path of the
installed entry:

```toml
[store]
adapter = "<machine>/packs/bd/adapters/store/bd/main.ts"
```

Name it by path, not as `adapter = "bd"`. fleet's binary still carries a bd
store of its own under that name, and a setting of `"bd"` opens the built-in
one: fleet reads the built-in's name before it looks for the name in the
installed packs. The smoke ring in `ci/bd_test.ts` shows both.

The board itself is bd's: `bd init` in the project makes it, and fleet never
initialises a store.

## FLEET_BD_BIN

`FLEET_BD_BIN` names the bd to run, as an absolute path to the executable. When
it is unset or empty, the adapter runs the first `bd` on `PATH`.

The adapter and the doctor check both read it, the same way:

- An absolute path to an executable file is the bd every call runs, and
  `main.ts` grants Deno the right to run that path as well as `bd`.
- Any other value is refused, naming it. The adapter answers every call could
  not tell (exit 3), and `bd-version` reports broken (exit 1). Neither falls
  back to the `bd` on `PATH`, because a caller that named a bd meant that one.

## The Deno grant

`main.ts` is two lines of shell and then TypeScript. `/bin/sh` runs the file,
reads the second line, and replaces itself with Deno running the same file under
this grant:

```sh
deno run --no-config --no-prompt --allow-run=bd[,$FLEET_BD_BIN] --allow-read --allow-write --allow-env=FLEET_BD_BIN main.ts <verb>
```

| Flag                            | Why                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--allow-run=bd`                | bd is the one program run. When `FLEET_BD_BIN` is an absolute path it is added to the list. A shebang line cannot carry that, because its arguments are fixed, which is why the first lines are shell.            |
| `--allow-read`, `--allow-write` | The store's files sit under the request's root, and `export` and `scratch` write there. The root is known only once the request is read, and Deno 2.9.7 cannot narrow a grant after it starts, so both are whole. |
| `--allow-env=FLEET_BD_BIN`      | The one variable the adapter reads.                                                                                                                                                                               |
| `--no-config`                   | Deno would otherwise read a `deno.json` beside the script or above it, and a checkout's config would change the adapter's imports and lock.                                                                       |
| `--no-prompt`                   | A permission the grant lacks is refused, never asked for on a terminal.                                                                                                                                           |

## The doctor check

`fleet doctor` finds `doctor/bd-version` through the installed packs like any
pack's check:

```sh
$ fleet doctor bd-version
pass bd-version (bd) — bd-version: holds
doctor 1 check — 1 pass, 0 finding, 0 could not tell
```

The row names `bd` as the check's layer. A fleet binary whose defaults still
carry a `bd-version` check of their own resolves this one above it, so one row
runs, and it is this pack's. The check prints the pin beside what `bd version`
answers:

```text
bd-version: pinned bd 1.3.0; `bd version` answers: bd version 1.3.0 (Homebrew)
bd-version: holds
```

It exits 0 when bd answers the pinned version and 1 when bd does not run,
answers another version, or `FLEET_BD_BIN` is not an absolute path. Each broken
reading points at beads' installation page for the pin. The check uses shell
builtins only, so it can tell a missing bd from a missing tool.

## Checking the pack

`ci/check-bd.sh` runs every check CI runs on this pack against the fleet binary
`FLEET_BIN` names, with deno, bd and git on `PATH`:

```sh
FLEET_BIN=/path/to/fleet ci/check-bd.sh
```

It runs the pack's two doctor checks for bd and deno, `deno fmt --check`,
`deno lint` and `deno task test` in the adapter, `deno task types` followed by
`git diff` on the generated contract, `fleet pack check`, `fleet store check` on
`main.ts`, and the smoke ring in `ci/bd_test.ts`. Name steps to run only those,
for example `ci/check-bd.sh store-check`. The fleet CI builds is the commit
`versions.toml` pins.

`fleet store check` can be run by itself:

```sh
fleet store check --adapter "$PWD/adapters/store/bd/adapters/store/bd/main.ts"
```

It exits 0 when no check fails. At the pinned fleet it reports 25 passed, 0
failed and 2 skipped. The two skipped checks need another writer's keys on the
board, and `fleet store check` hands none to any adapter, fleet's own included.

## Moving the bd pin

The pin is written twice: `PINNED` in `adapters/store/bd/lib/bd.ts`, and the
`PINNED=` line of `doctor/bd-version/run.sh`, which cannot import the first. The
adapter's suite fails until the two agree. A move also re-measures every claim
in `lib/` on the new release and re-records the fixtures under
`adapters/store/bd/test/fixtures`.
