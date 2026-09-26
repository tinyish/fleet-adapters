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

**Status:** the pack answers `capabilities`, `context` and `read`. `version`,
`launch` and `resume` answer exit 2, usage, naming the verb, until the row that
fills them lands.

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

## What `context` answers

`context` reads each seat's transcript, the file Claude Code writes the session
to, and runs no claude. The file is
`<config dir>/projects/<worktree>/<session id>.jsonl`, where `<worktree>` is the
seat's worktree, resolved through any symlink on its way, with every character
that is not a letter or a digit replaced by `-`, and the config dir is the
seat's `config_dir`, or for a seat without one, `CLAUDE_CONFIG_DIR`, else
`~/.claude`. Each seat answers:

- `tokens`: the input tokens and both cache figures of the last assistant entry
  on the session's own chain whose sum is not zero. A subagent's entries and an
  entry Claude Code wrote for a turn that made no model call are skipped.
- `turns`: the model responses on the session's own chain, the zero-usage ones
  included. Claude Code 2.1.280 writes one response as an entry per content
  block, all under one message id, and those count once.
- `last_write`: the transcript's modification time, to the second, in UTC.
- `window` is never answered: the transcript does not state it.

A seat with no `session_id`, or whose transcript is not there or cannot be read,
answers its `seat` alone. So does a worktree with a character outside ASCII,
whose encoding has not been measured. A transcript that holds no turn answers
`turns: 0`.

## The context fixtures

`fixtures/context/<case>/` holds `request.json`, where `{fixture}` stands for
the case's own directory, `answer.json`, the answer without `schema_version`,
and the transcripts under `config/`. `test/context_test.ts` gives each
transcript the modification time its answer names before it runs `main.ts`,
because a checkout does not keep one.

The transcripts were recorded on Claude Code 2.1.280 on 2026-09-26: interactive
sessions on Haiku 4.5, each started as the command of its own tmux session on a
scratch socket, under a scratch config dir seeded with the onboarding keys and
the worktree's trust, with `DISABLE_AUTOUPDATER=1`. Each attachment entry's body
and rendered text were removed, because they carry the session's system context,
the operator's identity among it. No other line was changed.

| Case                    | What was recorded                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subagent`              | Two turns, the second running one subagent. The subagent's entries are in `<session>/subagents/`, not in the session's file.                                                                    |
| `zero-usage-last`       | The same session resumed logged out for one more turn, which ends in the `authentication_failed` entry with no usage.                                                                           |
| `logged-out-first-turn` | A session started logged out: its first turn is the `authentication_failed` entry.                                                                                                              |
| `dotted-worktree`       | One turn in `/private/tmp/jymr4-rec/wt a_b.c`, whose transcript is under `-private-tmp-jymr4-rec-wt-a-b-c`.                                                                                     |
| `sidechain-after-main`  | Derived from `subagent`: the subagent's entries appended to the session's file after its last entry, the case the sidechain skip is for.                                                        |
| `torn-final-line`       | Derived from `dotted-worktree`: the file cut halfway through its last assistant entry.                                                                                                          |
| `no-reading`            | Derived from `subagent`: the lines before its first assistant entry. Beside it, a seat with no session id, a session with no file, and a worktree with `é` whose dash-encoded directory exists. |

## What `read` answers

`read` answers what the agent in each seat's live session is doing. Whether the
session exists and its pane is alive is fleet's to read, from tmux, and never
this adapter's.

The seats are grouped by config dir, as `context` names it, and each dir is
listed once with `claude agents --json --all`, run with `CLAUDE_CONFIG_DIR` set
to it, because a config dir scopes the listing. The listings run at once.

A seat's session is the listing's interactive row carrying the seat's
`session_id`. Where no row carries it, or the request has none, it is the
interactive row whose `pid` is the seat's pane's. A background row is never a
seat's, and a seat is never found by its worktree. Each seat answers:

| The listing                                                         | `activity` | `blocked_on` | `evidence` |
| ------------------------------------------------------------------- | ---------- | ------------ | ---------- |
| The row's `waitingFor` is `permission prompt`                       | `blocked`  | `permission` | `typed`    |
| The row carries any other `waitingFor`                              | `blocked`  | —            | `typed`    |
| The row's `status` is `idle`, and its first turn was not logged out | `idle`     | —            | `typed`    |
| The row's `status` is `idle`, and its first turn was logged out     | `blocked`  | `logged_out` | `typed`    |
| The row's `status` is `busy`                                        | `busy`     | —            | `typed`    |
| The row's `status` is `waiting`, with no `waitingFor`               | `blocked`  | —            | `typed`    |
| The row carries no `status`, or one of any other word               | `unknown`  | —            | `typed`    |
| No row, and the screen shows the workspace-trust question           | `blocked`  | `question`   | `screen`   |
| No row                                                              | `starting` | —            | `typed`    |
| The listing could not be read                                       | `unknown`  | —            | `typed`    |

A seat whose session was found answers the row's `sessionId` as `session_id`, so
a seat known only by its pane learns its session. The first turn is logged out
where the session's transcript begins with the `authentication_failed` entry
Claude Code writes in place of a model call. `usage_limit` is never answered:
its shape has not been measured.

A listing could not be read where it exits non-zero, answers zero bytes, or
answers rows that do not parse. Every seat under that dir answers `unknown`,
with `cause` saying which, and every other dir is read as usual. An empty array
is a listing that answered.

On Claude Code 2.1.280 the listing starts no background daemon, so it runs under
fleet's own environment, as every call of this adapter does.

## The read fixtures

`fixtures/read/<case>/` holds `request.json` and `env.json`, where `{fixture}`
stands for the case's own directory, and `answer.json`, the answer without
`schema_version`. `env.json` names `fixtures/read/claude` as `FLEET_CLAUDE_BIN`.
That script answers `agents --json --all` and nothing else: under each config
dir a case holds, `listing.json` is the listing's standard output byte for byte,
and `listing.exit` and `listing.stderr`, where present, its exit code and
standard error.

The listings were recorded on Claude Code 2.1.280 on 2026-09-26: interactive
sessions on Haiku 4.5, each started as the command of its own tmux session on a
scratch socket, under a scratch config dir seeded with the onboarding keys and
the worktree's trust, with `DISABLE_AUTOUPDATER=1`, and listed under a cleared
environment scoped to that dir. Each attachment entry's body and rendered text
were removed from the two transcripts, as for the context fixtures, and the
account's plan from the banner of the waiting screen; no other recorded byte was
changed.

| Case                    | What was recorded                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`                  | One session at its prompt after five turns, and its transcript, whose first turn answered.                                                                                          |
| `busy`                  | The same session mid-turn.                                                                                                                                                          |
| `waiting-permission`    | The same session at a Bash approval, `waitingFor: "permission prompt"`, with the pane as it was.                                                                                    |
| `two-rows-one-worktree` | A second session in the same worktree and config dir: one seat found by its session id, one by its pane's pid alone, and one whose pid no row carries.                              |
| `empty-listing`         | A config dir with no session: `[]`.                                                                                                                                                 |
| `trust-question`        | A session in a worktree with no trust entry: the listing `[]` while the question is up, and the pane showing it.                                                                    |
| `logged-out`            | A session started without the credential scope, found by its pane's pid: an idle row, and a transcript whose first turn is `authentication_failed`.                                 |
| `unknown-field`         | Derived from `idle`: one field no reader names added to the row.                                                                                                                    |
| `background-row`        | Derived: a background row, the shape of the daemon era, carrying the seat's session id and pid. It is never a seat's.                                                               |
| `zero-bytes`            | Derived: zero bytes and exit 0, the unreadable listing of lessons B4, seen on a release nobody recorded, which cannot be made on demand.                                            |
| `one-dir-fails`         | Three config dirs: the `two-rows-one-worktree` listing, a second dir's own recorded session, and a derived listing that exits 1. A seat is seen only through its own dir's listing. |

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
bytes; without it that arm is ignored. No arm runs Claude Code: `context`'s arms
read the recorded transcripts, and `read`'s replay the recorded listings through
`fixtures/read/claude`.

`fleet pack check` over the pack, resolved above ts:

```sh
fleet pack check adapters/agent/claude-code --over runtimes/ts
```
