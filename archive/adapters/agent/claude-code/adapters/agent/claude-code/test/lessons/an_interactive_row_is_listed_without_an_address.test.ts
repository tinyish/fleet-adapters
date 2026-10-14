// lessons B10 — an interactive session is listed without an address, and
// its blocked cause is typed. First read on 2.1.282 and re-measured on the
// pin, 2.1.280 (fleet-rge6.3, fleet-jymr.3, fleet-jymr.4, fleet-031): the
// row carries pid, cwd, kind, startedAt, sessionId, name and status, and
// waitingFor while blocked — never `id`, never `state`; status is three
// words; the row is gone by the next read once the session ends; and a
// scoped session's transcript lands at
// `<config dir>/projects/<encoded resolved cwd>/<session id>.jsonl`.

import { assert, assertEquals } from "@std/assert";
import { transcriptPath } from "../../lib/transcript.ts";
import { READ_FIXTURES, readCase } from "../lessons_support.ts";

const RA = "19edc64f-9110-4368-982c-98ea5600e1d3";
const WT = "/private/tmp/jymr3-rec/wt";
const RECORDED = [
  "idle",
  "busy",
  "waiting-permission",
  "two-rows-one-worktree",
];

Deno.test("lessons::an_interactive_row_is_listed_without_an_address", async () => {
  for (const kase of RECORDED) {
    const rows = JSON.parse(
      Deno.readTextFileSync(`${READ_FIXTURES}${kase}/config/listing.json`),
    ) as Record<string, unknown>[];
    assert(rows.length > 0, kase);
    for (const row of rows) {
      assertEquals(row.kind, "interactive", kase);
      assert(!("id" in row), `no address on an interactive row: ${kase}`);
      assert(!("state" in row), `no state on an interactive row: ${kase}`);
      assertEquals(
        Object.keys(row).filter((k) => k !== "waitingFor").sort(),
        ["cwd", "kind", "name", "pid", "sessionId", "startedAt", "status"],
        kase,
      );
      assertEquals(
        "waitingFor" in row,
        row.status === "waiting",
        `waitingFor is there exactly while blocked: ${kase}`,
      );
    }
  }

  // Three words, each a typed activity, and the row teaches its session.
  for (
    const [kase, activity] of [
      ["idle", "idle"],
      ["busy", "busy"],
      ["waiting-permission", "blocked"],
    ]
  ) {
    const read = await readCase(kase);
    assertEquals(read.seats, read.expected.seats);
    assertEquals(read.seats[0].activity, activity, kase);
    assertEquals(read.seats[0].evidence, "typed");
    assertEquals(read.seats[0].session_id, RA);
  }

  // Ended: the next read lists nothing, and a pane still asked about is a
  // pane with no row — starting, never an end, which is the host's to read.
  const gone = await readCase("empty-listing");
  assertEquals(gone.seats.map((s) => s.activity), ["starting", "starting"]);

  // The scoped session's transcript, where it was recorded.
  const path = transcriptPath(`${READ_FIXTURES}idle/config`, WT, RA)!;
  assertEquals(
    path,
    `${READ_FIXTURES}idle/config/projects/-private-tmp-jymr3-rec-wt/${RA}.jsonl`,
  );
  assert((await Deno.stat(path)).isFile);
});
