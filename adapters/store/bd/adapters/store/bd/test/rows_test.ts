// The mapping lib/rows.ts makes of a bd row: fleet's two keys, another
// writer's, the holder, the blockers and a comment — ported from tinyfleet's
// core/src/store/bd/mod.rs `tests` and bd_cli.rs `tests` at e416304, arm for
// arm, each named as it was there.

import { assert, assertEquals, assertThrows } from "@std/assert";
import { CouldNotTell } from "../lib/answer.ts";
import { shown } from "../lib/bd.ts";
import {
  entryOf,
  foreignOf,
  itemFrom,
  itemPrefixIn,
  stamped,
  summaryFrom,
  versioned,
} from "../lib/rows.ts";
import { answer, assertAnswers, fixture, rows, SEAT } from "./helpers.ts";

const BY = "seat:01a0d1f1-0aec-765f-9abe-0000001ead01";
const HOLDER = "01a0d1f1-0aec-765f-9abe-00000005ea71";
const AT = "2026-09-24T10:00:00Z";

function row(metadata: unknown): Record<string, unknown> {
  return { id: "fx-1", title: "an item", metadata };
}

function orderIn(index: unknown) {
  return itemFrom("fx-1", row({ "fleet.orders": index })).order;
}

function couldNotTell(read: () => unknown): string {
  return assertThrows(read, CouldNotTell).message;
}

Deno.test("the item prefix is read from the store config or is absent", () => {
  assertEquals(itemPrefixIn("# a comment\nissue-prefix: ap\n"), "ap");
  assertEquals(itemPrefixIn('issue-prefix: "ap"\n'), "ap");
  assertEquals(
    itemPrefixIn('# issue-prefix: ""\n'),
    null,
    "a commented line is not a value",
  );
  assertEquals(itemPrefixIn("issue-prefix:\n"), null);
  assertEquals(itemPrefixIn("database: dolt\n"), null);
});

Deno.test("an order index at its version is the order", () => {
  assertEquals(
    orderIn({ v: 1, by: BY, kind: "dispatch", seat: HOLDER, at: AT }),
    {
      state: "ordered",
      order: { kind: "dispatch", by: BY, at: AT, seat: HOLDER },
    },
  );
  assertEquals(
    orderIn({ v: 1, by: BY, kind: "dispatch", at: AT }),
    { state: "ordered", order: { kind: "dispatch", by: BY, at: AT } },
    "a transient dispatch's index names no seat yet",
  );
  assertEquals(
    orderIn({ v: 1, by: BY, kind: "review", seat: null, at: AT }),
    { state: "ordered", order: { kind: "review", by: BY, at: AT } },
    "a seat written null is one left out",
  );
  assertEquals(
    orderIn({
      v: 1,
      by: BY.toUpperCase().replace("SEAT:", "seat:"),
      kind: "dispatch",
      at: AT,
    }),
    { state: "ordered", order: { kind: "dispatch", by: BY, at: AT } },
    "a seat's id is printed as fleet prints one, in lowercase",
  );
});

Deno.test("an absent or null order index is none", () => {
  assertEquals(itemFrom("fx-1", row({})).order, { state: "none" });
  assertEquals(orderIn(null), { state: "none" });
});

/**
 * Not an object, at another version or none, partly filled, a field that is
 * not the type it names, or one the order does not carry: each is an index
 * this pack cannot read, and none is taken for absent.
 */
Deno.test("an order index that does not read as an order is unreadable", () => {
  for (
    const [label, index] of [
      ["a string", "not an object"],
      ["v 2", { v: 2, by: BY, kind: "dispatch", at: AT }],
      ["no v", { by: BY, kind: "dispatch", at: AT }],
      ["no by", { v: 1, kind: "dispatch", at: AT }],
      ["a bare by", { v: 1, by: "alberto", kind: "dispatch", at: AT }],
      ["a kind fleet gives none of", { v: 1, by: BY, kind: "build", at: AT }],
      ["an at that is no stamp", {
        v: 1,
        by: BY,
        kind: "dispatch",
        at: "then",
      }],
      ["an at out of range", {
        v: 1,
        by: BY,
        kind: "dispatch",
        at: "2026-13-01T00:00:00Z",
      }],
      ["a seat that is no id", {
        v: 1,
        by: BY,
        kind: "dispatch",
        seat: "s1",
        at: AT,
      }],
      ["a field it does not carry", {
        v: 1,
        by: BY,
        kind: "dispatch",
        at: AT,
        extra: 1,
      }],
    ] as const
  ) {
    assertEquals(orderIn(index), { state: "unreadable" }, label);
  }
});

Deno.test("a run record at its version is the record and absent is none", () => {
  const read = itemFrom(
    "fx-1",
    row({
      "fleet.run": {
        v: 1,
        hash: "h1",
        workflow: "greet",
        pack: "ts",
        entry: "greet.ts",
        started_at: AT,
      },
    }),
  );
  assertEquals(read.run, {
    hash: "h1",
    workflow: "greet",
    pack: "ts",
    entry: "greet.ts",
    started_at: AT,
  });
  for (const metadata of [{}, { "fleet.run": null }]) {
    assertEquals(
      itemFrom("fx-1", row(metadata)).run,
      null,
      JSON.stringify(metadata),
    );
  }
});

/**
 * An assignee that is no seat id is a person holding the item, and the read
 * refuses, naming the item and the holder as the store spells it: a
 * person-held item never reads as held by nobody.
 */
Deno.test("an assignee that is no seat id refuses the read", () => {
  for (const held of ["alice", "seat-1", "00000005ea71"]) {
    const read = { ...row({}), assignee: held };
    assertEquals(
      couldNotTell(() => itemFrom("fx", read)),
      `fx-1 is held by ${held}, which is not a seat of this fleet — a person holds it, and fleet reads only seat holders`,
      held,
    );
  }
});

/**
 * A seat's full id is the seat, and an absent assignee — or the empty one
 * `--assignee` is handed to clear it — is nobody.
 */
Deno.test("an assignee that is a seat id reads as the seat and none as nobody", () => {
  assertEquals(
    itemFrom("fx-1", { ...row({}), assignee: HOLDER }).assignee,
    HOLDER,
  );
  assertEquals(itemFrom("fx-1", { ...row({}), assignee: "" }).assignee, null);
  assertEquals(itemFrom("fx-1", { ...row({}), assignee: null }).assignee, null);
  assertEquals(itemFrom("fx-1", row({})).assignee, null);
});

/**
 * A record at another version, at none, not an object, or at v 1 and not a
 * record, refuses the whole read — the item is not answered as one carrying
 * no run.
 */
Deno.test("a run record this fleet does not read refuses the read", () => {
  for (
    const [held, version] of [
      [{ v: 2, hash: "h1" }, "v 2"],
      [{ hash: "h1" }, "v none"],
      ["a string", "v none"],
      [{ v: 1, hash: "h1" }, "v 1"],
    ] as const
  ) {
    const why = couldNotTell(() =>
      itemFrom("fx-1", row({ "fleet.run": held }))
    );
    assert(
      why.startsWith(
        `fx-1's run record is not one this fleet reads (fleet.run, ${version})`,
      ),
      `${JSON.stringify(held)}: ${why}`,
    );
  }
});

/**
 * Every metadata key but fleet's two is another writer's, named on the read
 * and on the listing's row alike — a bare `orders`, a nested `fleet` object
 * and a `fleet.` key fleet never writes among them — and metadata that is no
 * object, or none, names nothing.
 */
Deno.test("every metadata key but fleet's two is foreign on a read and a row", () => {
  const metadata = {
    "fleet.orders": { v: 1, by: BY, kind: "dispatch", at: AT },
    "fleet.run": null,
    orders: { owner: "alice" },
    "fleet.lane": "b",
    fleet: { run: "nested, and lost to bd's next top-level merge" },
    sprint: 7,
  };
  const wanted = ["fleet", "fleet.lane", "orders", "sprint"];
  assertEquals(
    itemFrom("fx-1", row(metadata)).foreign.toSorted(),
    wanted,
    "the read",
  );
  assertEquals(
    summaryFrom(row(metadata), "a listing")?.foreign?.toSorted(),
    wanted,
    "the listing's row",
  );
  for (const none of [{}, [1, 2], "a string", null]) {
    assertEquals(itemFrom("fx-1", row(none)).foreign, [], JSON.stringify(none));
  }
  assertEquals(foreignOf(undefined), []);
});

/**
 * THE KEYS ARE FLAT (the quirk that bd's `--metadata` merges at the top level
 * and replaces one key's object whole, keys.rs:13): a nested `fleet.orders`
 * inside a `fleet` object is no order, and the writers' one shape is
 * `{"<key>": {…, "v": 1}}` at the top.
 */
Deno.test("fleet's keys are read and written flat at the top level", () => {
  assertEquals(
    itemFrom(
      "fx-1",
      row({ fleet: { orders: { v: 1, by: BY, kind: "dispatch", at: AT } } }),
    )
      .order,
    { state: "none" },
  );
  assertEquals(stamped("fleet.orders", { kind: "dispatch" }), {
    "fleet.orders": { kind: "dispatch", v: 1 },
  });
  assertEquals(versioned("fleet.run", { v: 1, hash: "h" }), {
    v: 1,
    hash: "h",
  });
  assertEquals(
    versioned("fleet.run", { hash: "h" }),
    "`fleet.run` carries no v, and this pack reads v 1 and no other",
  );
});

/**
 * A listing's row reads its holder and its run's record as the item's own
 * read does: a seat and a record at v 1 are the row's, and a person holding
 * it or a record this pack does not read refuses the listing in `itemFrom`'s
 * words — never a row held by nobody or carrying no run.
 */
Deno.test("a listing row reads its holder and run as the item does", () => {
  const held = {
    ...row({
      "fleet.run": {
        v: 1,
        hash: "h1",
        workflow: "greet",
        pack: "ts",
        entry: "greet.ts",
        started_at: AT,
      },
    }),
    assignee: HOLDER,
  };
  const summary = summaryFrom(held, "a listing");
  const item = itemFrom("fx-1", held);
  assertEquals(summary?.assignee, item.assignee);
  assertEquals(summary?.assignee, HOLDER);
  assertEquals(summary?.run, item.run);
  assert(summary?.run !== null);

  const plain = summaryFrom(row({}), "a listing");
  assertEquals([plain?.assignee, plain?.run], [null, null]);

  const person = { ...row({}), assignee: "alice" };
  assertEquals(
    couldNotTell(() => summaryFrom(person, "a listing")),
    couldNotTell(() => itemFrom("fx-1", person)),
  );
  const unread = row({ "fleet.run": { v: 2, hash: "h1" } });
  assertEquals(
    couldNotTell(() => summaryFrom(unread, "a listing")),
    couldNotTell(() => itemFrom("fx-1", unread)),
  );
  assertEquals(summaryFrom({ title: "a row naming no id" }, "a listing"), null);
});

/**
 * Every field a verb asserts on, off bd 1.3.0's own answer: the open `blocks`
 * is the one blocker, the closed one and the `discovered-from` are not.
 *
 * THE RECORDING PREDATES THE TYPED RECORD, THE TYPED ORDER AND THE TYPED
 * HOLDER. Its `fleet.run` is no run's record — `{"v":1,"ok":true,"steps":[1,2]}`
 * — so the row as recorded refuses the read, naming the key and its version;
 * with the run taken off, its assignee `seat-1` is no seat id, so the read
 * refuses naming the holder; and its order index names `alberto`, who is no
 * typed actor, so with a seat's id put in as the holder the index reads as
 * present and unreadable.
 */
Deno.test("a recorded show reads into the item a verb asserts on", () => {
  const recorded = shown("fx", answer(fixture("show")), "");
  assert(
    couldNotTell(() => itemFrom("fx", recorded)).includes(
      "'s run record is not one this fleet reads (fleet.run, v 1)",
    ),
  );

  const metadata = { ...(recorded.metadata as Record<string, unknown>) };
  delete metadata["fleet.run"];
  const unrun = { ...recorded, metadata };
  assert(
    couldNotTell(() => itemFrom("fx", unrun)).endsWith(
      " is held by seat-1, which is not a seat of this fleet — a person holds it, and fleet reads only seat holders",
    ),
  );

  const item = itemFrom("fx", { ...unrun, assignee: SEAT });
  const upstreamOpen =
    (recorded.dependencies as { id: string; title: string }[])
      .find((dependency) => dependency.title === "upstream open")?.id;
  assertEquals(item.title, "downstream");
  assertEquals(item.status, "open");
  assertEquals(item.type, "task");
  assertEquals(item.assignee, SEAT);
  assertEquals(item.labels, ["fleet", "fleet:run"]);
  assertEquals(item.blockers, [upstreamOpen]);
  assertEquals(item.order, { state: "unreadable" });
  assertEquals(item.run, null);
  assert(item.id?.startsWith("fx-"), `the answer's id wins: ${item.id}`);
  assertAnswers("show", { item });
});

/**
 * The three states of the order index, off bd 1.3.0's answers where it has
 * them: a key holding no object, and no fleet key at all — which is what a
 * row holding only another writer's bare `orders` and `run` answers.
 */
Deno.test("an orders key holding no object is present and unreadable", () => {
  const recorded = shown("fx", answer(fixture("show_unreadable_orders")), "");
  assertEquals(itemFrom("fx", { ...recorded, assignee: SEAT }).order, {
    state: "unreadable",
  });

  const bare = rows(fixture("ready")).find((row) =>
    row.title === "discovered source"
  );
  const metadata = bare?.metadata as Record<string, unknown>;
  assert(
    typeof metadata.orders === "object" && typeof metadata.run === "string",
  );
  const item = itemFrom("fx", bare!);
  assertEquals([item.order, item.run], [{ state: "none" }, null]);
});

/** Metadata that is not an object at all holds no order index and no run. */
Deno.test("metadata that is not an object holds no orders", () => {
  const item = itemFrom("fx-1", { id: "fx-1", metadata: [1, 2] });
  assertEquals([item.order, item.run], [{ state: "none" }, null]);
});

/**
 * A row that does not read is named by where it fails: the row's id and the
 * path to the key.
 */
Deno.test("a row that does not decode names its id and key", () => {
  const why = couldNotTell(() =>
    itemFrom("fx-1", { id: "fx-1", labels: ["fleet", 3] })
  );
  assert(why.includes("fx-1") && why.includes("labels[1]"), why);
  const deep = couldNotTell(() =>
    itemFrom("fx-1", { id: "fx-1", dependencies: [{ id: 7, status: "open" }] })
  );
  assert(deep.includes("dependencies[0].id"), deep);
});

/**
 * Each recorded listing reads row for row once the holder is a seat's id and
 * the recorded run — no run's record — is taken off, and every summary reads
 * as the contract's. The in-process adapter held each row to bd's generated
 * wire types too (every key bd printed named by the type); this pack carries
 * no generated bd types, so that arm is not ported.
 */
Deno.test("recorded list and ready rows read as summaries", () => {
  for (const name of ["list", "list_assigned", "ready"]) {
    const items = rows(fixture(name)).map((recorded) => {
      const metadata = {
        ...(recorded.metadata as Record<string, unknown> ?? {}),
      };
      delete metadata["fleet.run"];
      const seated = recorded.assignee === undefined ? {} : { assignee: SEAT };
      return summaryFrom({ ...recorded, ...seated, metadata }, name);
    });
    assert(items.length > 0 && items.every((item) => item !== null), name);
    assertAnswers("list", { items });
  }
  const gates = rows(fixture("gate_list"));
  assertEquals(
    gates.map((gate) => gate.id),
    ["fx-5dm"],
    "fleet-rsia.4 reads a gate's id",
  );
});

const COMMENT = {
  id: "3c35be43-620e-528a-9f51-0aa24d587b44",
  issue_id: "fx-v8u",
  author: "seat:0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718",
  text: '{"fleet.entry":1,"kind":"ordered","order":"dispatch","seat":null}',
  created_at: "2026-09-26T03:16:12Z",
};

/** A comment bd 1.3.0 answered (measured), as the entry fleet appended. */
Deno.test("a fleet comment is its entry, with the store's id, time and author", () => {
  const entry = entryOf("fx-v8u", COMMENT, 0);
  assertEquals(entry, {
    kind: "ordered",
    order: "dispatch",
    seat: null,
    id: COMMENT.id,
    at: COMMENT.created_at,
    by: COMMENT.author,
  });
  assertAnswers("timeline", { entries: [entry] });
});

/** A person's text — no JSON object, or one without the key — is no entry. */
Deno.test("a person's comment is left out of the timeline", () => {
  for (const text of ["a person says hi", '{"kind":"ordered"}', "[1]", ""]) {
    assertEquals(entryOf("fx-v8u", { ...COMMENT, text }, 0), null, text);
  }
});

/**
 * A comment that carries the key and does not read refuses the whole
 * timeline, naming the comment: another version, a body its kind refuses,
 * and an author that is no actor.
 */
Deno.test("a fleet comment that does not read refuses the timeline", () => {
  const refused = (comment: object) =>
    couldNotTell(() => entryOf("fx-v8u", comment, 0));
  assert(
    refused({
      ...COMMENT,
      text: '{"fleet.entry":2,"kind":"ordered","order":"dispatch"}',
    })
      .includes("carries fleet.entry 2, and this pack reads version 1"),
  );
  const bodied = refused({
    ...COMMENT,
    text: '{"fleet.entry":1,"kind":"ordered","order":"x"}',
  });
  assert(
    bodied.startsWith(`fx-v8u's comment ${COMMENT.id} carries fleet.entry`),
    bodied,
  );
  assertEquals(
    refused({ ...COMMENT, author: "alberto" }),
    `fx-v8u's comment ${COMMENT.id} names its author alberto, which is not an actor reference (<kind>:<id>)`,
  );
  assert(refused({ ...COMMENT, text: 7 }).includes("`text`"));
});
