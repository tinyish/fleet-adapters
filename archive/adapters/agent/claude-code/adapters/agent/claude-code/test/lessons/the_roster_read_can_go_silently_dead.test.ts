// lessons B4 — the listing has answered zero bytes and exit 0 while
// sessions were live. Not reproduced on 2.1.280, and the class stays open:
// empty is UNREADABLE, never a reading of zero, and the control is `[]`, a
// listing that answered and said there is nothing. Unreadable is the dir's
// own: its seats are unknown, and every other dir is read as usual.

import { assertEquals } from "@std/assert";
import { parseListing } from "../../lib/listing.ts";
import { READ_FIXTURES, readCase, readOver } from "../lessons_support.ts";

const SILENT = "the listing answered with zero bytes and a success status";
const SEAT = "0199a3c4-0000-7000-8000-0000000024a0";
const OTHER = "0199a3c4-0000-7000-8000-0000000024b0";

Deno.test("lessons::the_roster_read_can_go_silently_dead", async () => {
  // The rule on the body alone: zero bytes, or only whitespace, is no read.
  assertEquals(
    parseListing(
      Deno.readTextFileSync(`${READ_FIXTURES}zero-bytes/config/listing.json`),
    ),
    { unreadable: SILENT },
  );
  assertEquals(parseListing(" \n"), { unreadable: SILENT });
  assertEquals(
    parseListing(
      Deno.readTextFileSync(
        `${READ_FIXTURES}empty-listing/config/listing.json`,
      ),
    ),
    { rows: [] },
  );

  // Through the verb: unknown with its cause, never starting; `[]` is.
  const silent = await readCase("zero-bytes");
  assertEquals(silent.seats, silent.expected.seats);
  assertEquals(silent.seats[0].activity, "unknown");
  assertEquals(silent.seats[0].cause, SILENT);
  const empty = await readCase("empty-listing");
  assertEquals(empty.seats, empty.expected.seats);
  assertEquals(empty.seats.map((s) => s.activity), ["starting", "starting"]);

  // A silent dir beside one that answered: only its own seats go unknown.
  const row = JSON.stringify([
    { sessionId: "s", kind: "interactive", pid: 7, status: "idle" },
  ]);
  const beside = await readOver({ silent: "", answered: row }, (dir) => [
    { seat: SEAT, pid: 7, config_dir: dir.silent, worktree: "/w" },
    { seat: OTHER, pid: 7, config_dir: dir.answered, worktree: "/w" },
  ]);
  assertEquals(beside.map((s) => [s.activity, s.cause]), [
    ["unknown", SILENT],
    ["idle", undefined],
  ]);
});
