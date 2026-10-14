// lessons B3 — the display name is not an address and not a key. The rule
// held on 2.1.280: `--name` was kept on every read and a resume came back
// under it (fleet-jymr.3, fleet-rge6.4), but forks inherit the name they
// copied and a rename need not propagate, so one name can stand on several
// rows. A seat is found by its session id, else by its pane's pid, and a
// row's name is never read; a resume names no name, because the session
// has one.

import { assertEquals } from "@std/assert";
import { main, readOver, REPLAY } from "../lessons_support.ts";

const SEAT = "0199a3c4-0000-7000-8000-0000000023a0";
const NAME = "builder-23a0";

Deno.test("lessons::the_name_is_not_an_address", async () => {
  // Three rows under the seat's own name, as forks leave them: the one whose
  // pid is the pane's is the seat's, and the others are nobody's.
  const forks = JSON.stringify([
    {
      sessionId: "fork-1",
      kind: "interactive",
      pid: 11,
      status: "busy",
      name: NAME,
      startedAt: 30,
    },
    {
      sessionId: "mine",
      kind: "interactive",
      pid: 22,
      status: "idle",
      name: NAME,
      startedAt: 10,
    },
    {
      sessionId: "fork-2",
      kind: "interactive",
      pid: 33,
      status: "busy",
      name: NAME,
      startedAt: 20,
    },
  ]);
  const seen = await readOver({ config: forks }, (dir) => [
    { seat: SEAT, pid: 22, config_dir: dir.config, worktree: "/w" },
    { seat: SEAT, session_id: "mine", config_dir: dir.config, worktree: "/w" },
    { seat: SEAT, pid: 44, config_dir: dir.config, worktree: "/w" },
  ]);
  assertEquals(seen.map((s) => [s.activity, s.session_id]), [
    ["idle", "mine"],
    ["idle", "mine"],
    ["starting", undefined],
  ], "the pid and the id find the row; the name finds nothing");

  // The name is given once, at the start, and a resume never names it.
  const home = await Deno.makeTempDir({ prefix: "lessons-b3-" });
  try {
    const resumed = await main("resume", {
      schema_version: 1,
      root: "/work/project",
      session_id: "663267a3-2b6e-44ac-b0f1-cbfd24bbbc5d",
      worktree: "/w",
      config_dir: null,
      model: "claude-haiku-4-5",
      posture: "ask",
    }, { HOME: home, FLEET_CLAUDE_BIN: REPLAY });
    assertEquals(resumed.exit, 0, resumed.stderr);
    assertEquals((resumed.answer!.argv as string[]).includes("--name"), false);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
