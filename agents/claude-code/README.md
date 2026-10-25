# fleet-claude-code

tinyfleet's adapter for Claude Code. tinyfleet runs it as
`fleet-claude-code <verb>` with one JSON object on stdin and reads one from
stdout. It exits 0 with an answer, 1 when it cannot answer (why on stderr),
and 2 for a verb it does not know.

Built on fleet-adapter-sdk's kit; its conformance checks run in
`tests/conformance.rs`.

## launch

Answers with `claude` by its absolute path on the `PATH`, then
`--model=<model>` as one argument when a model is asked for, then `--` and
the prompt when there is one, so neither is ever read as one of Claude's
flags. When `CLAUDE_CONFIG_DIR` is set, it is handed on to the agent. It
runs nothing: tinyfleet starts the session.

## read

For each session, reads the file Claude Code keeps for every running
session, `<config>/sessions/<pid>.json`, where `<config>` is
`$CLAUDE_CONFIG_DIR`, or `~/.claude`. A relative `CLAUDE_CONFIG_DIR` is
passed over, for launch and read alike, since the adapter and Claude would
each read it from a different directory.

| The file | Activity | Reason |
| --- | --- | --- |
| missing, or for another pid | `starting` | |
| `status: busy` | `working` | |
| `status: idle` | `idle` | |
| `status: waiting`, `waitingFor` holding "permission" | `needs_you` | `permission` |
| `status: waiting`, `waitingFor` holding "input" | `needs_you` | `question` |
| `status: waiting`, anything else | `needs_you` | |
| any other status, or a file that cannot be read or does not read | `unknown` | |

Measured on Claude Code 2.1.285, 2026-10-23. A directory Claude has not been
told to trust shows its trust dialog and writes no session file, so such a
session reads `starting` until the dialog is answered.
