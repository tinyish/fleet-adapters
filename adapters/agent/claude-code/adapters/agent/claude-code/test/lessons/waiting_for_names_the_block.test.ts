// lessons B8 — one field says a session is stopped in front of a human, and
// it is keyed on PRESENCE. Held on 2.1.280 (fleet-031, fleet-rge6.3,
// fleet-jymr.3): `waitingFor` is present exactly while the row's status is
// `waiting`, and a dialog kind with no label of its own still arrives named,
// as `permission prompt`. So a cause this adapter has never seen still stops
// the seat, whatever the status beside it; `permission prompt`, the one
// value recorded, is blocked on permission; and absent is the control.

import { assertEquals } from "@std/assert";
import type { SeatRef } from "../../contract.d.ts";
import type { Row } from "../../lib/listing.ts";
import { activityOf } from "../../verbs/read.ts";
import { readCase } from "../lessons_support.ts";

const RA = "19edc64f-9110-4368-982c-98ea5600e1d3";
const SEAT = "0199a3c4-0000-7000-8000-0000000028a0";
const seat: SeatRef = { seat: SEAT, pid: 84311, worktree: "/w" };

function read(row: Partial<Row>) {
  return activityOf(seat, {
    rows: [{ sessionId: RA, kind: "interactive", pid: 84311, ...row }],
  }, "/nowhere");
}

Deno.test("lessons::waiting_for_names_the_block", async () => {
  // Recorded on 2.1.280: the Bash approval dialog.
  const recorded = await readCase("waiting-permission");
  assertEquals(recorded.seats, recorded.expected.seats);
  assertEquals(recorded.seats[0].blocked_on, "permission");

  assertEquals(
    await read({ status: "waiting", waitingFor: "permission prompt" }),
    {
      seat: SEAT,
      activity: "blocked",
      blocked_on: "permission",
      evidence: "typed",
      session_id: RA,
    },
  );
  // Presence, never the value: an unenumerated cause stops the seat under
  // any status, and names no reason it cannot.
  for (const status of ["waiting", "busy", "idle"]) {
    assertEquals(
      await read({ status, waitingFor: "a cause nobody has enumerated" }),
      {
        seat: SEAT,
        activity: "blocked",
        evidence: "typed",
        session_id: RA,
        cause: "the agent waits for `a cause nobody has enumerated`",
      },
      status,
    );
  }
  // `waiting` with no cause beside it is a block all the same.
  assertEquals(await read({ status: "waiting" }), {
    seat: SEAT,
    activity: "blocked",
    evidence: "typed",
    session_id: RA,
    cause: "the listing says waiting and names no cause",
  });
  // The control: the same row without the field.
  assertEquals((await read({ status: "busy" })).activity, "busy");
  assertEquals((await read({ status: "busy" })).cause, undefined);
});
