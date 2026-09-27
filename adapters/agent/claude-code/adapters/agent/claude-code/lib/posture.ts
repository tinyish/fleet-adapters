// fleet's three posture words onto Claude Code's --permission-mode, and every
// other word refused (ruling 14, 2026-09-25): ask is Claude Code's default
// mode, auto its own, and unattended the mode that never stops to ask. Core
// reads no old spellings (fleet-1jr1e, ruling 17), and neither does this
// pack: Claude Code's own mode names are not postures. permission_mode at
// tinyfleet 807107b (controller/src/adapter/claude_code.rs).
//
// A posture is declared in lib/capabilities.ts exactly where it is mapped
// here (test/posture_test.ts holds the two in step). Whether a MODEL honours
// auto is not this file's: capabilities' posture_models states it, and core
// gates on it (E9; lessons claude-code D3).

import type { Posture } from "../contract.d.ts";
import { Refused } from "./answer.ts";

/** Each posture's --permission-mode, in the order capabilities declares. */
export const PERMISSION_MODES: Record<Posture, string> = {
  ask: "default",
  auto: "auto",
  unattended: "dontAsk",
};

/**
 * `posture`'s --permission-mode, or refused `unsupported`, exit 1, naming
 * the word and the three.
 */
export function flagFor(posture: string): string {
  if (Object.hasOwn(PERMISSION_MODES, posture)) {
    return PERMISSION_MODES[posture as Posture];
  }
  const words = Object.keys(PERMISSION_MODES);
  throw new Refused(
    "unsupported",
    `Claude Code takes no posture \`${posture}\`: its postures are ${
      words.slice(0, -1).join(", ")
    } and ${words.at(-1)}`,
  );
}

/**
 * main.ts's pre-schema refusal (lib/answer.ts `Declared.refuses`): a launch
 * or resume whose posture is a word outside the three is refused here, exit
 * 1, where the contract's enum would make it usage. A posture that is not a
 * string at all is the schema's to refuse.
 */
export function refusedPosture(verb: string, request: unknown): void {
  if (verb !== "launch" && verb !== "resume") return;
  if (typeof request !== "object" || request === null) return;
  const posture = (request as { posture?: unknown }).posture;
  if (typeof posture === "string") flagFor(posture);
}
