// verbs/version.ts: which claude answers, and at which version — the first
// token of `claude --version` (parse_version, claude_code.rs at tinyfleet
// 807107b), or null where claude cannot run, exits non-zero, or says nothing.
// Comparing it with `measured` is core's (ruling 8). Every claude here is a
// script.

import { assertEquals } from "@std/assert";
import { parseVersion, versionWith } from "../verbs/version.ts";
import { call } from "./helpers.ts";

async function aClaude(body: string) {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const claude = `${dir}/claude`;
  await Deno.writeTextFile(claude, `#!/bin/sh\n${body}\n`);
  await Deno.chmod(claude, 0o755);
  return {
    dir,
    claude,
    [Symbol.asyncDispose]: () => Deno.remove(dir, { recursive: true }),
  };
}

function env(vars: Record<string, string>) {
  return (name: string) => vars[name];
}

/**
 * The answering claude is asked with the auto-updater off, as every child the
 * pack runs is: this one exits 1 unless it is.
 */
const PINNED_SAYS = [
  '[ "$1" = --version ] || exit 9',
  '[ "$DISABLE_AUTOUPDATER" = 1 ] || exit 1',
  'echo "2.1.280 (Claude Code)"',
].join("\n");

Deno.test("parseVersion: the first token, or null", () => {
  assertEquals(parseVersion("2.1.280 (Claude Code)\n"), "2.1.280");
  assertEquals(parseVersion("  2.1.280\n"), "2.1.280");
  assertEquals(parseVersion(""), null);
  assertEquals(parseVersion(" \n "), null);
});

Deno.test("version: claude's own version, named claude", async () => {
  await using c = await aClaude(PINNED_SAYS);
  const answered = await versionWith(
    env({ HOME: "/home/op", FLEET_CLAUDE_BIN: c.claude }),
  )({ schema_version: 1, root: "/r" });
  assertEquals(answered, { name: "claude", version: "2.1.280" });
});

Deno.test("version: a claude that exits non-zero, or says nothing, is null", async () => {
  for (const body of ['echo "2.1.280 (Claude Code)"; exit 1', "exit 0"]) {
    await using c = await aClaude(body);
    const answered = await versionWith(
      env({ HOME: "/home/op", FLEET_CLAUDE_BIN: c.claude }),
    )({ schema_version: 1, root: "/r" });
    assertEquals(answered, { name: "claude", version: null }, body);
  }
});

Deno.test("version: a claude that cannot run, or outruns the bound, is null", async () => {
  await using c = await aClaude("exec sleep 30");
  const started = Date.now();
  const slow = await versionWith(
    env({ HOME: "/home/op", FLEET_CLAUDE_BIN: c.claude }),
    200,
  )({ schema_version: 1, root: "/r" });
  assertEquals(slow.version, null);
  assertEquals(Date.now() - started < 5_000, true);
  for (const seam of [`${c.dir}/absent`, "relative/claude"]) {
    const answered = await versionWith(
      env({ HOME: "/home/op", FLEET_CLAUDE_BIN: seam }),
    )({ schema_version: 1, root: "/r" });
    assertEquals(answered, { name: "claude", version: null }, seam);
  }
});

/** Through the executable: null with no claude on PATH still answers, exit 0. */
Deno.test("main.ts version: answers the seam's claude, and null with none", async () => {
  await using c = await aClaude(PINNED_SAYS);
  const request = JSON.stringify({ schema_version: 1, root: "/r" });
  const found = await call("version", request, { FLEET_CLAUDE_BIN: c.claude });
  assertEquals([found.exit, found.answer], [0, {
    schema_version: 1,
    name: "claude",
    version: "2.1.280",
  }], found.stderr);
  // Deno's own directory, which main.ts's first lines exec through, and no
  // claude: the claude on this machine's PATH is not asked.
  const deno = Deno.execPath();
  const none = await call("version", request, {
    FLEET_CLAUDE_BIN: "",
    PATH: `${deno.slice(0, deno.lastIndexOf("/"))}:/usr/bin:/bin`,
  });
  assertEquals([none.exit, none.answer], [0, {
    schema_version: 1,
    name: "claude",
    version: null,
  }], none.stderr);
});
