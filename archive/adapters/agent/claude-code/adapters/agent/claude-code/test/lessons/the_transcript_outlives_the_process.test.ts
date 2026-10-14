// lessons C4 — a session's transcript outlives the process that wrote it.
// Held on 2.1.280 (fleet-rge6.3, fleet-rge6.4, fleet-jymr.4): an
// interactive session's transcript stays after its pane is killed, and a
// resume by the full id writes on into the same file. So `context` reads a
// seat from its file alone — it runs no claude and asks no listing — and a
// session that has ended answers the same reading a live one would.

import { assertEquals } from "@std/assert";
import { contextCase, main, REPLAY } from "../lessons_support.ts";

Deno.test("lessons::the_transcript_outlives_the_process", async () => {
  // Every recorded transcript under fixtures/context/ was read after its
  // session was killed, and each answers.
  for (const kase of ["subagent", "dotted-worktree", "zero-usage-last"]) {
    const read = await contextCase(kase);
    assertEquals(read.seats, read.expected, kase);
    assertEquals(typeof read.seats[0].turns, "number", kase);
  }

  // The resume wrote on into the same file: the session's own id, one turn
  // more, and the window its last answered turn carried.
  const before = await contextCase("subagent");
  const after = await contextCase("zero-usage-last");
  assertEquals(
    after.request.seats[0].session_id,
    before.request.seats[0].session_id,
  );
  assertEquals(after.seats[0].turns, before.seats[0].turns! + 1);
  assertEquals(after.seats[0].tokens, before.seats[0].tokens);

  // No claude is asked: the claude named is the read fixtures' replay,
  // which exits non-zero for anything but a listing, and no dir here holds
  // one — the reading is the file's alone.
  const request = before.request;
  const called = await main("context", request, { FLEET_CLAUDE_BIN: REPLAY });
  assertEquals(called.exit, 0, called.stderr);
  assertEquals(
    (called.answer!.seats as Record<string, unknown>[]).map((s) => s.tokens),
    [38458],
  );
});
