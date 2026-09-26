# Agent adapters

One pack per agent adapter lives here, each in a directory named for the agent
runtime it adapts: the one a fleet's seats run on. A fleet installs one with
`fleet pack add <fleet-packs>//adapters/agent/<name>`.

- `claude-code/`: Claude Code 2.1.280 behind the agent contract, with the
  mapping of its pre-tool hook. Its README is in the adapter's own directory,
  `claude-code/adapters/agent/claude-code/README.md`, because a pack's top level
  holds only `pack.toml` and the eight slots.
