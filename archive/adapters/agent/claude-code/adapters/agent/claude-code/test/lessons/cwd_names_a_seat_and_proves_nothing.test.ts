// lessons B5 — `cwd` names a seat and proves nothing. Held on 2.1.280
// (fleet-jymr.3): two sessions in one worktree were two rows, each found by
// its own session id or its own pid. The working directory is where a
// process was launched, never who dispatched it, so a seat is found by its
// session id, else by its pane's pid, and never by its worktree.

import { assertEquals } from "@std/assert";
import { readCase, readOver } from "../lessons_support.ts";

const WT = "/private/tmp/jymr3-rec/wt";
const SEAT = "0199a3c4-0000-7000-8000-0000000025a0";

Deno.test("lessons::cwd_names_a_seat_and_proves_nothing", async () => {
  // Recorded: two rows standing in one worktree. The seat asked by id, and
  // the one asked by pid, each get their own; the seat whose pane no row
  // carries gets neither, though both stand in its worktree.
  const two = await readCase("two-rows-one-worktree");
  assertEquals(two.seats, two.expected.seats);
  assertEquals(
    two.request.seats.map((s) => s.worktree),
    [WT, WT, WT],
    "every seat asked stands in the rows' worktree",
  );
  assertEquals(two.seats[2].activity, "starting");

  // The row in the seat's worktree is not the seat's; the row elsewhere
  // carrying the pane's pid is.
  const seen = await readOver({
    config: JSON.stringify([
      {
        sessionId: "not-mine",
        kind: "interactive",
        cwd: WT,
        pid: 4242,
        status: "busy",
      },
      {
        sessionId: "mine",
        kind: "interactive",
        cwd: "/somewhere/else",
        pid: 5151,
        status: "idle",
      },
    ]),
  }, (dir) => [
    { seat: SEAT, pid: 5151, config_dir: dir.config, worktree: WT },
    { seat: SEAT, pid: 7, config_dir: dir.config, worktree: WT },
  ]);
  assertEquals(seen.map((s) => [s.activity, s.session_id]), [
    ["idle", "mine"],
    ["starting", undefined],
  ]);
});
