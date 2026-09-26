// lib/capabilities.ts: what this pack declares about Claude Code, held to the
// contract's schema and to the rules fleet's validate() adds to it
// (core/src/agent/types.rs at tinyfleet 451a33d).

import { assert, assertEquals } from "@std/assert";
import { CONTRACT, SCHEMA_VERSION } from "../lib/answer.ts";
import { CAPABILITIES, PINNED } from "../lib/capabilities.ts";
import { why } from "../lib/schema.ts";

Deno.test("capabilities reads as the contract's answer", () => {
  assertEquals(
    why(CONTRACT, CONTRACT.verbs.capabilities.response, {
      schema_version: SCHEMA_VERSION,
      ...CAPABILITIES,
    }),
    null,
  );
});

/** validate(): postures and measured not empty, first_turn not blank. */
Deno.test("capabilities holds fleet's validate rules", () => {
  assert(CAPABILITIES.postures.length > 0);
  assert(CAPABILITIES.measured.length > 0);
  assert(CAPABILITIES.first_turn.trim() !== "");
  assert(CAPABILITIES.first_turn.includes("{seat}"));
  assert(CAPABILITIES.default_model.trim() !== "");
  for (const posture of Object.keys(CAPABILITIES.posture_models ?? {})) {
    assert(
      (CAPABILITIES.postures as string[]).includes(posture),
      `posture_models keys ${posture}, which postures does not name`,
    );
  }
});

/**
 * fleet-jymr.2's values (policy.rs 41, 56-57, 62 and supported.rs:33 at
 * tinyfleet 451a33d): the three postures, Opus 5 by default, the wake as the
 * first turn, the transcript read, 2.1.280, and auto held to the models
 * measured to honour it (lessons claude-code D3).
 */
Deno.test("capabilities declares the in-process adapter's values", () => {
  assertEquals(CAPABILITIES, {
    postures: ["ask", "auto", "unattended"],
    default_model: "claude-opus-5",
    first_turn: "/wake {seat}",
    context: true,
    measured: ["2.1.280"],
    posture_models: {
      auto: ["claude-opus-5", "claude-fable-5", "claude-sonnet-5"],
    },
  });
  assertEquals(CAPABILITIES.measured.at(-1), PINNED);
});
