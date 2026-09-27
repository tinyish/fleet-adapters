// lessons B2 — the roster carries no token field of any kind. Held on
// 2.1.280: no token or context figure on any recorded row. Context comes
// from the transcript (C2); a figure that turned up on a row would be an
// adoption opportunity routed as one, never a number read in passing.

import { assert, assertEquals } from "@std/assert";
import { contextCase, READ_FIXTURES, readOver } from "../lessons_support.ts";

const SEAT = "0199a3c4-0000-7000-8000-0000000022a0";

/** Every recorded listing under fixtures/read/, by path. */
function listings(): [string, unknown[]][] {
  const found: [string, unknown[]][] = [];
  for (const kase of Deno.readDirSync(READ_FIXTURES)) {
    if (!kase.isDirectory) continue;
    for (const dir of Deno.readDirSync(`${READ_FIXTURES}${kase.name}`)) {
      const path = `${READ_FIXTURES}${kase.name}/${dir.name}/listing.json`;
      if (!dir.isDirectory) continue;
      const body = Deno.readTextFileSync(path).trim();
      if (body !== "") found.push([path, JSON.parse(body)]);
    }
  }
  return found;
}

Deno.test("lessons::the_roster_carries_no_token_field", async () => {
  // Recorded on 2.1.280: no field of any row names tokens or context.
  const recorded = listings();
  assert(recorded.length >= 10, `${recorded.length} listings read`);
  for (const [path, rows] of recorded) {
    for (const row of rows as Record<string, unknown>[]) {
      for (const field of Object.keys(row)) {
        assert(!/token|context|usage/i.test(field), `${path}: ${field}`);
      }
    }
  }

  // A row that carried one anyway: the reading has no path for it.
  const seen = await readOver(
    {
      config: JSON.stringify([{
        sessionId: "s",
        kind: "interactive",
        pid: 4242,
        status: "idle",
        tokens: 999999,
        input_tokens: 999999,
      }]),
    },
    (
      dir,
    ) => [{ seat: SEAT, pid: 4242, config_dir: dir.config, worktree: "/w" }],
  );
  assertEquals(seen, [{
    seat: SEAT,
    activity: "idle",
    evidence: "typed",
    session_id: "s",
  }]);

  // The window is the transcript's: the recorded session's, 38458.
  const context = await contextCase("subagent");
  assertEquals(context.seats, context.expected);
  assertEquals(context.seats[0].tokens, 38458);
});
