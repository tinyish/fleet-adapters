// lib/answer.ts: the exit table, the request held to the schema, and the
// shapes each exit writes. Also the schema reader and the type generator over
// the committed contract.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  CONTRACT,
  CouldNotTell,
  type Handlers,
  Refused,
  respond,
} from "../lib/answer.ts";
import { KEYWORDS, type Schema, why } from "../lib/schema.ts";
import { generate } from "../scripts/types.ts";

const SEAT = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718";
const ENVELOPE = { schema_version: 1, root: "/work/project" };
const BARE = JSON.stringify(ENVELOPE);

/** docs/agent.md's `launch` example, at fleet 451a33d. */
const LAUNCH = {
  ...ENVELOPE,
  config_dir: "/work/seats/builder-e5f60718/agent",
  env: { FLEET_ACTOR: `seat:${SEAT}` },
  first_turn: "/wake builder-e5f60718",
  model: "quill-large-2",
  name: "builder-e5f60718",
  permissions: {
    commands: ["cargo", "make"],
    touched: "cargo nextest run -p fleet-core",
  },
  posture: "auto",
  seat: SEAT,
  worktree: "/work/lanes/builder-e5f60718",
};

/** A request each verb reads, the smallest the contract takes. */
const REQUESTS: Record<string, object> = {
  capabilities: ENVELOPE,
  version: ENVELOPE,
  launch: LAUNCH,
  resume: {
    ...ENVELOPE,
    session_id: "5d1c2a9e-4b3f-4e6a-9c8d-7e6f5a4b3c2d",
    worktree: "/work/lanes/builder-e5f60718",
    model: "claude-opus-5",
    posture: "ask",
  },
  read: { ...ENVELOPE, seats: [] },
  context: { ...ENVELOPE, seats: [] },
};

const handlers: Handlers = {
  capabilities: () =>
    Promise.resolve({
      postures: ["ask"],
      default_model: "m",
      first_turn: "/wake {seat}",
      measured: ["1.0.0"],
    }),
  launch: () =>
    Promise.reject(
      new Refused("unsupported", "claude-code takes no posture plan"),
    ),
  resume: () => Promise.reject(new CouldNotTell("claude could not be run")),
  version: () => Promise.reject(new TypeError("x is undefined")),
};

Deno.test("an answer carries schema_version beside the verb's fields, exit 0", async () => {
  assertEquals(await respond("capabilities", BARE, handlers), {
    exit: 0,
    stdout: {
      schema_version: 1,
      postures: ["ask"],
      default_model: "m",
      first_turn: "/wake {seat}",
      measured: ["1.0.0"],
    },
  });
});

Deno.test("a refusal is exit 1 with its reason and message", async () => {
  assertEquals(
    await respond("launch", JSON.stringify(LAUNCH), handlers),
    {
      exit: 1,
      stdout: {
        schema_version: 1,
        refused: {
          reason: "unsupported",
          message: "claude-code takes no posture plan",
        },
      },
      stderr: "claude-code takes no posture plan",
    },
  );
});

/**
 * Could not tell is exit 3 with `error`, and so is anything the adapter did
 * not expect: never an exit off the table, which fleet reads as 3 anyway,
 * with nothing to say why.
 */
Deno.test("could not tell, and anything unexpected, is exit 3 with its error", async () => {
  assertEquals(
    await respond("resume", JSON.stringify(REQUESTS.resume), handlers),
    {
      exit: 3,
      stdout: { schema_version: 1, error: "claude could not be run" },
      stderr: "claude could not be run",
    },
  );
  const unexpected = await respond("version", BARE, handlers);
  assertEquals(unexpected.exit, 3);
  assertEquals(
    unexpected.stderr,
    "the claude-code pack failed: TypeError: x is undefined",
  );
  assertEquals(unexpected.stdout, {
    schema_version: 1,
    error: "the claude-code pack failed: TypeError: x is undefined",
  });
});

/**
 * Usage, exit 2, with nothing on stdout: an unknown verb, a verb this pack
 * does not answer yet, a request that is not JSON, one that fails its
 * schema — at another schema_version among them — and a relative root.
 */
Deno.test("a request the adapter does not speak is usage, exit 2", async () => {
  for (
    const [verb, stdin, said] of [
      [undefined, BARE, "`` is not a verb of the agent contract"],
      [
        "frobnicate",
        BARE,
        "`frobnicate` is not a verb of the agent contract — the verbs are",
      ],
      ["capabilities", "{not json", "the request on stdin is not one JSON"],
      ["capabilities", "", "the request on stdin is not one JSON"],
      [
        "capabilities",
        JSON.stringify({ schema_version: 1 }),
        "$ carries no root",
      ],
      [
        "capabilities",
        JSON.stringify({ schema_version: 2, root: "/r" }),
        "$.schema_version is 2, and it is 1",
      ],
      [
        "launch",
        JSON.stringify({ ...LAUNCH, posture: "plan" }),
        '$.posture is "plan", which is none of ["ask","auto","unattended"]',
      ],
      [
        "launch",
        JSON.stringify({ ...LAUNCH, env: { FLEET_ACTOR: 7 } }),
        "$.env.FLEET_ACTOR is 7, which is not string",
      ],
      [
        "capabilities",
        JSON.stringify({ schema_version: 1, root: "relative" }),
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

/**
 * Every verb the contract names and no handler answers is usage, exit 2 —
 * never a crash: this row answers capabilities alone, and fleet-jymr.2–.4
 * fill the rest.
 */
Deno.test("a verb this pack does not answer yet is usage, exit 2, naming it", async () => {
  for (const verb of Object.keys(CONTRACT.verbs)) {
    if (verb === "capabilities") continue;
    const outcome = await respond(verb, JSON.stringify(REQUESTS[verb]), {});
    assertEquals([outcome.exit, outcome.stdout], [2, undefined], verb);
    assertEquals(
      outcome.stderr,
      `the claude-code pack does not answer \`${verb}\` yet`,
    );
  }
});

/** `context` of an adapter whose capabilities do not declare it is usage. */
Deno.test("context undeclared is usage, exit 2, before any handler runs", async () => {
  let ran = false;
  const outcome = await respond(
    "context",
    JSON.stringify(REQUESTS.context),
    {
      context: () => {
        ran = true;
        return Promise.resolve({ seats: [] });
      },
    },
    { context: false },
  );
  assertEquals([outcome.exit, outcome.stdout, ran], [2, undefined, false]);
  assertStringIncludes(outcome.stderr ?? "", "declares no context");
});

/**
 * A declared refusal runs on the parsed request BEFORE the schema reads it,
 * so a word the schema's enum would make usage is refused, exit 1, as ruling
 * 14 has a posture outside the three; what it lets through is still held to
 * the schema.
 */
Deno.test("a declared refusal runs before the schema, and its refusal is exit 1", async () => {
  const asked: unknown[] = [];
  const declared = {
    context: true,
    refuses: (verb: string, request: unknown) => {
      asked.push([verb, request]);
      if ((request as { posture?: unknown }).posture === "plan") {
        throw new Refused("unsupported", "no posture plan");
      }
    },
  };
  const refused = await respond(
    "launch",
    JSON.stringify({ ...LAUNCH, posture: "plan" }),
    handlers,
    declared,
  );
  assertEquals(refused.exit, 1);
  assertEquals(refused.stdout, {
    schema_version: 1,
    refused: { reason: "unsupported", message: "no posture plan" },
  });
  const malformed = await respond(
    "launch",
    JSON.stringify({ ...LAUNCH, env: { FLEET_ACTOR: 7 } }),
    handlers,
    declared,
  );
  assertEquals(malformed.exit, 2);
  const unparsed = await respond("launch", "{not json", handlers, declared);
  assertEquals(unparsed.exit, 2);
  assertEquals(asked.length, 2, "an unparsed request is refused nothing");
});

/** A message on more than one line is one line on stderr and in the answer. */
Deno.test("stderr's line is one line", async () => {
  const outcome = await respond("version", BARE, {
    version: () => Promise.reject(new CouldNotTell("first\n  second")),
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
      else if (word === "items" || word === "additionalProperties") {
        walk(held as Schema);
      } else if (word === "anyOf" || word === "oneOf") {
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
  const generated = await generate(text);
  assert(generated.includes("export type Verbs = {"));
  assertEquals(
    Object.keys(CONTRACT.verbs).sort(),
    ["capabilities", "context", "launch", "read", "resume", "version"],
  );
});

/** A map — launch's `env` — is an index signature over its values' type. */
Deno.test("the emitter types a map as its values, and refuses named keys beside one", async () => {
  const document = (verbs: object) =>
    JSON.stringify({
      schema_version: 1,
      $defs: {},
      verbs,
      refusal: { type: "object" },
      error: { type: "object" },
    });
  const map = {
    type: "object",
    properties: {
      env: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["env"],
  };
  const generated = await generate(
    document({ launch: { request: map, response: { type: "object" } } }),
  );
  assertStringIncludes(generated, "env: { [key: string]: string };");
  let refused = "";
  try {
    await generate(document({
      launch: {
        request: {
          type: "object",
          properties: { a: { type: "string" } },
          additionalProperties: { type: "string" },
        },
        response: { type: "object" },
      },
    }));
  } catch (error) {
    refused = String(error);
  }
  assertStringIncludes(refused, "named keys beside a map's values");
});

/** The contract's own examples (docs/agent.md) read, and a broken one does not. */
Deno.test("the schema reader reads the contract's examples", () => {
  assertEquals(why(CONTRACT, CONTRACT.verbs.launch.request, LAUNCH), null);
  const read = {
    schema_version: 1,
    seats: [
      {
        seat: SEAT,
        activity: "busy",
        evidence: "typed",
        session_id: "5d1c2a9e-4b3f-4e6a-9c8d-7e6f5a4b3c2d",
      },
      {
        seat: "0199a3c4-8f01-7a23-b456-c789d0e1f234",
        activity: "blocked",
        blocked_on: "permission",
        evidence: "screen",
      },
    ],
  };
  const response = CONTRACT.verbs.read.response;
  assertEquals(why(CONTRACT, response, read), null);
  assertEquals(
    why(CONTRACT, response, {
      ...read,
      seats: [{ ...read.seats[0], activity: "napping" }],
    }),
    '$.seats[0].activity is "napping", which is none of ["starting","busy","idle","blocked","unknown"]',
  );
  assertEquals(
    why(CONTRACT, CONTRACT.verbs.capabilities.response, {
      schema_version: 1,
      postures: ["ask"],
      default_model: "m",
      first_turn: "/wake {seat}",
      measured: ["1"],
      posture_models: { plan: ["m"] },
    }),
    "$.posture_models carries plan, which it does not name",
  );
});
