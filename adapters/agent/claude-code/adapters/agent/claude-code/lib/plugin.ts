// The Claude Code plugin every seat is launched with: this adapter's own
// plugin/ directory, beside main.ts. It is the adapter's to know and never a
// field of a request (Reviewer call 2026-09-25, E8), so no fleet names it.
// It holds fleet's plugin (fleet-jymr.5): the manifest, the hooks, the shim
// and the skills (README, The plugin). Were it missing, Claude Code 2.1.280
// would start all the same: measured 2026-09-26 (fleet-jymr.2), an
// interactive start given a --plugin-dir that does not exist, and one given
// an empty directory, each came up idle with no dialog.

/** The plugin directory, as an absolute path read off this file's own. */
export function pluginDir(): string {
  return decodeURIComponent(new URL("../plugin", import.meta.url).pathname);
}
