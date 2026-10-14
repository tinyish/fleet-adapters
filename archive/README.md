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

| Path                                     | The pack                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tiny/`                                  | the doctrine: the house rules, the roles, the seat's rituals, the takeoff workflow. It imports `ts`. |
| `runtimes/ts/`                           | the TypeScript layer: Deno pinned as the workflow runtime, and the workflow SDK under `assets/sdk`.  |
| `adapters/store/`                        | one pack per store adapter, each in a directory named for the store.                                 |
| `adapters/agent/`                        | one pack per agent adapter, each in a directory named for the agent.                                 |
| `.claude-plugin/`                        | the Claude Code marketplace `fleet`, listing the plugin the claude-code pack carries. Not a pack.    |
| `ci/`                                    | the checks run on the packs, against a pinned fleet. Not a pack.                                     |
| `versions.toml`                          | the fleet commit CI builds and checks the packs against.                                             |
| `.github/workflows/ci.yml`               | CI: installs the pins and runs the checks under `ci/`, on every push and pull request.               |
| `.github/workflows/claude-code-live.yml` | the claude-code pack against Claude Code itself, on demand and nightly, never on a push.             |

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
FLEET_BIN=/path/to/fleet ci/check-claude-code.sh
```

CI runs these four against fleet built from the commit `versions.toml` pins,
with Deno at the version `runtimes/ts/pack.toml` pins and bd at the version the
bd pack's doctor check pins; `ci/pins.sh` prints those, and the Claude Code
release the claude-code pack pins. `fleet --version` names no commit, so
`versions.toml` is the record of which fleet the checks passed on.

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

`ci/check-claude-code.sh` runs the claude-code pack's steps the same way, and
runs no Claude Code: the ts pack's deno check, `deno fmt --check`, `deno lint`
and `deno task test` in the adapter, `deno task types` and a `git diff` of the
generated contract, `fleet pack check`, `fleet agent check` on the adapter
offline, and the hook arm in `ci/claude_code_test.ts`, which installs the pack
into a scratch fleet and pipes a PreToolUse payload the shell-trap class refuses
to `fleet guard --adapter claude-code`, which must print the deny the built-in
mapping prints. The offline check runs under a scratch `HOME` holding a made-up
`.claude.json` with the three onboarding keys `launch` copies, and a `PATH` with
no claude on it, so `version` answers null.

### The live check

`ci/check-claude-code-live.sh` is the claude-code pack against Claude Code
itself, and costs model turns:

```sh
FLEET_BIN=/path/to/fleet FLEET_LIVE_MODEL=claude-haiku-4-5 \
  FLEET_CLAUDE_BIN=/path/to/claude-2.1.280 ci/check-claude-code-live.sh
```

Its steps: the claude it runs is the pinned release, and tmux the one
`FLEET_LIVE_TMUX` names where that is set; `fleet agent check --live`, which
launches a session through the pack in a scratch worktree, config dir and tmux
socket, types one turn, and ends and resumes it; `fleet doctor` in a scratch
fleet reporting the pack's `claude-code-version` and `isolation-pair` holding;
and, a while later, the same claude still answering the pinned release, so the
auto-updater stayed off. Every claude runs with `DISABLE_AUTOUPDATER=1`, no step
touches a live fleet, and each step's output is kept under `FLEET_LIVE_LOG` with
the versions it ran on. The login is the operator's: `launch` copies the
onboarding keys of `~/.claude.json`, and the credential is the keychain item
Claude Code keeps for the default config dir.

`.github/workflows/claude-code-live.yml` runs it on a macOS runner, on demand
and nightly, with Claude Code installed by the pack's doctor check's own
fresh-install line, tmux at the minimum the pinned fleet declares (built from
source by `ci/install-tmux.sh` where the image's is another release), and fleet
at the pinned commit, and keeps each run's log as an artifact. It signs in from
the repository secret `CLAUDE_CODE_LOGIN`, one JSON object:

```json
{ "credentials": "<the keychain item>", "oauthAccount": { "...": "..." } }
```

`credentials` is what
`security find-generic-password -s "Claude Code-credentials" -w` prints on a Mac
signed in to the account the runs are paid from, and `oauthAccount` the same key
of that Mac's `~/.claude.json`. Where the secret is not set, as on a fork, or
does not sign in, the live job is skipped with a line saying why, and is not
red.
