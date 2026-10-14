// lessons C3 — a sidechain entry carries a different context window. The
// rule held on 2.1.280, and where the entries live is new (fleet-jymr.4):
// a subagent writes its own file, `<session id>/subagents/agent-<id>.jsonl`,
// every entry `isSidechain: true`, and the session's own file carries none;
// the subagent's window (21,862) is not the session's (38,458). The skip is
// a filter over the flag, so a release that writes sidechain entries into
// the session's file is read right as well.

import { assertEquals } from "@std/assert";
import { contextTokens, entries, turns } from "../../lib/transcript.ts";
import { CONTEXT_FIXTURES, contextCase } from "../lessons_support.ts";

const WT = "-private-tmp-jymr4-rec-wt";
const A = "7aacce74-e9fe-4c2d-abef-3ef601f5bb5d";

function recorded(kase: string, file: string) {
  return entries(
    Deno.readTextFileSync(
      `${CONTEXT_FIXTURES}${kase}/config/projects/${WT}/${file}`,
    ),
  );
}

/** The rule on a body: the control is the same body with the flag cleared. */
Deno.test("lessons::sidechains_carry_another_window", () => {
  const withSubagent = `
{"type":"assistant","isSidechain":false,"message":{"usage":{"input_tokens":11}}}
{"type":"assistant","isSidechain":true,"message":{"usage":{"input_tokens":2600000}}}`;
  assertEquals(contextTokens(entries(withSubagent)), 11);
  assertEquals(
    contextTokens(
      entries(
        withSubagent.replace('"isSidechain":true', '"isSidechain":false'),
      ),
    ),
    2_600_000,
    "the control reads the entry the skip drops",
  );
  assertEquals(
    contextTokens(
      entries('{"type":"assistant","message":{"usage":{"input_tokens":42}}}'),
    ),
    42,
    "an absent flag reads as main chain",
  );
});

/**
 * Recorded on 2.1.280: the subagent's entries in their own file, every one
 * flagged, none in the session's; and derived from it, the same entries
 * appended after the session's last — the window is the session's either
 * way, through `context` itself.
 */
Deno.test("lessons::sidechains_carry_another_window: recorded", async () => {
  const main = recorded("subagent", `${A}.jsonl`);
  assertEquals(main.some((e) => e.isSidechain), false);
  const dir =
    `${CONTEXT_FIXTURES}subagent/config/projects/${WT}/${A}/subagents`;
  const [file] = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) =>
    n.endsWith(".jsonl")
  );
  const sub = entries(Deno.readTextFileSync(`${dir}/${file}`));
  assertEquals(sub.length > 0 && sub.every((e) => e.isSidechain), true);
  assertEquals(
    contextTokens(sub.map((e) => ({ ...e, isSidechain: false }))),
    21862,
  );
  assertEquals([contextTokens(main), turns(main)], [38458, 4]);

  const appended = recorded("sidechain-after-main", `${A}.jsonl`);
  assertEquals(
    appended.filter((e) => e.type === "assistant").at(-1)?.isSidechain,
    true,
  );
  for (const kase of ["subagent", "sidechain-after-main"]) {
    const read = await contextCase(kase);
    assertEquals(read.seats, read.expected, kase);
    assertEquals(read.seats[0].tokens, 38458, kase);
  }
});
