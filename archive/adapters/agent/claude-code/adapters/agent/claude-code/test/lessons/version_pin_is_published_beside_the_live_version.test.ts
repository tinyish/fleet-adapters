// lessons A1 — the pin is a measurement, not a version number. The pack
// declares the releases it was measured on (capabilities' `measured`), and
// answers the version the binary reports this call (`version`); fleet
// publishes the two side by side and a spread between them is a flag, which
// is core's comparison (ruling 8, its own core arm). Held here: `measured` is
// A1's own Version, and the live version is answered as the binary says it,
// never rounded to the pin.

import { assert, assertEquals } from "@std/assert";
import { CAPABILITIES, PINNED } from "../../lib/capabilities.ts";
import { versionWith } from "../../verbs/version.ts";
import { entry } from "../lessons_support.ts";

/** The releases A1's own Version lines name as the pin's. */
function a1Releases(): string[] {
  return [...entry("A1").text.matchAll(/^- \*\*Version (\d+\.\d+\.\d+):\*\*/gm)]
    .map((m) => m[1]);
}

Deno.test("lessons::version_pin_is_published_beside_the_live_version", async () => {
  // measured is A1's Version: the pin, last, with a Version line of its own.
  assertEquals(a1Releases(), ["2.1.280"]);
  assertEquals(CAPABILITIES.measured, a1Releases());
  assertEquals(CAPABILITIES.measured.at(-1), PINNED);
  assert(
    entry("A1").text.replace(/\s+/g, " ").includes(
      `\`--version\` answers \`${PINNED} (Claude Code)\``,
    ),
    "A1 records what the pin's binary answers",
  );

  // Beside it, the live version is the binary's own, whatever it is: a
  // release past the pin is answered as that release, and the pin is not
  // what version says.
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const claude = `${dir}/claude`;
    await Deno.writeTextFile(
      claude,
      '#!/bin/sh\n[ "$1" = --version ] || exit 9\necho "2.1.283 (Claude Code)"\n',
    );
    await Deno.chmod(claude, 0o755);
    const vars: Record<string, string> = {
      HOME: dir,
      FLEET_CLAUDE_BIN: claude,
    };
    const live = await versionWith((name) => vars[name])({
      schema_version: 1,
      root: "/r",
    });
    assertEquals(live, { name: "claude", version: "2.1.283" });
    assert(!CAPABILITIES.measured.includes(live.version!));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
