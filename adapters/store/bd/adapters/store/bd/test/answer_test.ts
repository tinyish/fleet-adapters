// lib/answer.ts: the exit table, the request held to the schema, and the
// shapes each exit writes. Also the schema reader and the type generator over
// the committed contract.

import { assert, assertEquals } from "@std/assert";
import {
  CONTRACT,
  CouldNotTell,
  type Handlers,
  Refused,
  respond,
} from "../lib/answer.ts";
import { KEYWORDS, type Schema, why } from "../lib/schema.ts";
import { generate } from "../scripts/types.ts";

const REQUEST = JSON.stringify({
  schema_version: 1,
  root: "/work/project",
  id: "a1",
});

const handlers: Handlers = {
  show: () =>
    Promise.resolve({
      item: { id: "fx-a1", title: "t", status: "open", type: "task" },
    }),
  resolve: () =>
    Promise.reject(
      new Refused("ambiguous", "a1 names two", ["fx-a1b", "fx-a1c"]),
    ),
  timeline: () => Promise.reject(new CouldNotTell("the database is locked")),
  version: () => Promise.reject(new TypeError("x is undefined")),
};

Deno.test("an answer carries schema_version beside the verb's fields, exit 0", async () => {
  assertEquals(await respond("show", REQUEST, handlers), {
    exit: 0,
    stdout: {
      schema_version: 1,
      item: { id: "fx-a1", title: "t", status: "open", type: "task" },
    },
  });
});

Deno.test("a refusal is exit 1 with its reason, message and candidates", async () => {
  assertEquals(await respond("resolve", REQUEST, handlers), {
    exit: 1,
    stdout: {
      schema_version: 1,
      refused: {
        reason: "ambiguous",
        message: "a1 names two",
        candidates: ["fx-a1b", "fx-a1c"],
      },
    },
    stderr: "a1 names two",
  });
});

/**
 * Could not tell is exit 3 with `error`, and so is anything the adapter did
 * not expect: never an exit off the table, which fleet reads as 3 anyway,
 * with nothing to say why.
 */
Deno.test("could not tell, and anything unexpected, is exit 3 with its error", async () => {
  assertEquals(await respond("timeline", REQUEST, handlers), {
    exit: 3,
    stdout: { schema_version: 1, error: "the database is locked" },
    stderr: "the database is locked",
  });
  const unexpected = await respond(
    "version",
    JSON.stringify({ schema_version: 1, root: "/r" }),
    handlers,
  );
  assertEquals(unexpected.exit, 3);
  assertEquals(
    unexpected.stderr,
    "the bd pack failed: TypeError: x is undefined",
  );
});

/**
 * Usage, exit 2, with nothing on stdout: an unknown verb, a verb this pack
 * does not answer yet, a request that is not JSON, one that fails its
 * schema — at another schema_version among them — and a relative root.
 */
Deno.test("a request the adapter does not speak is usage, exit 2", async () => {
  for (
    const [verb, stdin, said] of [
      [undefined, REQUEST, "`` is not a verb of the store contract"],
      [
        "frobnicate",
        REQUEST,
        "`frobnicate` is not a verb of the store contract",
      ],
      ["create", REQUEST, "the bd pack does not answer `create` yet"],
      ["scratch", REQUEST, "the bd pack does not answer `scratch` yet"],
      ["show", "{not json", "the request on stdin is not one JSON value"],
      [
        "show",
        JSON.stringify({ schema_version: 1, root: "/r" }),
        "$ carries no id",
      ],
      [
        "show",
        JSON.stringify({ schema_version: 2, root: "/r", id: "a1" }),
        "$.schema_version is 2, and it is 1",
      ],
      [
        "show",
        JSON.stringify({ schema_version: 1, root: "/r", id: 7 }),
        "$.id is 7, which is not string",
      ],
      [
        "show",
        JSON.stringify({ schema_version: 1, root: "relative", id: "a1" }),
        'the request\'s root is "relative", and it is an absolute path',
      ],
    ] as const
  ) {
    const outcome = await respond(verb, stdin, handlers);
    assertEquals(
      [outcome.exit, outcome.stdout],
      [2, undefined],
      `${verb} ${stdin}`,
    );
    assert(outcome.stderr?.includes(said), `${verb}: ${outcome.stderr}`);
  }
});

/** A message on more than one line is one line on stderr and in the answer. */
Deno.test("stderr's line is one line", async () => {
  const outcome = await respond("show", REQUEST, {
    show: () => Promise.reject(new CouldNotTell("first\n  second")),
  });
  assertEquals(outcome.stderr, "first second");
  assertEquals(outcome.stdout, { schema_version: 1, error: "first second" });
});

/** Every schema in the contract, walked: the keywords are the ones the reader knows. */
Deno.test("the committed contract uses only the keywords the reader and emitter know", async () => {
  const seen = new Set<string>();
  const walk = (schema: Schema): void => {
    if (typeof schema !== "object") return;
    for (const [word, held] of Object.entries(schema)) {
      seen.add(word);
      if (word === "properties") Object.values(held as object).forEach(walk);
      else if (word === "items") walk(held as Schema);
      else if (word === "anyOf" || word === "oneOf") {
        (held as Schema[]).forEach(walk);
      }
    }
  };
  Object.values(CONTRACT.$defs).forEach(walk);
  Object.values(CONTRACT.verbs).forEach(({ request, response }) => {
    walk(request);
    walk(response);
  });
  for (const word of seen) assert(KEYWORDS.has(word), word);
  const text = await Deno.readTextFile(
    new URL("../contract.json", import.meta.url),
  );
  assert((await generate(text)).includes("export type Verbs = {"));
});

/** The contract's own examples (docs/store.md) read, and a broken one does not. */
Deno.test("the schema reader reads the contract's examples", () => {
  const item = {
    id: "fx-a1b2",
    title: "Teach the parser the new stamp",
    status: "in_progress",
    type: "task",
    labels: ["fleet"],
    assignee: "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718",
    order: {
      state: "ordered",
      order: {
        kind: "dispatch",
        by: "seat:0199a3c4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        seat: "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718",
        at: "2026-09-23T10:00:00Z",
      },
    },
    blockers: ["fx-c3d4"],
    run: null,
    foreign: ["sprint"],
  };
  const show = CONTRACT.verbs.show.response;
  assertEquals(why(CONTRACT, show, { schema_version: 1, item }), null);
  assertEquals(
    why(CONTRACT, show, {
      schema_version: 1,
      item: {
        ...item,
        order: { state: "ordered", order: { kind: "dispatch" } },
      },
    }),
    "$.item.order.order carries no by",
  );
  assertEquals(
    why(CONTRACT, CONTRACT.verbs.list.request, {
      schema_version: 1,
      root: "/r",
      filter: { label: "x", assignee: "y" },
    }),
    "$.filter carries assignee, which it does not name",
  );
});
