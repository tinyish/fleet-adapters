# fleet-packs

The packs a [fleet](https://github.com/bembot90/tinyfleet) installs: the
doctrine, the workflow runtime, and one pack per store and agent adapter.

A pack is a folder of agents, skills, routines, workflows, health checks,
adapters and templates, with a `pack.toml` at its top. `fleet pack add` fetches
one from a git source at a version, checks it against the format, lays it over
the defaults the `fleet` binary carries, and pins it in `packs.lock`. The
format, and how packs layer, import and shadow one another, is fleet's
[docs/packs.md](https://github.com/bembot90/tinyfleet/blob/main/docs/packs.md).

## The layout

| Path                       | The pack                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tiny/`                    | the doctrine: the house rules, the roles, the seat's rituals, the takeoff workflow. It imports `ts`. |
| `runtimes/ts/`             | the TypeScript layer: Deno pinned as the workflow runtime, and the workflow SDK under `assets/sdk`.  |
| `adapters/store/`          | one pack per store adapter, each in a directory named for the store.                                 |
| `adapters/agent/`          | one pack per agent adapter, each in a directory named for the agent.                                 |
| `.claude-plugin/`          | the Claude Code marketplace `fleet`, listing the plugin the claude-code pack carries. Not a pack.    |
| `ci/`                      | the checks run on the packs, against a pinned fleet. Not a pack.                                     |
| `versions.toml`            | the fleet commit CI builds and checks the packs against.                                             |
| `.github/workflows/ci.yml` | CI: installs the pins and runs the checks under `ci/`, on every push and pull request.               |

## Adding one

The source is this repository, then `//` and the pack's directory in it.
`--version` is a tag, a branch, or `sha:` and a full commit:

```sh
fleet pack add https://github.com/bembot90/fleet-packs//tiny --version main
```

tiny imports ts from `../runtimes/ts`, which this repository holds, so that one
line installs both, out of the same clone and pinned at the same commit.
Installed, every pack sits in the machine's packs directory under its own name,
so ts is `packs/ts` there, beside `packs/tiny`.

Run `fleet create` on the machine first: `fleet pack add` lays a pack over the
defaults it materializes.

## The checks

Each pack's checks run against the fleet binary `FLEET_BIN` names, with deno and
git on `PATH`, and bd too for the bd pack:

```sh
FLEET_BIN=/path/to/fleet ci/check-tiny.sh
FLEET_BIN=/path/to/fleet FLEET_SOURCE=/path/to/fleet-checkout ci/check-ts.sh
FLEET_BIN=/path/to/fleet ci/check-bd.sh
```

CI runs these three against fleet built from the commit `versions.toml` pins,
with Deno at the version `runtimes/ts/pack.toml` pins and bd at the version the
bd pack's doctor check pins; `ci/pins.sh` prints all three. `fleet --version`
names no commit, so `versions.toml` is the record of which fleet the checks
passed on.

`ci/check-tiny.sh` runs `fleet pack check` over tiny with every slot, holds its
documents to the verbs the binary has, installs it with ts over the binary's
defaults, and runs its doctor entries. `ci/check-ts.sh` checks the runtime ts
pins and its doctor entry, then runs the SDK's own suite, whose arms run the
binary. `FLEET_SOURCE` is a checkout of fleet at the commit `FLEET_BIN` was
built from; one SDK arm reads fleet's source, and is ignored without it.

`ci/check-bd.sh` runs the bd pack's steps in order: its doctor checks for bd and
deno, `deno fmt --check`, `deno lint` and `deno task test` in the adapter,
`deno task types` and a `git diff` of the generated contract,
`fleet pack check`, `fleet store check` on the adapter, and the smoke ring in
`ci/bd_test.ts`, which drives fleet's fenced writes through the installed pack
on a real board. Every step runs and a summary names each; name steps, such as
`ci/check-bd.sh store-check`, to run only those.
