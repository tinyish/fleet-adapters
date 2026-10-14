// lessons D3 — the permission posture is model-gated, and the downgrade is
// reported only on screen. Held on 2.1.280 (fleet-031): `--permission-mode
// auto` came up in auto on claude-sonnet-5, claude-opus-5 and
// claude-fable-5, and on Opus 5.5 by default; on claude-haiku-4-5 it came
// up in manual mode, "auto mode unavailable for this model" on screen and
// the row plain idle. So the pack declares, in `posture_models`, the models
// measured to honour auto, BY PREFIX — a live id carries a date or a window
// after the family and major — and fleet holds a requested auto to them
// (core's gate, ruling 8's E9). A model outside the set is not in it by
// being close.

import { assert, assertEquals } from "@std/assert";
import type { Posture } from "../../contract.d.ts";
import { CAPABILITIES } from "../../lib/capabilities.ts";
import { flagFor } from "../../lib/posture.ts";

/** Whether `model` is in the declared set for `posture`, by prefix. */
function honours(posture: Posture, model: string): boolean {
  const declared: string[] | undefined = CAPABILITIES.posture_models
    ?.[posture];
  if (declared === undefined) return true;
  return declared.some((prefix) => model.startsWith(prefix));
}

Deno.test("lessons::the_permission_posture_is_model_gated", () => {
  assertEquals(CAPABILITIES.posture_models, {
    auto: ["claude-opus-5", "claude-fable-5", "claude-sonnet-5"],
  });
  // Measured to honour auto on 2.1.280, and the suffixed ids of the same.
  for (
    const model of [
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-fable-5",
      "claude-opus-5-5",
      "claude-opus-5-20260901",
      "claude-sonnet-5-1m",
    ]
  ) {
    assert(honours("auto", model), model);
  }
  // Measured NOT to: haiku came up in manual mode. And a near miss is none.
  for (
    const model of [
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5-20250929",
      "claude-opus-4-1",
    ]
  ) {
    assert(!honours("auto", model), model);
  }
  // The postures that ask for less are not gated at all.
  assert(honours("ask", "claude-haiku-4-5"));
  assert(honours("unattended", "claude-haiku-4-5"));
  // And the posture reaches the pane as the mode the model was measured in.
  assertEquals(
    (["ask", "auto", "unattended"] as const).map((p) => flagFor(p)),
    ["default", "auto", "dontAsk"],
  );
});
