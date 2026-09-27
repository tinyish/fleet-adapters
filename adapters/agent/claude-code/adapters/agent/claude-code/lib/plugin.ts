// The Claude Code plugin every seat is launched with: this adapter's own
// plugin/ directory, beside main.ts. It is the adapter's to know and never a
// field of a request (Reviewer call 2026-09-25, E8), so no fleet names it.
// fleet-jymr.5 fills the directory — the manifest, the hooks, the shim, the
// skills. Until then it is not there, and Claude Code 2.1.280 starts all the
// same: measured 2026-09-26 (fleet-jymr.2), an interactive start given a
// --plugin-dir that does not exist, and one given an empty directory, each
// came up idle with no dialog.

/** The plugin directory, as an absolute path read off this file's own. */
export function pluginDir(): string {
  return decodeURIComponent(new URL("../plugin", import.meta.url).pathname);
}
