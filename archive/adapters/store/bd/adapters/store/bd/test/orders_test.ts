// order.set, run.set and order.withdraw — and lib/written.ts, which reads
// their failures — over a bd that answers what bd 1.3.0 answered, recorded
// on a scratch board (`bd init --prefix fx`, BD_JSON_ENVELOPE=1) for
// fleet-rsia.4: the stderr of a fence bd did not meet and of an id no item
// carries, each quoted below as bd printed it.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { CouldNotTell, type Handler, Refused } from "../lib/answer.ts";
import { Bd, type Ran } from "../lib/bd.ts";
import { orderOf, runOf } from "../lib/rows.ts";
import { missingIn } from "../lib/write.ts";
import {
  fencedOn,
  metadataWrite,
  orderFields,
  orders,
  withdrawal,
} from "../verbs/orders.ts";
import { clearing, raising } from "../verbs/holds.ts";
import { fake, SEAT } from "./helpers.ts";

const ROOT = "/work/project";
const ID = "fx-6oa";
const BY = "run:fleet-conformance";
const OTHER = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60719";
const ENVELOPE_ON = { schema_version: 1 as const, root: ROOT };

/** bd 1.3.0's stderr for a withdrawal fenced on a seat that does not hold the item. */
const ASSIGNEE_MISMATCH =
  `Error updating ${ID}: assignee mismatch: ${ID} is held by "${SEAT}", expected "${OTHER}"
Error: 1 of 1 issues failed to update
  ${ID}: updating issue: assignee mismatch: ${ID} is held by "${SEAT}", expected "${OTHER}"
`;

/** …and for one fenced on a status the item does not read. */
const STATUS_MISMATCH =
  `Error updating ${ID}: status mismatch: ${ID} has status "closed", expected "open"
Error: 1 of 1 issues failed to update
  ${ID}: updating issue: status mismatch: ${ID} has status "closed", expected "open"
`;

/** …and for an update of an id no item carries. */
const UPDATE_MISSING =
  `Error resolving fx-nope: no issue found matching "fx-nope"
Error: 1 of 1 issues failed to update
  fx-nope: resolving issue: no issue found matching "fx-nope"
`;

/** A write bd took: its own line, measured. */
const UPDATED = `✓ Updated issue: ${ID} — an item to hold\n`;

function over(answers: (args: string[]) => Partial<Ran>) {
  const { runner, calls } = fake(answers);
  const verbs = orders((root) => new Bd(root, "bd", runner));
  // deno-lint-ignore no-explicit-any
  const verb = (name: string) => verbs[name as "order.set"] as Handler<any>;
  return { verb, calls };
}

const ORDER = {
  kind: "dispatch" as const,
  by: "run:fleet-conformance-architect",
  seat: SEAT,
  at: "2026-09-13T00:00:00Z",
};
const RECORD = {
  hash: "h1",
  workflow: "greet",
  pack: "ts",
  entry: "greet.ts",
  started_at: "2026-09-13T00:00:00Z",
};

/**
 * ONE `--metadata` WRITE OF THE ONE KEY, stamped `v: 1`, and nothing of the
 * other: bd merges at the top level and replaces the one key whole, so a
 * write that carried both — or one nested `fleet` object — would lose the
 * other writer's key.
 */
Deno.test("order.set and run.set each write their own key alone, stamped", async () => {
  const { verb, calls } = over(() => ({ stdout: UPDATED }));
  assertEquals(
    await verb("order.set")({ ...ENVELOPE_ON, id: ID, by: BY, order: ORDER }),
    {},
  );
  assertEquals(
    await verb("run.set")({ ...ENVELOPE_ON, id: ID, by: BY, run: RECORD }),
    {},
  );
  assertEquals(calls.map((call) => call.args), [
    [
      "-C",
      ROOT,
      "update",
      `--metadata=${JSON.stringify({ "fleet.orders": { ...ORDER, v: 1 } })}`,
      `--actor=${BY}`,
      "--",
      ID,
    ],
    [
      "-C",
      ROOT,
      "update",
      `--metadata=${JSON.stringify({ "fleet.run": { ...RECORD, v: 1 } })}`,
      `--actor=${BY}`,
      "--",
      ID,
    ],
  ]);
  // What each wrote reads back through the readers of rows.ts.
  const written = calls.map((call) =>
    JSON.parse(call.args[3].slice("--metadata=".length))
  );
  assertEquals(orderOf(written[0]), { state: "ordered", order: ORDER });
  assertEquals(runOf(ID, written[1]), RECORD);
  assertEquals(Object.keys(written[0]), ["fleet.orders"]);
  assertEquals(Object.keys(written[1]), ["fleet.run"]);
});

/** An order naming no seat is written with the seat left out, never null. */
Deno.test("an order naming no seat is written without one", () => {
  const { seat: _, ...transient } = ORDER;
  assertEquals(orderFields({ ...transient, seat: null }), transient);
  assertEquals(orderFields(transient), transient);
  const args = metadataWrite(ID, BY, "fleet.orders", orderFields(transient));
  assert(!args[1].includes("seat"), args[1]);
});

Deno.test("a metadata write to an id no item carries is missing, and any other failure could not tell", async () => {
  const missing = over(() => ({ code: 1, stderr: UPDATE_MISSING }));
  const why = await assertRejects(
    () =>
      missing.verb("order.set")({
        ...ENVELOPE_ON,
        id: "fx-nope",
        by: BY,
        order: ORDER,
      }),
    Refused,
  );
  assertEquals(why.reason, "missing");
  assert(why.message.startsWith("fx-nope is not in the store"), why.message);

  const locked = over(() => ({
    code: 1,
    stderr: "Error: database is locked\n",
  }));
  const not = await assertRejects(
    () =>
      locked.verb("run.set")({ ...ENVELOPE_ON, id: ID, by: BY, run: RECORD }),
    CouldNotTell,
  );
  assert(
    not.message.endsWith("exited 1: Error: database is locked"),
    not.message,
  );
});

/**
 * EACH WRITE CARRIES ITS ITEM AS AN ARGUMENT OF ITS OWN, which is how
 * lib/write.ts reads bd's word that the item is not there: a `--blocks=<id>`
 * would carry no argument the words name.
 */
Deno.test("each write here carries the id bd's not-found words name", () => {
  const nope = "fx-nope";
  for (
    const [args, said, error] of [
      [metadataWrite(nope, BY, "fleet.run", {}), UPDATE_MISSING, undefined],
      [withdrawal(nope, BY, { if_assignee: null }), UPDATE_MISSING, undefined],
      [raising(nope, BY, "r"), "", "issue not found: fx-nope"],
      [clearing(nope, BY), "Error: gate not found: fx-nope\n", undefined],
    ] as const
  ) {
    assertEquals(missingIn([...args], said, error)?.item, nope, args.join(" "));
  }
  assertEquals(
    missingIn(
      metadataWrite("fx-other", BY, "fleet.run", {}),
      UPDATE_MISSING,
      undefined,
    ),
    undefined,
    "only the id the write named",
  );
});

/**
 * THE WITHDRAWAL IS ONE UPDATE: the fence, the cleared assignee, the one key
 * unset and the reopen ride the same call, so after any exit an item never
 * has its assignee cleared while its order stands.
 */
Deno.test("order.withdraw is one update carrying the fence, the clear and the reopen", async () => {
  const { verb, calls } = over(() => ({ stdout: UPDATED }));
  await verb("order.withdraw")({
    ...ENVELOPE_ON,
    id: ID,
    by: BY,
    if_assignee: SEAT,
    if_status: "in_progress",
    reopen: true,
  });
  assertEquals(calls.length, 1, "one call and no second write");
  assertEquals(calls[0].args, [
    "-C",
    ROOT,
    "update",
    `--if-assignee=${SEAT}`,
    "--if-status=in_progress",
    "--assignee=",
    "--unset-metadata=fleet.orders",
    "--status=open",
    `--actor=${BY}`,
    "--",
    ID,
  ]);
});

/**
 * A fence on nobody is `--if-assignee=` and a fence left out is none; a
 * status fence of `null` is none; no reopen, no status.
 */
Deno.test("a withdrawal's fence is sent as the request states it", () => {
  const tail = ["--assignee=", "--unset-metadata=fleet.orders"];
  const end = [`--actor=${BY}`, "--", ID];
  assertEquals(withdrawal(ID, BY, {}), ["update", ...tail, ...end]);
  assertEquals(withdrawal(ID, BY, { if_assignee: null, if_status: null }), [
    "update",
    "--if-assignee=",
    ...tail,
    ...end,
  ]);
  assertEquals(withdrawal(ID, BY, { if_status: "closed", reopen: false }), [
    "update",
    "--if-status=closed",
    ...tail,
    ...end,
  ]);
  assertEquals(fencedOn({}), undefined);
  assertEquals(fencedOn({ if_status: null }), undefined);
  assertEquals(fencedOn({ if_assignee: null }), "held by nobody");
  assertEquals(fencedOn({ if_status: "closed" }), "closed");
  assertEquals(
    fencedOn({ if_assignee: SEAT, if_status: "open" }),
    `held by \`${SEAT}\` as open`,
  );
});

/**
 * EXIT 13 IS MOVED, naming the item and bd's own mismatch line whole — the
 * seat that holds the item, or the status it reads — and nothing more is
 * run: bd wrote nothing of the call.
 */
Deno.test("a withdrawal whose fence the item does not meet is moved, with nothing written", async () => {
  for (
    const [stderr, fence, named] of [
      [ASSIGNEE_MISMATCH, { if_assignee: OTHER, if_status: "open" }, SEAT],
      [STATUS_MISMATCH, { if_assignee: SEAT, if_status: "open" }, "closed"],
    ] as const
  ) {
    const { verb, calls } = over(() => ({ code: 13, stderr }));
    const why = await assertRejects(
      () =>
        verb("order.withdraw")({
          ...ENVELOPE_ON,
          id: ID,
          by: BY,
          reopen: true,
          ...fence,
        }),
      Refused,
    );
    assertEquals(why.reason, "moved");
    assert(why.message.startsWith(`${ID} is not held by`), why.message);
    assert(why.message.includes(named), why.message);
    assert(why.message.includes("nothing was written"), why.message);
    assertEquals(calls.length, 1);
  }
});

/**
 * An unfenced withdrawal is a plain write: bd's exit 13 cannot come of it,
 * and any failure but a missing item is could not tell.
 */
Deno.test("an unfenced withdrawal refuses missing, and nothing else as moved", async () => {
  const missing = over(() => ({ code: 1, stderr: UPDATE_MISSING }));
  const why = await assertRejects(
    () =>
      missing.verb("order.withdraw")({ ...ENVELOPE_ON, id: "fx-nope", by: BY }),
    Refused,
  );
  assertEquals(why.reason, "missing");
  const fencedMissing = over(() => ({ code: 1, stderr: UPDATE_MISSING }));
  const also = await assertRejects(
    () =>
      fencedMissing.verb("order.withdraw")({
        ...ENVELOPE_ON,
        id: "fx-nope",
        by: BY,
        if_assignee: null,
      }),
    Refused,
  );
  assertEquals(also.reason, "missing");
  const held = over(() => ({
    code: 1,
    stderr: `Error: cannot reassign ${ID}: held by "${SEAT}" (in_progress)\n`,
  }));
  await assertRejects(
    () => held.verb("order.withdraw")({ ...ENVELOPE_ON, id: ID, by: BY }),
    CouldNotTell,
  );
});

/**
 * bd's mismatch line is carried WHOLE, and not stderr's last line cut to 160
 * characters: with a long id, the cut line has lost the seat holding it.
 */
Deno.test("a moved refusal names the holder however long the id", async () => {
  const long = `fx-${"a".repeat(80)}`;
  const stderr = ASSIGNEE_MISMATCH.replaceAll(ID, long);
  const { verb } = over(() => ({ code: 13, stderr }));
  const why = await assertRejects(
    () =>
      verb("order.withdraw")({
        ...ENVELOPE_ON,
        id: long,
        by: BY,
        if_assignee: OTHER,
      }),
    Refused,
  );
  assert(why.message.includes(`is held by "${SEAT}"`), why.message);
});
