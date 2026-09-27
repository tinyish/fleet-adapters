// lessons B7 — a truncated listing is a third state, never absence. Since
// 2.1.234 a read can say the account's session list was too long to check
// completely; held on 2.1.280 by a read of the binary (fleet-031), and never
// seen in a real read. So a listing is present, absent or UNJUDGEABLE, and
// this adapter has no word for absent at all: whether a session is there is
// the host's reading (ruling 3). A listing that carries the notice is
// unknown, naming why — never a seat's row gone missing, never `starting`.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CONTRACT } from "../../lib/answer.ts";
import { readOver } from "../lessons_support.ts";

/** The wording the 2.1.280 binary carries, six times over. */
const NOTICE = "your session list was too long to check completely";
const SEAT = "0199a3c4-0000-7000-8000-0000000027a0";

Deno.test("lessons::a_truncated_listing_is_not_absence", async () => {
  // No activity this adapter answers says a session is gone.
  const words =
    (CONTRACT as unknown as { $defs: { Activity: { enum: string[] } } })
      .$defs.Activity.enum;
  assertEquals(words, ["starting", "busy", "idle", "blocked", "unknown"]);

  // The notice where rows would be, after them, or on a failing exit's
  // stderr: each is the dir's unknown, carrying why, and never starting.
  const row = '{"sessionId":"s","kind":"interactive","pid":7,"status":"idle"}';
  const seen = await readOver({
    alone: NOTICE,
    after: `[${row}]\n${NOTICE}\n`,
    failed: { stdout: "", exit: 1, stderr: `Error: ${NOTICE}\n` },
  }, (dir) =>
    ["alone", "after", "failed"].map((name) => ({
      seat: SEAT,
      pid: 7,
      config_dir: dir[name],
      worktree: "/w",
    })));
  for (const [n, reading] of seen.entries()) {
    assertEquals(reading.activity, "unknown", JSON.stringify(reading));
    assert(reading.cause !== undefined && reading.cause !== null);
    if (n === 2) assertStringIncludes(reading.cause, NOTICE);
  }

  // The control: the same row, answered whole, is the seat's.
  const whole = await readOver({ whole: `[${row}]` }, (dir) => [
    { seat: SEAT, pid: 7, config_dir: dir.whole, worktree: "/w" },
  ]);
  assertEquals(whole[0].activity, "idle");
});
