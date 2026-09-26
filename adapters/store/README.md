# Store adapters

One pack per store adapter lives here, each in a directory named for the store
it adapts: the work graph a fleet reads and writes items through. A fleet
installs one with `fleet pack add <fleet-packs>//adapters/store/<name>`.

- `bd/`: the beads store, bd 1.3.0 behind the store contract, with its
  `bd-version` doctor check. Its README is in the adapter's own directory,
  `bd/adapters/store/bd/README.md`, because a pack's top level holds only
  `pack.toml` and the eight slots.
