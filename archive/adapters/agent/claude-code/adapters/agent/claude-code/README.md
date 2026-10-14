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

**Status:** the pack answers all six verbs, and carries fleet's Claude Code
plugin, `plugin/` beside `main.ts`, which `launch` and `resume` load into every
seat (see [The plugin](#the-plugin)).

The pack also carries two doctor checks, `doctor/claude-code-version/` and
`doctor/isolation-pair/`, which `fleet doctor` lists from the installed pack.

## What it needs

- **Claude Code 2.1.280**, the release the adapter is measured against.
- **Deno 2.9.7**, which the ts pack pins. This pack imports ts rather than
  pinning a runtime of its own, and `fleet pack add` installs the two together.

- **The operator's own Claude Code login**, for a spawned seat: `launch` copies
  the onboarding keys from `$CLAUDE_CONFIG_DIR/.claude.json`, or
  `~/.claude.json` where that variable is not set (see
  [What `launch` answers](#what-launch-answers)).

Claude Code and Deno are found on the `PATH` fleet runs the adapter with, which
is fleet's own environment. Where a service's environment does not carry the
directory Claude Code is installed in, name it with `FLEET_CLAUDE_BIN` (below).

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

## What `version` answers

`version` runs `claude --version` and answers `{"name": "claude", "version": …}`
with the first word it printed, such as `2.1.280`. `version` is `null` where
claude cannot be run, `FLEET_CLAUDE_BIN` names no executable, claude exits
non-zero or prints nothing, or it has not answered within 10 seconds. A `null`
is still an answer, exit 0. Whether the version is one the pack was measured
against is fleet's to compare, with `measured` in `capabilities`.

## What `launch` answers

`launch` answers the seat's session as the command of the seat's tmux pane,
`argv`, and the variables of its environment, `env`. The session is an
interactive Claude Code:

```text
<claude> --name <name> --model <model> --permission-mode <mode> --plugin-dir <plugin> <first turn>
```

- `<claude>` is `$FLEET_CLAUDE_BIN`, or `claude`.
- `<mode>` is the posture's: `ask` is `default`, `auto` is `auto`, and
  `unattended` is `dontAsk`. A launch or resume with any other posture is
  refused, exit 1, `unsupported`, naming the word and the three.
- `<plugin>` is the pack's own `plugin/` directory, beside `main.ts`. A request
  never names it, and no fleet setting does.
- The model and the posture are always named: on Claude Code 2.1.280 a start
  that names neither comes up on Opus 5.5, in auto mode.

`env` is the request's `env` with three variables over it:

| Variable                          | Value                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CONFIG_DIR`               | The seat's `config_dir`, or for a seat without one, the operator's: `CLAUDE_CONFIG_DIR`, else `~/.claude`. It is the directory `read` lists the seat under.                                                                                       |
| `CLAUDE_SECURESTORAGE_CONFIG_DIR` | `CLAUDE_CONFIG_DIR` as fleet's environment carries it, and set but empty where it carries none. Claude Code looks up the login by this variable, and an unset one looks it up under a name taken from the seat's config dir, which is logged out. |
| `DISABLE_AUTOUPDATER`             | `1`, so no seat upgrades Claude Code under the operator. Every claude the adapter runs itself carries it too.                                                                                                                                     |

**A spawned seat's config dir is seeded** before `launch` answers, because an
interactive Claude Code under an empty config dir stops at the theme picker and
the login menu, and at the question whether to trust the worktree, before any
session exists. `launch` writes `<config_dir>/.claude.json`, mode `0600`, merged
into any file already there:

- `hasCompletedOnboarding`, `lastOnboardingVersion` and `oauthAccount`, copied
  from the operator's own `.claude.json`, and `theme` where that file has one. A
  file missing one of the three is could not tell, exit 3, naming the key, and
  nothing is written. Nothing else of the operator's is copied.
- `projects.<worktree>.hasTrustDialogAccepted: true`, for the seat's own
  worktree, resolved through any symlink, and for no other directory.

**A spawned seat's permissions are rendered** into its worktree's
`.claude/settings.local.json` before `launch` answers, because Claude Code reads
that file once, as the session comes up (see
[The permissions](#the-permissions)). A file already standing there, one a
project tracks on its trunk, is merged into rather than replaced. A standing
file that cannot be read, or is not JSON the rules can be folded into, is could
not tell, exit 3, and so is a write that does not read back; a
`permissions.commands` entry that is not one command word is exit 2, naming it.
Both refusals come before anything is written.

A seat without a `config_dir` is one fleet did not make the worktree of, so
`launch` writes nothing for it: no seed, no trust and no permission rules,
whatever permissions the request carries. Every write goes through
`writeInside`, and a config dir that is itself a symlink is refused, exit 3.

## The permissions

What a spawned seat runs without asking is fleet's to say and Claude Code's to
enforce. `lib/permissions.ts` holds fleet's part in fleet's words, the lists the
seat's rules are rendered from:

- **Commands allowed**, each one command word matched as the first of the
  command line: `bd`, `fleet`, `git`, `sh`, `bash`, and the plain read and file
  verbs, `echo` through `false`.
- **Command lines refused**, each matched as a prefix, where `*` stands for any
  run of characters: `git push origin HEAD:main`, `git push origin main`,
  `git push --force`, `git push -f` followed by a space, and
  `git push * --delete`.
- **The worktree**, the one path the seat writes.

The request adds the rest in the same words (fleet's
[docs/agent.md](https://github.com/bembot90/tinyfleet/blob/main/docs/agent.md),
Permissions): `commands`, the project's `[permissions] tool_commands`, and
`touched`, the builder's checks, the one command line its dispatch was handed.

Rendered, the seat's `permissions.allow` is `Bash(<word>:*)` for each allowed
command, in that order, then `Bash(<touched>:*)` where the request carries a
`touched` that is not blank, then `Edit(/<worktree>/**)`, then `Bash(<word>:*)`
for each of the request's `commands` not already there, in the order given.
`permissions.deny` is the four Claude Code tools a seat is denied,
`AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode` and `mcp__*__request_access`,
then `Bash(<line>*)` for each refused line. Where the worktree already holds the
file, its own keys are kept, its rules stand first in their order, and a rule it
already carries is not added twice.

These are the rules fleet's own spawn rendered from its layers' permissions
template until this pack carried them. `fixtures/permissions/<case>.json` is
that render's document for the worktree `/work/lanes/builder-e5f60718`, recorded
by running fleet's in-process render at tinyfleet `dbc7908`, and
`test/permissions_test.ts` holds this render equal to each as JSON:

| Case            | `commands`            | `touched`                   |
| --------------- | --------------------- | --------------------------- |
| `touched`       | none                  | `make check`                |
| `untouched`     | none                  | none                        |
| `quoted`        | none                  | `make check ARGS="-p core"` |
| `tool-commands` | `make`, `cargo`, `sh` | `make check`                |

## The plugin

`plugin/` is fleet's Claude Code plugin. `launch` and `resume` name it with
`--plugin-dir` on every seat, so a seat comes up with fleet's guards, its
session prime, the `fleet` command on its Bash tool's `PATH`, and the tiny
pack's rituals, `/wake` among them.

| Path                         | What it is                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json` | The manifest: the plugin `fleet`, at this pack's version.                                                 |
| `hooks/hooks.json`           | Two hooks, each run through the plugin's own `bin/fleet`.                                                 |
| `bin/fleet`                  | The shim every hook runs, and the `fleet` a seat's Bash tool finds: it runs the binary `FLEET_BIN` names. |
| `skills/version/`            | The plugin's own probe: it runs `fleet --version` and reports what it printed.                            |
| `skills/<name>/`             | The tiny pack's twelve skills, `adopt` through `wake`, copied from this repository's `tiny/skills/`.      |

### The hooks

- **Before every Bash command**, `fleet guard --adapter claude-code`. With no
  class named, `fleet guard` runs every guard class the fleet's pack layers
  declare, in class order, and prints the first refusal. The refusal is Claude
  Code's pre-tool decision, one JSON object on standard output, in the shape
  `adapter.toml`'s `[hook]` declares:
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<the reason>"}}`.
  A command no class refuses prints nothing, and Claude Code goes on to its own
  permission rules.
- **When a session starts**, `fleet prime`, whose output Claude Code hands the
  session as context.

Each hook is addressed through `${CLAUDE_PLUGIN_ROOT}`: measured on Claude Code
2.1.280, a hook's environment carries that variable and no `bin/` of the plugin
on its `PATH`. The Bash tool's `PATH` does carry the plugin's `bin/`, appended
last, so a `fleet` earlier on a seat's `PATH` is the one its commands run.

A guard fails closed. On a machine whose pack layers do not resolve, one where
neither `fleet create` nor `fleet start` has written the defaults,
`fleet guard --adapter claude-code` exits 2, which Claude Code reads as a block,
so every Bash command in the session is refused until the fleet is set up.

### Which fleet the plugin runs

`bin/fleet` runs the binary `FLEET_BIN` names, and nothing else: it never looks
on `PATH` or for a build. fleet sets `FLEET_BIN` to its own executable on every
seat it launches. A session of your own that loads the plugin needs it set once,
in your shell profile:

```sh
export FLEET_BIN=/absolute/path/to/fleet
```

Where `FLEET_BIN` is not set, is not an absolute path, or names no executable
file, the shim says so on standard error and exits by who asked:

| Caller                                 | Exit | What Claude Code does                                                |
| -------------------------------------- | ---- | -------------------------------------------------------------------- |
| the guard hook                         | 2    | blocks the Bash command, with the shim's words as the reason         |
| the session-start hook, `fleet prime`  | 127  | starts the session without fleet's context, showing the shim's words |
| any other `fleet`, `guard --check` too | 127  | reports a command that could not run, with no word of a block        |

### Loading it in a session of your own

The repository's root carries `.claude-plugin/marketplace.json`, a marketplace
named `fleet` that lists this one plugin. With `FLEET_BIN` set:

```sh
claude plugin marketplace add https://github.com/bembot90/fleet-packs
claude plugin install fleet@fleet
```

A local checkout of fleet-packs is a marketplace too, by its path. For one
session only:
`claude --plugin-dir <fleet-packs>/adapters/agent/claude-code/adapters/agent/claude-code/plugin`.

### The skills are copies

The tiny pack's skills are copied into `plugin/skills/`, not linked. Measured on
2026-09-26, on Claude Code 2.1.280 and fleet at tinyfleet `dbc7908`: a relative
link from `plugin/skills/` to `tiny/skills/` survives `claude plugin install`
from a checkout, whose copy into the plugin cache follows it, but not
`fleet pack add`, which installs this pack's directory alone under the machine's
`packs/`, where a link climbing out of it resolves nowhere; and that directory
is the plugin every seat is launched with. So the copies are committed, and
`test/plugin_test.ts` holds each to `tiny/skills/` byte for byte. After changing
a skill in `tiny/`, copy it again:

```sh
deno task skills
```

## What `resume` answers

`resume` answers a new pane's command that resumes the seat's session by its
full id, with the start's model, posture and plugin:

```text
<claude> --resume <session id> --model <model> --permission-mode <mode> --plugin-dir <plugin>
```

`env` is the same three variables `launch` answers. Measured on Claude Code
2.1.280, a session resumed this way comes back under the same session id, name,
model, posture and transcript. `resume` writes nothing, and does not ask Claude
Code whether it has the session; a blank session id is refused, exit 1,
`missing`.

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

## The lessons

`LESSONS.md` is what this adapter knows about Claude Code, measured rather than
read: the entries its behaviour rests on, each carrying the release it was
measured on, 2.1.280 among them, and the test that holds the adapter to it,
`test/lessons/<slug>.test.ts`. They moved here from fleet's own
`brain/lessons/claude-code.md`, which keeps the daemon-era entries fleet retired
and the facts about the host and fleet's own loop, under the same ids. The table
at the foot of `LESSONS.md` names each test and its file, and
`test/lessons_test.ts` holds the two in step and every entry to a Version line
for each release `measured` names. The arms of D5 and D6 read the plugin under
`plugin/` and are ignored where it is not there.

## The doctor checks

`fleet doctor` lists both from the installed pack, in place of the copies
fleet's own defaults carry. Each runs the claude the adapter runs:
`$FLEET_CLAUDE_BIN`, or the first `claude` on `PATH`. A `FLEET_CLAUDE_BIN` that
is not an absolute path is broken, as the adapter refuses it.

- `claude-code-version` holds when `claude --version` answers `2.1.280`, the
  last entry of `measured`, and is broken, with the line that installs it, when
  it answers another version or does not answer. The suite holds its copy of the
  version equal to `measured`'s.
- `isolation-pair` asks `claude auth status` under a scratch config dir twice:
  with `CLAUDE_SECURESTORAGE_CONFIG_DIR` set but empty, which must be logged in,
  and with it unset, which must be logged out. It holds when both answer so. It
  starts no session.

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
bytes, and two run the plugin's shim and its guard line over that binary;
without it those arms are ignored. No arm runs Claude Code: `context`'s arms
read the recorded transcripts, `read`'s replay the recorded listings through
`fixtures/read/claude` (the lessons arms replay listings they make up through it
too), and every other claude is a script the arm writes.

The plugin, and the marketplace at the repository's root, validate with Claude
Code itself:

```sh
claude plugin validate plugin
claude plugin validate ../../../../../..
```

`fleet agent check` over the adapter, offline, and against Claude Code itself. A
`launch` seeds its scratch config dir from `~/.claude.json`, so the offline
check needs one carrying the three onboarding keys; the live one costs model
turns:

```sh
fleet agent check --adapter "$PWD/main.ts"
fleet agent check --adapter "$PWD/main.ts" --live --model haiku
```

`fleet pack check` over the pack, resolved above ts:

```sh
fleet pack check adapters/agent/claude-code --over runtimes/ts
```

CI runs all of these but the live check on every push, from a fleet-packs
checkout, through `ci/check-claude-code.sh` at the repository's root, and the
live check on demand and nightly through `ci/check-claude-code-live.sh`; the
repository's README says how.
