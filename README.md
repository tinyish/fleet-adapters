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

The v1 packs are kept, unread, at the tag `archive/v1`.
