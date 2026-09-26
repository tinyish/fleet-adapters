# claude-code

The agent adapter for
[Claude Code](https://docs.anthropic.com/en/docs/claude-code): Claude Code
2.1.280 behind fleet's agent contract, so a fleet's seats run Claude Code. The
adapter is `adapters/agent/claude-code/main.ts`, a Deno program fleet runs once
per call: `main.ts <verb>`, the request on stdin, the answer on stdout, the exit
by the contract's table, and stderr's last line for people. The contract is
fleet's
[docs/agent.md](https://github.com/bembot90/tinyfleet/blob/main/docs/agent.md).

`adapter.toml` also carries `[hook]`, the mapping of Claude Code's pre-tool hook
that `fleet guard --adapter claude-code` reads a payload and writes a refusal
through.

The pack is `adapters/agent/claude-code/` in this repository, and the paths
below are the pack's. This file sits in the adapter's own directory because a
pack's top level holds `pack.toml` and the eight slots and nothing else.

**Status:** this is the pack's skeleton. It answers `capabilities`. `version`,
`launch`, `resume`, `read` and `context` answer exit 2, usage, naming the verb,
until the rows that fill them land.

## What it needs

- **Claude Code 2.1.280**, the release the adapter is measured against.
- **Deno 2.9.7**, which the ts pack pins. This pack imports ts rather than
  pinning a runtime of its own, and `fleet pack add` installs the two together.

Both are found on the `PATH` fleet runs the adapter with, which is fleet's own
environment. Where a service's environment does not carry the directory Claude
Code is installed in, name it with `FLEET_CLAUDE_BIN` (below).

## Installing it

Run `fleet create` on the machine first, then add the pack from this repository:

```sh
fleet pack add https://github.com/bembot90/fleet-packs//adapters/agent/claude-code --version main
```

`--version` takes a tag, a branch, or `sha:` and a full commit. The pack imports
ts from `../../../runtimes/ts`, which this repository holds, so the one add
installs both, pinned at the same commit:

```text
added claude-code main at <commit> — <machine>/packs/claude-code
added ts main at <commit>, which claude-code imports — <machine>/packs/ts
pinned in <machine>/packs.lock
```

## FLEET_CLAUDE_BIN

`FLEET_CLAUDE_BIN` names the claude to run, as an absolute path to the
executable. When it is unset or blank, the adapter runs the first `claude` on
`PATH`.

- An absolute path to an executable file is the claude every call runs, and
  `main.ts` grants Deno the right to run that path in place of `claude`.
- Any other value is refused, naming it: a call that would run claude answers
  could not tell (exit 3). The adapter never falls back to the `claude` on
  `PATH`, because a caller that named a claude meant that one.

## The Deno grant

`main.ts` is two lines of shell and then TypeScript. `/bin/sh` runs the file,
reads the second line, and replaces itself with Deno running the same file under
this grant:

```sh
deno run --no-config --no-prompt --quiet --allow-run=<claude> --allow-read --allow-write --allow-env=HOME,CLAUDE_CONFIG_DIR,FLEET_CLAUDE_BIN main.ts <verb>
```

| Flag                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--allow-run=<claude>`                                | Claude Code is the one program run: `claude`, or `$FLEET_CLAUDE_BIN` alone when that is an absolute path. A shebang line cannot carry the seam's value, because its arguments are fixed, which is why the first lines are shell.                                                                                                                                                                                  |
| `--allow-read`, `--allow-write`                       | The adapter reads the operator's `.claude.json` and each seat's transcript, and writes into the seat's config dir and worktree. The request names those directories, and Deno 2.9.7 cannot narrow a grant after it starts, so both are whole. Every write goes through one helper, `writeInside` in `lib/config_dir.ts`, which refuses a path resolving outside the request's config dir and the seat's worktree. |
| `--allow-env=HOME,CLAUDE_CONFIG_DIR,FLEET_CLAUDE_BIN` | The three variables the adapter reads. The rest of fleet's environment reaches claude without the adapter reading it.                                                                                                                                                                                                                                                                                             |
| `--no-config`                                         | Deno would otherwise read a `deno.json` beside the script or above it, and a checkout's config would change the adapter's imports.                                                                                                                                                                                                                                                                                |
| `--no-prompt`                                         | A permission the grant lacks is refused, never asked for on a terminal.                                                                                                                                                                                                                                                                                                                                           |
| `--quiet`                                             | Deno's own notes stay off stderr, whose last line is for people: without it, `--allow-run=claude` with no `claude` on `PATH` prints a note on every call.                                                                                                                                                                                                                                                         |

## The contract's types

`contract.json` is `fleet agent schema`'s output, byte for byte, and
`contract.d.ts` its types. Both are generated and committed; a hand-edited type
is a defect. Regenerate them against the fleet the pack is measured against, and
read the diff as the contract's change:

```sh
FLEET_BIN=/path/to/fleet deno task types
git diff --exit-code contract.json contract.d.ts
```

## Checking the pack

In the adapter's directory:

```sh
deno fmt --check
deno lint
FLEET_BIN=/path/to/fleet deno task test
```

With `FLEET_BIN` set, one arm runs `fleet guard` over sample payloads with this
adapter's directory and with no flag, and holds the two refusals to the same
bytes; without it that arm is ignored. No arm runs Claude Code.

`fleet pack check` over the pack, resolved above ts:

```sh
fleet pack check adapters/agent/claude-code --over runtimes/ts
```
