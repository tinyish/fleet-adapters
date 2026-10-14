// lessons B1 — the roster is one command, and it tolerates fields it does
// not know. Held on 2.1.280 (fleet-rge6.3, fleet-jymr.3, fleet-031): still
// `agents --json --all`, once per config dir; an interactive row carries
// fewer fields than a background one, so field presence is kind-dependent
// and a reader that required one on every row would fail the first mixed
// listing.

import { assertEquals } from "@std/assert";
import { LISTING, parseListing } from "../../lib/listing.ts";
import { READ_FIXTURES, readCase, readOver } from "../lessons_support.ts";

const RA = "19edc64f-9110-4368-982c-98ea5600e1d3";
const SEAT = "0199a3c4-0000-7000-8000-0000000021a0";

Deno.test("lessons::the_roster_is_one_command", async () => {
  // One command. The fixtures' claude answers `agents --json --all` and
  // exits 64 on anything else, so every read below ran exactly it.
  assertEquals(LISTING, ["agents", "--json", "--all"]);

  // A field no reader names is nothing: recorded, plus one field.
  const unknown = await readCase("unknown-field");
  assertEquals(unknown.seats, unknown.expected.seats);
  const idle = parseListing(
    Deno.readTextFileSync(`${READ_FIXTURES}idle/config/listing.json`),
  );
  assertEquals(
    parseListing(
      Deno.readTextFileSync(
        `${READ_FIXTURES}unknown-field/config/listing.json`,
      ),
    ),
    idle,
  );

  // Kind-dependent presence: a background row carrying id, state, name and
  // a field nobody has seen, beside an interactive row carrying none of
  // them, is one listing that reads — and the interactive row is the seat's.
  const mixed = `[
    {"id":"aa","sessionId":"aa","cwd":"/wt/b1","kind":"background","pid":1,
     "status":"idle","state":"working","name":"orla","startedAt":10,
     "someFieldNobodyHasSeen":"harmless"},
    {"sessionId":"${RA}","kind":"interactive","pid":84311,"status":"busy"},
    {"sessionId":"bb","kind":"interactive"}
  ]`;
  assertEquals(parseListing(mixed), {
    rows: [
      {
        sessionId: "aa",
        kind: "background",
        pid: 1,
        status: "idle",
        startedAt: 10,
      },
      { sessionId: RA, kind: "interactive", pid: 84311, status: "busy" },
      { sessionId: "bb", kind: "interactive" },
    ],
  });
  const seen = await readOver({ config: mixed }, (dir) => [
    { seat: SEAT, pid: 84311, config_dir: dir.config, worktree: "/wt/b1" },
    { seat: SEAT, pid: 1, config_dir: dir.config, worktree: "/wt/b1" },
  ]);
  assertEquals(seen, [
    { seat: SEAT, activity: "busy", evidence: "typed", session_id: RA },
    { seat: SEAT, activity: "starting", evidence: "typed" },
  ], "the background row is read past, and never a seat's");
});
