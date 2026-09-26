// What this pack declares about Claude Code: the capabilities answer, whole.
// Each value is the in-process adapter's, ported from tinyfleet at 451a33d,
// not re-decided (fleet-jymr.2's list):
//
//   postures        the three words (ruling 14): ask ↔ default, auto ↔ auto,
//                   unattended ↔ dontAsk — the mapping is launch's
//                   (fleet-jymr.2), and a posture is declared here only
//                   where launch will take it.
//   default_model   controller/src/policy.rs:41 DEFAULT_MODEL. A start that
//                   names no model comes up on the cheapest one (lessons
//                   claude-code A5), so a seat always names this one.
//   first_turn      policy.rs:62 DEFAULT_FIRST_TURN; {seat} is the seat's
//                   session name, which fleet fills in.
//   context         true: the pack reads each seat's transcript
//                   (fleet-jymr.4). Until that row lands `context` answers
//                   exit 2 as every unfilled verb does.
//   measured        core/src/supported.rs:33 PINNED_CLAUDE_CODE. fleet-jymr.2
//                   re-measures B10 and D8 on this version (E14) and fleet-
//                   jymr.6 carries the measurements beside their fixtures.
//   posture_models  policy.rs 56-57 DEFAULT_AUTO_CAPABLE_MODELS, by prefix:
//                   the models measured to honour a requested auto (lessons
//                   claude-code D3), the gate moved out of policy (E9).

import type { Body } from "./answer.ts";

/** The Claude Code release this pack is measured against. */
export const PINNED = "2.1.280";

export const CAPABILITIES: Body<"capabilities"> = {
  postures: ["ask", "auto", "unattended"],
  default_model: "claude-opus-5",
  first_turn: "/wake {seat}",
  context: true,
  measured: [PINNED],
  posture_models: {
    auto: ["claude-opus-5", "claude-fable-5", "claude-sonnet-5"],
  },
};
