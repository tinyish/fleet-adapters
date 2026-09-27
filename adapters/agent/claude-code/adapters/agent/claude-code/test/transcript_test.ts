// lib/transcript.ts: where a seat's transcript is, and the three readings
// taken off its entries — the window its last main-chain turn carried, the
// turns it took, and whether its first turn was the logged-out answer. The
// arms restating the lessons the pack keeps — C1's encoding, C2's entry
// shape, C3's sidechains — are under test/lessons/ (fleet-jymr.6). The arms
// here restate controller/tests/observe.rs at tinyfleet 451a33d
// (the_turn_reader_counts_the_entry_the_window_reader_skips) and
// cli/tests/drive_effects.rs's logged-out arms, and read the transcripts
// recorded on Claude Code 2.1.280 under fixtures/context/.

import { assertEquals } from "@std/assert";
import {
  contextTokens,
  entries,
  loggedOutFirstTurn,
  turns,
} from "../lib/transcript.ts";

const FIXTURES = new URL("../fixtures/context/", import.meta.url).pathname;
const WT = "-private-tmp-jymr4-rec-wt";
const DOTTED = "-private-tmp-jymr4-rec-wt-a-b-c";
const A = "7aacce74-e9fe-4c2d-abef-3ef601f5bb5d";
const C = "ade4550e-f37a-46bb-b894-48fd789b7378";
const D = "9a2bdfef-7532-4904-b713-24e1d98852c3";

/** One recorded transcript's entries, by case, project directory and id. */
async function recorded(
  kase: string,
  project: string,
  session: string,
) {
  return entries(
    await Deno.readTextFile(
      `${FIXTURES}${kase}/config/projects/${project}/${session}.jsonl`,
    ),
  );
}

/** A body's window and turns, the two readings `context` answers from it. */
function read(body: string) {
  const all = entries(body);
  return { tokens: contextTokens(all), turns: turns(all) };
}

// -------------------------------------------------------------- the readings

/**
 * The turn reader beside the window reader: the same filter, one step
 * shorter. Four main-chain assistant entries carry a usage block and one
 * sums to zero, so the window reader answers the last non-zero and the turn
 * reader 4; one that copied the window's filter would answer 3.
 */
Deno.test("the turn reader counts the entry the window reader skips", () => {
  const body = `
{"type":"user","message":{"usage":{"input_tokens":900}}}
{"type":"assistant","message":{"usage":{"input_tokens":1}}}
{"type":"assistant","isSidechain":true,"message":{"usage":{"input_tokens":2600000}}}
{"type":"assistant","message":{"usage":{"input_tokens":0,"cache_read_input_tokens":0}}}
{"type":"assistant","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":20}}}
{"type":"assistant","message":{"usage":{"input_tokens":40,"cache_read_input_tokens":20}}}
{"type":"assistant","message":{"usage":{"inp`;
  assertEquals(read(body), { tokens: 60, turns: 4 });
  assertEquals(
    turns(entries('{"type":"assistant","message":{}}')),
    0,
    "no usage block is no turn",
  );
  assertEquals(turns(entries("")), 0, "an empty transcript is a measured zero");
  const control = body.replace('"isSidechain":true', '"isSidechain":false');
  assertEquals(
    turns(entries(control)),
    5,
    "the control counts the entry the skip drops, or the skip proves nothing",
  );
});

/**
 * The decoder takes what serde took in observe.rs: a field of the wrong kind
 * drops the entry, as a line that is not JSON does, and unknown fields are
 * nothing.
 */
Deno.test("an entry that does not decode is skipped, and unknown fields are nothing", () => {
  const body = `
{"type":"assistant","message":{"usage":{"input_tokens":7}},"brandNew":{"x":1}}
{"type":"assistant","message":{"usage":{"input_tokens":"9"}}}
{"type":"assistant","isSidechain":"no","message":{"usage":{"input_tokens":9}}}
{"type":3,"message":{"usage":{"input_tokens":9}}}
[1,2]
null
{"type":"assistant","message":{"usage":{"input_tokens":-9}}}`;
  assertEquals(read(body), { tokens: 7, turns: 1 });
  assertEquals(
    read('{"type":"assistant","message":null}\n{"type":"assistant"}'),
    { tokens: undefined, turns: 0 },
  );
});

// ------------------------------------------------------- the logged-out turn

/**
 * The provider's logged-out first turn as fleet's drive arm carries it
 * (read off a real transcript on 2026-09-12, 2.1.261), and its control: a
 * first turn that answered.
 */
Deno.test("the logged-out first turn: all three terms, on the first entry", () => {
  const loggedOut = [
    '{"type":"user","isSidechain":false,"message":{"role":"user"}}',
    '{"type":"assistant","isSidechain":false,"isApiErrorMessage":true,' +
    '"error":"authentication_failed","message":{"model":"<synthetic>",' +
    '"usage":{"input_tokens":0,"output_tokens":0,' +
    '"cache_creation_input_tokens":0,"cache_read_input_tokens":0},' +
    '"content":[{"type":"text","text":"Not logged in"}]}}',
  ].join("\n");
  assertEquals(loggedOutFirstTurn(entries(loggedOut)), true);
  assertEquals(
    loggedOutFirstTurn(
      entries(
        '{"type":"assistant","isSidechain":false,"message":{"usage":{"input_tokens":36072}}}',
      ),
    ),
    false,
    "a first turn that answered",
  );
  // Each term alone moved: no reading.
  for (
    const [from, to] of [
      ['"isApiErrorMessage":true', '"isApiErrorMessage":false'],
      ['"authentication_failed"', '"rate_limit"'],
      ['"input_tokens":0,', '"input_tokens":5,'],
    ]
  ) {
    assertEquals(
      loggedOutFirstTurn(entries(loggedOut.replace(from, to))),
      false,
      to,
    );
  }
  assertEquals(loggedOutFirstTurn(entries("")), false);
});

// ------------------------------------------------- the recordings, 2.1.280

/**
 * A logged-out session's first turn, recorded: one user entry and one
 * synthetic assistant entry, `authentication_failed`, a window of zero. It
 * states no window, and it is one turn.
 */
Deno.test("recorded: the logged-out first turn", async () => {
  const all = await recorded("logged-out-first-turn", WT, C);
  assertEquals(loggedOutFirstTurn(all), true);
  assertEquals({ tokens: contextTokens(all), turns: turns(all) }, {
    tokens: undefined,
    turns: 1,
  });
});

/**
 * The same session resumed logged out after two answered turns: its last
 * entry is the zero-usage one, which is counted as a turn and skipped as a
 * window, and its first turn answered, so it is not the logged-out one.
 */
Deno.test("recorded: a zero-usage entry last is a turn and no window", async () => {
  const before = await recorded("subagent", WT, A);
  const after = await recorded("zero-usage-last", WT, A);
  const last = after.filter((e) => e.type === "assistant").at(-1);
  assertEquals(
    [last?.usage, last?.error],
    [{
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }, "authentication_failed"],
  );
  assertEquals(contextTokens(after), contextTokens(before));
  assertEquals(contextTokens(after), 38458);
  assertEquals(turns(after), turns(before) + 1);
  assertEquals(loggedOutFirstTurn(after), false);
});

/**
 * DERIVED from the dotted-worktree recording: the file cut halfway through
 * its last assistant entry. The torn line changes nothing.
 */
Deno.test("recorded: a torn final line changes nothing", async () => {
  const whole = await recorded("dotted-worktree", DOTTED, D);
  const torn = await recorded("torn-final-line", DOTTED, D);
  assertEquals(torn.length, whole.length - 1 - trailing(whole));
  assertEquals(
    { tokens: contextTokens(torn), turns: turns(torn) },
    { tokens: contextTokens(whole), turns: turns(whole) },
  );
  assertEquals(contextTokens(whole), 33122);
  assertEquals(turns(whole), 1);
});

/** How many entries come after the last assistant one. */
function trailing(all: { type: string }[]): number {
  return all.length - 1 -
    all.map((e) => e.type).lastIndexOf("assistant");
}
