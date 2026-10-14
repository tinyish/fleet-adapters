// lessons A12 — an MCP tool call backgrounds after 120 s unless a human is
// being asked. Held on 2.1.280 by a read of the binary (fleet-031). It is
// what bounds read's blind spot: a session inside a tool call that asks
// nobody anything reads busy, exactly as a long ordinary call does (B8's
// second gap), and 2.1.280 ends that class in two minutes on its own; a call
// that raises a dialog — an elicitation among them — can hold the session
// for as long as the human does, and that one is on the listing as
// `waitingFor`. So `read` answers the first busy and never blocked, and the
// second blocked, whatever its cause is called.

import { assertEquals } from "@std/assert";
import { readCase, readOver } from "../lessons_support.ts";

const SEAT = "0199a3c4-0000-7000-8000-0000000012a0";

Deno.test("lessons::an_mcp_call_backgrounds_at_120s", async () => {
  // Recorded on 2.1.280: a session mid-turn reads busy, and nothing else.
  const busy = await readCase("busy");
  assertEquals(busy.seats, busy.expected.seats);
  assertEquals(busy.seats[0].activity, "busy");
  assertEquals(busy.seats[0].blocked_on, undefined);
  assertEquals(busy.seats[0].cause, undefined);

  // A queued elicitation, the cause the 120 s timer restarts for, is on the
  // row as `input needed` (B8's table): blocked, typed, named.
  const asking = await readOver(
    {
      config: JSON.stringify([{
        sessionId: "s",
        kind: "interactive",
        pid: 4242,
        status: "waiting",
        waitingFor: "input needed",
      }]),
    },
    (
      dir,
    ) => [{ seat: SEAT, pid: 4242, config_dir: dir.config, worktree: "/w" }],
  );
  assertEquals(asking, [{
    seat: SEAT,
    activity: "blocked",
    evidence: "typed",
    session_id: "s",
    cause: "the agent waits for `input needed`",
  }]);
});
