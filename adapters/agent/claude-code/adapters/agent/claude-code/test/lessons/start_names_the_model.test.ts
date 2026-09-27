// lessons A5 — a start must name the model; the default is not the fleet's.
// Measured on 2.1.280 (fleet-031): a start naming no model came up on Opus
// 5.5, and naming no posture came up in auto — both the agent's defaults,
// neither the fleet's. So every launch names the request's model, and its
// posture, and a `--name` value can never swallow the flag after it.

import { assertEquals, assertNotEquals } from "@std/assert";
import { envelope, main, REPLAY } from "../lessons_support.ts";

const SEAT = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718";

function aLaunch(model: string, name = "builder-e5f60718") {
  const { seats: _, ...head } = envelope([]);
  return {
    ...head,
    seat: SEAT,
    name,
    model,
    posture: "auto",
    first_turn: `/wake ${name}`,
    env: { FLEET_ACTOR: `seat:${SEAT}` },
    permissions: { commands: [] },
    worktree: "/work/project",
    config_dir: null,
  };
}

/** The value after `flag` in `argv`, which must be there. */
function after(argv: string[], flag: string): string {
  const at = argv.indexOf(flag);
  assertNotEquals(at, -1, `${flag} is not in ${JSON.stringify(argv)}`);
  return argv[at + 1];
}

Deno.test("lessons::start_names_the_model", async () => {
  const home = await Deno.makeTempDir({ prefix: "lessons-a5-" });
  try {
    const launch = async (model: string, name?: string) => {
      const called = await main("launch", aLaunch(model, name), {
        HOME: home,
        FLEET_CLAUDE_BIN: REPLAY,
      });
      assertEquals(called.exit, 0, called.stderr);
      return called.answer!.argv as string[];
    };

    const argv = await launch("claude-opus-5");
    assertEquals(after(argv, "--model"), "claude-opus-5");
    assertEquals(after(argv, "--permission-mode"), "auto");
    assertEquals(after(argv, "--name"), "builder-e5f60718");
    assertEquals(
      argv[argv.indexOf("--name") + 2],
      "--model",
      "the flag after the name's value is --model, not its argument",
    );
    assertEquals(argv.at(-1), "/wake builder-e5f60718");

    // The control: another model reaches the argv as itself, so the reading
    // above is the request's and not a constant in the adapter.
    assertEquals(
      after(await launch("claude-sonnet-5"), "--model"),
      "claude-sonnet-5",
    );
    // And a name that looks like a flag is still the name's value.
    const odd = await launch("claude-haiku-4-5", "--model");
    assertEquals(after(odd, "--name"), "--model");
    assertEquals(odd[odd.indexOf("--name") + 2], "--model");
    assertEquals(odd[odd.indexOf("--name") + 3], "claude-haiku-4-5");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
