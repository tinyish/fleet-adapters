// lessons C2 — the transcript entry shape. Held on 2.1.280 (fleet-jymr.4's
// recordings): `user` and `assistant` entries carry `type` and
// `isSidechain`, and an assistant entry `message.usage` with the input
// tokens and both cache figures. There is no single context number: the
// window is the arithmetic over those three on the last main-chain entry
// that states one. And ONE MODEL RESPONSE IS ONE ENTRY PER CONTENT BLOCK,
// each carrying the whole usage under one `message.id`, so turns count ids.

import { assertEquals } from "@std/assert";
import { contextTokens, entries, turns } from "../../lib/transcript.ts";
import { CONTEXT_FIXTURES, contextCase } from "../lessons_support.ts";

const A = "7aacce74-e9fe-4c2d-abef-3ef601f5bb5d";

Deno.test("lessons::the_transcript_entry_shape", () => {
  const body = `
{"type":"user","message":{"usage":{"input_tokens":900}}}
{"type":"assistant","message":{"usage":{"input_tokens":1,"cache_read_input_tokens":2,"cache_creation_input_tokens":3}}}
{"type":"assistant","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":30}}}
{"type":"assistant","message":{"usage":{"input_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
{"type":"assistant","message":{"usage":{"inp`;
  assertEquals(
    contextTokens(entries(body)),
    60,
    "the last entry stating a window, summed over all three figures",
  );
  assertEquals(
    contextTokens(entries('{"type":"assistant","message":{}}')),
    undefined,
    "an entry with no usage block states no window",
  );
  assertEquals(contextTokens(entries("")), undefined);
});

/**
 * MEASURED ON 2.1.280: one model response is written as one entry per
 * content block — a thinking entry, then a text or tool_use entry — each
 * carrying the response's whole usage under the same message id. A turn is
 * one response, so entries sharing an id count once; an entry with no id
 * counts alone.
 */
Deno.test("lessons::the_transcript_entry_shape: the entries of one response are one turn", async () => {
  const body = `
{"type":"assistant","message":{"id":"msg_1","usage":{"input_tokens":10}}}
{"type":"assistant","message":{"id":"msg_1","usage":{"input_tokens":10}}}
{"type":"assistant","message":{"id":"msg_2","usage":{"input_tokens":30}}}
{"type":"assistant","message":{"usage":{"input_tokens":40}}}
{"type":"assistant","message":{"usage":{"input_tokens":40}}}`;
  const all = entries(body);
  assertEquals([contextTokens(all), turns(all)], [40, 4]);

  // Recorded: the session's four responses are more entries than that,
  // every one of a response's entries under its one id.
  const recorded = Deno.readTextFileSync(
    `${CONTEXT_FIXTURES}subagent/config/projects/-private-tmp-jymr4-rec-wt/${A}.jsonl`,
  ).split("\n").filter((line) => line.trim() !== "").map((line) =>
    JSON.parse(line)
  );
  const assistant = recorded.filter((e) =>
    e.type === "assistant" && e.message?.usage !== undefined
  );
  const ids = new Set(assistant.map((e) => e.message.id));
  assertEquals(ids.size, 4);
  assertEquals(
    assistant.length > ids.size,
    true,
    "a response is several entries",
  );
  for (const e of assistant) {
    assertEquals(typeof e.isSidechain, "boolean");
    for (
      const figure of [
        "input_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
      ]
    ) {
      assertEquals(typeof e.message.usage[figure], "number", figure);
    }
  }
  const read = await contextCase("subagent");
  assertEquals(read.seats, read.expected);
  assertEquals(read.seats[0].turns, 4);
});
