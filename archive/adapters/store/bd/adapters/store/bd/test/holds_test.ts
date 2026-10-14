// hold.raise, hold.clear and holds.open over a bd that answers what bd 1.3.0
// answered. The fixtures gate_create, gate_create_missing, gate_list_empty
// and show_gate_closed were recorded for fleet-rsia.4 on a scratch board
// (`bd init --prefix fx`, BD_JSON_ENVELOPE=1, the owner scrubbed): a gate
// raised on fx-6oa, the listing once it was resolved, the gate's own row
// after, and a gate raised on an id no item carries.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { CouldNotTell, type Handler, Refused } from "../lib/answer.ts";
import { Bd, type Ran } from "../lib/bd.ts";
import { clearing, holds, OPEN_HOLDS, raising } from "../verbs/holds.ts";
import { assertAnswers, fake, fixture } from "./helpers.ts";

const ROOT = "/work/project";
const ENVELOPE_ON = { schema_version: 1 as const, root: ROOT };
const BY = "run:fleet-conformance";
const HOLD = "fx-sct";

/** bd 1.3.0's line for a resolve, the first and every one after. */
const RESOLVED = `✓ Gate resolved: ${HOLD}\n`;

function over(answers: (args: string[]) => Partial<Ran>) {
  const { runner, calls } = fake(answers);
  const verbs = holds((root) => new Bd(root, "bd", runner));
  // deno-lint-ignore no-explicit-any
  const verb = (name: string) => verbs[name as "hold.raise"] as Handler<any>;
  return { verb, calls };
}

/** An open gate's row: the closed one recorded, before it was resolved. */
const OPEN_GATE = fixture("show_gate_closed").replace(
  '"status": "closed"',
  '"status": "open"',
);

/**
 * A GATE, NO `--type`: human is what bd files with none (measured on
 * 1.3.0), and the id comes off the JSON answer.
 */
Deno.test("hold.raise files a gate blocking the item and answers its id", async () => {
  const { verb, calls } = over(() => ({ stdout: fixture("gate_create") }));
  const answer = await verb("hold.raise")({
    ...ENVELOPE_ON,
    id: "fx-6oa",
    by: BY,
    reason: "-a reason opening with a dash",
  });
  assertEquals(answer, { hold: HOLD });
  assertAnswers("hold.raise", answer);
  assertEquals(calls[0].args, [
    "-C",
    ROOT,
    "gate",
    "create",
    "--blocks",
    "fx-6oa",
    "--reason=-a reason opening with a dash",
    `--actor=${BY}`,
    "--json",
  ]);
  assert(!calls[0].args.some((arg) => arg.startsWith("--type")));
  assertEquals(raising("x", "y", "z").length, 7);
});

/** Measured on 1.3.0: exit 1, `{"error": "issue not found: <id>"}`, no stderr. */
Deno.test("a hold raised on an item that is not there is missing", async () => {
  const { verb } = over(() => ({
    code: 1,
    stdout: fixture("gate_create_missing"),
  }));
  const why = await assertRejects(
    () =>
      verb("hold.raise")({
        ...ENVELOPE_ON,
        id: "fx-nope",
        by: BY,
        reason: "r",
      }),
    Refused,
  );
  assertEquals(why.reason, "missing");
  const silent = over(() => ({ stdout: '{"data":{},"schema_version":1}' }));
  await assertRejects(
    () =>
      silent.verb("hold.raise")({
        ...ENVELOPE_ON,
        id: "fx-6oa",
        by: BY,
        reason: "r",
      }),
    CouldNotTell,
    "answered no id",
  );
});

/**
 * A SECOND CLEAR IS READ FIRST: bd resolves a resolved gate again with exit
 * 0 and writes nothing, so the gate's own row is read and a closed one
 * answers `already`, with no resolve run.
 */
Deno.test("a clear of a cleared hold answers already, and runs no resolve", async () => {
  const { verb, calls } = over((args) =>
    args[0] === "show"
      ? { stdout: fixture("show_gate_closed") }
      : { stdout: RESOLVED }
  );
  const why = await assertRejects(
    () => verb("hold.clear")({ ...ENVELOPE_ON, hold: HOLD, by: BY }),
    Refused,
  );
  assertEquals(why.reason, "already");
  assertEquals(why.message, `${HOLD} is already cleared`);
  assertEquals(calls.map((call) => call.args[2]), ["show"]);
});

Deno.test("a clear of an open hold reads it, then resolves it", async () => {
  const { verb, calls } = over((args) =>
    args[0] === "show" ? { stdout: OPEN_GATE } : { stdout: RESOLVED }
  );
  assertEquals(
    await verb("hold.clear")({ ...ENVELOPE_ON, hold: HOLD, by: BY }),
    {},
  );
  assertEquals(calls.map((call) => call.args.slice(2)), [
    ["show", "--json", "--", HOLD],
    clearing(HOLD, BY),
  ]);
});

/**
 * A hold that is not there is missing off the read; an item that is no gate
 * is no hold, and missing too, with no resolve run.
 */
Deno.test("a clear of a hold that is not there, or of an item that is no gate, is missing", async () => {
  const absent = over(() => ({
    code: 1,
    stdout: fixture("show_missing"),
  }));
  const gone = await assertRejects(
    () =>
      absent.verb("hold.clear")({ ...ENVELOPE_ON, hold: "fx-nope", by: BY }),
    Refused,
  );
  assertEquals(gone.reason, "missing");

  const task = over(() => ({
    stdout: OPEN_GATE.replace('"issue_type": "gate"', '"issue_type": "task"'),
  }));
  const no = await assertRejects(
    () => task.verb("hold.clear")({ ...ENVELOPE_ON, hold: HOLD, by: BY }),
    Refused,
  );
  assertEquals(no.reason, "missing");
  assertEquals(task.calls.length, 1, "no resolve was run");

  // bd's own word, where the gate goes between the read and the resolve.
  const raced = over((args) =>
    args[0] === "show"
      ? { stdout: OPEN_GATE }
      : { code: 1, stderr: `Error: gate not found: ${HOLD}\n` }
  );
  const lost = await assertRejects(
    () => raced.verb("hold.clear")({ ...ENVELOPE_ON, hold: HOLD, by: BY }),
    Refused,
  );
  assertEquals(lost.reason, "missing");
});

/**
 * UNCAPPED, IDS ONLY, AND `null` IS NONE: `gate list` caps at 50 by default
 * and answers `null` on a board holding no open gate (both measured on
 * 1.3.0).
 */
Deno.test("holds.open answers every open gate's id, and null as none", async () => {
  const one = over(() => ({ stdout: fixture("gate_list") }));
  const answer = await one.verb("holds.open")(ENVELOPE_ON);
  assertEquals(answer, { holds: ["fx-5dm"] });
  assertAnswers("holds.open", answer);
  assertEquals(one.calls[0].args, ["-C", ROOT, ...OPEN_HOLDS]);
  assertEquals(OPEN_HOLDS.slice(-2), ["-n", "0"]);

  const none = over(() => ({ stdout: fixture("gate_list_empty") }));
  assertEquals(await none.verb("holds.open")(ENVELOPE_ON), { holds: [] });

  const odd = over(() => ({ stdout: '{"data":[7],"schema_version":1}' }));
  await assertRejects(
    () => odd.verb("holds.open")(ENVELOPE_ON),
    CouldNotTell,
    "no object",
  );
});
