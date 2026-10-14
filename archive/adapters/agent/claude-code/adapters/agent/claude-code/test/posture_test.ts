// lib/posture.ts: fleet's three posture words onto Claude Code's
// --permission-mode (ruling 14), and every other word refused, naming it and
// the three.

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { Refused } from "../lib/answer.ts";
import { CAPABILITIES } from "../lib/capabilities.ts";
import { flagFor, PERMISSION_MODES, refusedPosture } from "../lib/posture.ts";

Deno.test("flagFor: ask, auto and unattended are default, auto and dontAsk", () => {
  assertEquals(flagFor("ask"), "default");
  assertEquals(flagFor("auto"), "auto");
  assertEquals(flagFor("unattended"), "dontAsk");
});

/** A posture is declared exactly where launch takes it, and no other. */
Deno.test("the mapping keys exactly the declared postures", () => {
  assertEquals(Object.keys(PERMISSION_MODES), CAPABILITIES.postures);
});

/**
 * Core reads no old spellings (fleet-1jr1e, ruling 17), and neither does the
 * pack: Claude Code's own mode names, the retired words and anything off the
 * object's prototype are refused unsupported, naming the word and the three.
 */
Deno.test("flagFor: any other word is refused unsupported, naming it and the three", () => {
  for (
    const word of [
      "acceptEdits",
      "default",
      "dontAsk",
      "bypassPermissions",
      "Ask",
      "",
      "toString",
      "__proto__",
    ]
  ) {
    const refused = assertThrows(() => flagFor(word), Refused);
    assertEquals(refused.reason, "unsupported");
    assertEquals(
      refused.message,
      `Claude Code takes no posture \`${word}\`: its postures are ask, auto and unattended`,
    );
  }
});

/**
 * The refusal is taken BEFORE the schema reads the request: the contract's
 * posture is an enum, and a word outside it would otherwise be usage, exit
 * 2, where ruling 14 has it refused, exit 1.
 */
Deno.test("refusedPosture: launch and resume refuse an unknown posture; nothing else is read", () => {
  for (const verb of ["launch", "resume"]) {
    const refused = assertThrows(
      () => refusedPosture(verb, { posture: "acceptEdits" }),
      Refused,
    );
    assertStringIncludes(refused.message, "`acceptEdits`");
    refusedPosture(verb, { posture: "auto" });
    // Not a word at all: the schema's to refuse, as usage.
    refusedPosture(verb, { posture: 3 });
    refusedPosture(verb, {});
    refusedPosture(verb, null);
    refusedPosture(verb, "text");
  }
  refusedPosture("read", { posture: "acceptEdits" });
  refusedPosture("capabilities", { posture: "acceptEdits" });
});
