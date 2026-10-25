# fleet-adapters

The adapters [tinyfleet](https://github.com/tinyish/fleet) ships. Each is
one crate building one program that tinyfleet runs once per request: the
request as one JSON object on stdin, the answer as one on stdout. Each is
built on the kit of `fleet-adapter-sdk`, which tinyfleet's repository
holds and these crates take by its tag, and each passes its conformance
checks.

| Directory | Adapts | Protocol |
| --- | --- | --- |
| `agents/` | coding agents, such as Claude Code | `fleet_adapter_sdk::agent` (tinyfleet's `crates/adapter-sdk/src/agent.rs`) |
| `trackers/` | task trackers, such as beads | not defined yet |
| `forges/` | where work lands, such as GitHub | not defined yet |

| Crate | Program | Adapts |
| --- | --- | --- |
| `agents/claude-code` | `fleet-claude-code` | Claude Code |

## Releases

An adapter's version is its agent's: the version of the agent it is
measured against (claude-code `2.1.285` is for Claude Code 2.1.285), with a
revision `-<n>`, from 2, when the adapter is fixed and the agent has not
moved (`2.1.285-2`). Each adapter is released on its own: pushing the tag
`<name>-v<version>`, where the version is the one in its crate's
`Cargo.toml`, runs `.github/workflows/release.yml`. It runs the adapter's tests, its
conformance checks included, builds it for the four targets fleet ships
(macOS and Linux, arm64 and x86_64, Linux statically linked), and creates
the release `<name>-v<version>` holding:

- `fleet-<name>-<target>`, the program for each target;
- `manifest.json`: its `name`, `version`, the `protocol` it speaks (asked
  of the Linux x86_64 build itself) and each target's SHA-256.

tinyfleet fetches a release the first time a config names
`<name>@<version>`, checks it against the manifest, and keeps it. A release
is never overwritten: a fix is a new version.

The v1 packs are kept, unread, at the tag `archive/v1`.
