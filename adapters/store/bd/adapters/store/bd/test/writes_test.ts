// The plain writes over a bd that answers from recorded text: the argv each
// sends, each answer read as the contract reads it, and each bd 1.3.0 quirk
// the writes carry on the answer bd gave.
//
// THE RECORDINGS: create.json, comment_add.json, comment_add_missing.json and
// show_closed.json were recorded from bd 1.3.0 (Homebrew) with
// BD_JSON_ENVELOPE=1 on a scratch board (`bd init --prefix fx`), the owner
// scrubbed as the other fixtures' is; the stderr texts below were copied from
// the same board's calls.

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CouldNotTell,
  type Handler,
  Refused,
  respond,
  Usage,
} from "../lib/answer.ts";
import { Bd, type Ran } from "../lib/bd.ts";
import { mismatchIn, missingIn } from "../lib/write.ts";
import {
  actorText,
  closer,
  labelFlag,
  wireText,
  writes,
} from "../verbs/writes.ts";
import { assertAnswers, fake, fixture } from "./helpers.ts";

const ROOT = "/work/project";
const S1 = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718";
const S2 = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60719";
const ENVELOPE_ON = { schema_version: 1 as const, root: ROOT };

/** bd 1.3.0's stderr for `update --if-assignee=S1 …` on an item S2 holds: exit 13. */
const MISMATCH_SEAT =
  `Error updating fx-56s: assignee mismatch: fx-56s is held by "${S2}", expected "${S1}"
Error: 1 of 1 issues failed to update
  fx-56s: updating issue: assignee mismatch: fx-56s is held by "${S2}", expected "${S1}"
`;

/** bd 1.3.0's stderr for `update --if-assignee= …` on an item S2 holds: exit 13. */
const MISMATCH_NOBODY =
  `Error updating fx-56s: assignee mismatch: fx-56s is held by "${S2}", expected ""
Error: 1 of 1 issues failed to update
  fx-56s: updating issue: assignee mismatch: fx-56s is held by "${S2}", expected ""
`;

/** bd 1.3.0's stderr for any `update … -- fx-nobody`, fenced or not: exit 1. */
const UPDATE_MISSING =
  `Error resolving fx-nobody: no issue found matching "fx-nobody"
Error: 1 of 1 issues failed to update
  fx-nobody: resolving issue: no issue found matching "fx-nobody"
`;

/** bd 1.3.0's stderr for an unfenced `--assignee` of an in_progress item by a non-holder: exit 1. */
const CANNOT_REASSIGN =
  `cannot reassign fx-56s: held by "${S2}" (in_progress); coordinate with the holder (bd mail ${S2}) — pass --force only if their claim is abandoned (crashed agent, expired lease), or use bd reclaim
Error: 1 of 1 issues failed to update
  fx-56s: cannot reassign fx-56s: held by "${S2}" (in_progress); coordinate with the holder (bd mail ${S2}) — pass --force only if their claim is abandoned (crashed agent, expired lease), or use bd reclaim
`;

/** bd 1.3.0's stderr for `close --actor=seat:S2 -- fx-56s` on an item S2 holds: exit 1. */
const CANNOT_CLOSE =
  `cannot close fx-56s: assignee is "${S2}", actor is "seat:${S2}"; reclaim or use --force to override
`;

/** The writes over a fake bd answering `answers`, and the calls it was handed. */
function over(answers: (args: string[]) => Partial<Ran>) {
  const { runner, calls } = fake(answers);
  const verbs = writes((root) => new Bd(root, "bd", runner));
  // deno-lint-ignore no-explicit-any
  const verb = (name: string) => verbs[name as "update"] as Handler<any>;
  /** The argv after `-C <root>` of each call made. */
  const argv = () => calls.map((call) => call.args.slice(2));
  return { verb, calls, argv };
}

async function refusal(promise: Promise<unknown>): Promise<Refused> {
  return await assertRejects(() => promise, Refused);
}

// ---- create ----------------------------------------------------------------

Deno.test("create sends every field as its flag's value, and answers the id off its own answer", async () => {
  const { verb, argv } = over(() => ({ stdout: fixture("create") }));
  const answer = await verb("create")({
    ...ENVELOPE_ON,
    item: {
      title: "-an item to write",
      description: "recorded for the writes",
      type: "task",
      labels: ["fleet", "a,b"],
      priority: 0,
    },
    by: `seat:${S1.toUpperCase()}`,
  });
  assertEquals(answer, { id: "fx-11g" });
  assertAnswers("create", answer);
  assertEquals(argv(), [[
    "create",
    "--title=-an item to write",
    "--description=recorded for the writes",
    "--type=task",
    "--labels=fleet",
    '--labels="a,b"',
    "--priority=0",
    `--actor=seat:${S1}`,
    "--json",
  ]]);
});

Deno.test("create names no priority and no label where the item names none", async () => {
  const { verb, argv } = over(() => ({ stdout: fixture("create") }));
  await verb("create")({
    ...ENVELOPE_ON,
    item: { title: "t", description: "", type: "bug", priority: null },
    by: "run:r1",
  });
  assertEquals(argv(), [[
    "create",
    "--title=t",
    "--description=",
    "--type=bug",
    "--actor=run:r1",
    "--json",
  ]]);
});

/** fleet-b47's rule: a priority past 4 is refused with its text, and bd is never asked. */
Deno.test("create refuses priority 5 before anything is sent", async () => {
  const { verb, calls } = over(() => ({ stdout: fixture("create") }));
  const why = await assertRejects(
    () =>
      verb("create")({
        ...ENVELOPE_ON,
        item: {
          title: "too urgent",
          description: "",
          type: "task",
          priority: 5,
        },
        by: "run:r1",
      }),
    Usage,
  );
  assertEquals(
    why.message,
    "the item `too urgent` does not validate: priority is 5; the range is 0 to 4 — nothing was written",
  );
  assertEquals(calls.length, 0, "bd was asked");

  // main.ts's own path: the schema refuses it first, exit 2, bd never run.
  const outcome = await respond(
    "create",
    JSON.stringify({
      ...ENVELOPE_ON,
      item: { title: "too urgent", description: "", type: "task", priority: 5 },
      by: "run:r1",
    }),
    writes(() => {
      throw new Error("bd was opened");
    }),
  );
  assertEquals([outcome.exit, outcome.stdout], [2, undefined]);
  assert(outcome.stderr?.includes("priority is 5, above 4"), outcome.stderr);
});

Deno.test("a create answering no id is could not tell", async () => {
  const { verb } = over(() => ({ stdout: '{"schema_version":1,"data":{}}' }));
  const why = await assertRejects(
    () =>
      verb("create")({
        ...ENVELOPE_ON,
        item: { title: "t", description: "", type: "task" },
        by: "run:r1",
      }),
    CouldNotTell,
  );
  assert(why.message.includes("answered no id"), why.message);
});

Deno.test("a label is its own flag, CSV-quoted where it carries a comma or a quote", () => {
  assertEquals(labelFlag("fleet"), "--labels=fleet");
  assertEquals(labelFlag("a,b"), '--labels="a,b"');
  assertEquals(labelFlag('say "hi"'), '--labels="say ""hi"""');
  assertEquals(labelFlag("b c"), "--labels=b c");
});

// ---- update ----------------------------------------------------------------

Deno.test("update is one call carrying the title, the assignee and the reopen", async () => {
  const { verb, argv } = over(() => ({
    stdout: "✓ Updated issue: fx-56s — t\n",
  }));
  const answer = await verb("update")({
    ...ENVELOPE_ON,
    id: "fx-56s",
    title: "-a title",
    assignee: S1.toUpperCase(),
    status: "open",
    by: "run:r1",
  });
  assertEquals(answer, {});
  assertAnswers("update", answer);
  await verb("update")({
    ...ENVELOPE_ON,
    id: "fx-56s",
    assignee: null,
    by: "run:r1",
  });
  assertEquals(argv(), [
    [
      "update",
      "--title=-a title",
      `--assignee=${S1}`,
      "--status=open",
      "--actor=run:r1",
      "--",
      "fx-56s",
    ],
    ["update", "--assignee=", "--actor=run:r1", "--", "fx-56s"],
  ]);
});

Deno.test("a fenced update carries --if-assignee, the holder or empty for nobody", async () => {
  const { verb, argv } = over(() => ({}));
  await verb("update")({
    ...ENVELOPE_ON,
    id: "fx-56s",
    assignee: S2,
    if_assignee: S1,
    by: "run:r1",
  });
  await verb("update")({
    ...ENVELOPE_ON,
    id: "fx-56s",
    status: "open",
    if_assignee: null,
    by: "run:r1",
  });
  assertEquals(argv(), [
    [
      "update",
      `--if-assignee=${S1}`,
      `--assignee=${S2}`,
      "--actor=run:r1",
      "--",
      "fx-56s",
    ],
    [
      "update",
      "--if-assignee=",
      "--status=open",
      "--actor=run:r1",
      "--",
      "fx-56s",
    ],
  ]);
});

/** bd's exit 13 is the fence missed and nothing written: moved, naming the item and its holder. */
Deno.test("a fence miss, exit 13, answers moved naming the holder, and nothing more is run", async () => {
  for (
    const [fence, said, named] of [
      [S1, MISMATCH_SEAT, `held by \`${S1}\``],
      [null, MISMATCH_NOBODY, "held by nobody"],
    ] as const
  ) {
    const { verb, calls } = over(() => ({ code: 13, stderr: said }));
    const why = await refusal(
      verb("update")({
        ...ENVELOPE_ON,
        id: "fx-56s",
        title: "a title nothing writes",
        if_assignee: fence,
        by: "run:r1",
      }),
    );
    assertEquals(why.reason, "moved");
    assertEquals(
      why.message,
      `fx-56s is not ${named} — nothing was written (${
        said.split("\n")[0].slice("Error updating fx-56s: ".length)
      })`,
    );
    assert(why.message.includes(S2), "the refusal names who holds it");
    assertEquals(calls.length, 1);
  }
});

/** An exit 13 without a fence is bd's own word, but no fence of the request's: could not tell. */
Deno.test("an unfenced update exiting 13 is not read as moved", async () => {
  const { verb } = over(() => ({ code: 13, stderr: MISMATCH_SEAT }));
  await assertRejects(
    () =>
      verb("update")({
        ...ENVELOPE_ON,
        id: "fx-56s",
        title: "t",
        by: "run:r1",
      }),
    CouldNotTell,
  );
});

/** fleet-b47's rule 1: bd's "no issue found" naming the id is the record's answer. */
Deno.test("an update of an item bd does not hold answers missing, fenced or not", async () => {
  for (const fence of [{}, { if_assignee: null }, { if_assignee: S1 }]) {
    const { verb } = over(() => ({ code: 1, stderr: UPDATE_MISSING }));
    const why = await refusal(
      verb("update")({
        ...ENVELOPE_ON,
        id: "fx-nobody",
        title: "t",
        by: "run:r1",
        ...fence,
      }),
    );
    assertEquals(why.reason, "missing");
    assertEquals(
      why.message,
      'fx-nobody is not in the store — nothing was written (Error resolving fx-nobody: no issue found matching "fx-nobody")',
    );
  }
});

/** bd keeps an in_progress item's assignee for its holder: the plain reassignment is refused, could not tell. */
Deno.test("a plain reassignment of an in_progress item by a non-holder is could not tell", async () => {
  const { verb } = over(() => ({ code: 1, stderr: CANNOT_REASSIGN }));
  const why = await assertRejects(
    () =>
      verb("update")({
        ...ENVELOPE_ON,
        id: "fx-56s",
        assignee: S1,
        by: "run:r1",
      }),
    CouldNotTell,
  );
  assert(why.message.includes("cannot reassign fx-56s"), why.message);
  assert(why.message.startsWith("`bd update --assignee="), why.message);
});

/** docs/store.md at 7fadcde: an update naming nothing is usage, exit 2, and nothing is run. */
Deno.test("an update naming no title, assignee or status is usage and runs nothing", async () => {
  const { verb, calls } = over(() => ({}));
  for (
    const change of [{}, { title: null }, { if_assignee: S1 }, {
      if_assignee: null,
    }]
  ) {
    const why = await assertRejects(
      () =>
        verb("update")({
          ...ENVELOPE_ON,
          id: "fx-56s",
          by: "run:r1",
          ...change,
        }),
      Usage,
    );
    assertEquals(
      why.message,
      "an update names no title, assignee or status — nothing was written",
    );
  }
  const status = await assertRejects(
    () =>
      verb("update")({
        ...ENVELOPE_ON,
        id: "fx-56s",
        status: "in_progress",
        by: "run:r1",
      }),
    Usage,
  );
  assert(status.message.includes("only to open"), status.message);
  assertEquals(calls.length, 0);

  for (const extra of [{}, { status: "in_progress" }]) {
    const outcome = await respond(
      "update",
      JSON.stringify({ ...ENVELOPE_ON, id: "fx-56s", by: "run:r1", ...extra }),
      writes(() => {
        throw new Error("bd was opened");
      }),
    );
    assertEquals(
      [outcome.exit, outcome.stdout],
      [2, undefined],
      JSON.stringify(extra),
    );
  }
});

// ---- append ----------------------------------------------------------------

Deno.test("append is one comment carrying the entry's wire text, answering the comment's id", async () => {
  const { verb, argv } = over(() => ({ stdout: fixture("comment_add") }));
  const entry = {
    seat: null,
    order: "dispatch",
    kind: "ordered",
    "fleet.entry": 1,
  };
  const answer = await verb("append")({
    ...ENVELOPE_ON,
    id: "fx-11g",
    entry,
    by: `seat:${S1}`,
  });
  assertEquals(answer, { entry: "adabfb57-1a88-51ad-8c04-5aacd604b3e2" });
  assertAnswers("append", answer);
  assertEquals(argv(), [[
    "comments",
    "add",
    `--actor=seat:${S1}`,
    "--json",
    "--",
    "fx-11g",
    '{"fleet.entry":1,"kind":"ordered","order":"dispatch","seat":null}',
  ]]);
});

Deno.test("an entry's wire text is compact with its keys sorted at every depth", () => {
  assertEquals(
    wireText({ b: 1, a: [{ d: 2, c: null }], "fleet.entry": 1 }),
    '{"a":[{"c":null,"d":2}],"b":1,"fleet.entry":1}',
  );
});

/** Measured: nothing on stderr, the error as the JSON answer, exit 1. */
Deno.test("an append to an item bd does not hold answers missing", async () => {
  const { verb } = over(() => ({
    code: 1,
    stdout: fixture("comment_add_missing"),
  }));
  const why = await refusal(
    verb("append")({
      ...ENVELOPE_ON,
      id: "fx-nobody",
      entry: { "fleet.entry": 1, kind: "ordered", order: "dispatch" },
      by: "run:r1",
    }),
  );
  assertEquals(why.reason, "missing");
  assert(why.message.startsWith("fx-nobody is not in the store"), why.message);
});

// ---- close -----------------------------------------------------------------

/** fleet-pjl's ruling: a seat closes as its bare id, for bd's actor == assignee fence. */
Deno.test("close reads the item first, then closes as the bare seat id", async () => {
  const { verb, argv } = over((args) =>
    args[0] === "show"
      ? { stdout: fixture("show") }
      : { stdout: "✓ Closed fx-5n2\n" }
  );
  const answer = await verb("close")({
    ...ENVELOPE_ON,
    id: "fx-5n2",
    reason: "-landed",
    by: `seat:${S1.toUpperCase()}`,
  });
  assertEquals(answer, {});
  assertAnswers("close", answer);
  assertEquals(argv(), [
    ["show", "--json", "--", "fx-5n2"],
    ["close", "--reason=-landed", `--actor=${S1}`, "--", "fx-5n2"],
  ]);
  assertEquals(closer("run:r1"), "run:r1");
  assertEquals(closer("controller:c"), "controller:c");
  assertEquals(actorText(`seat:${S1.toUpperCase()}`), `seat:${S1}`);
});

/** bd's second close exits 0 and writes nothing, so the read answers already and no close is sent. */
Deno.test("a close of a closed item answers already, and no close is sent", async () => {
  const { verb, argv } = over((args) =>
    args[0] === "show"
      ? { stdout: fixture("show_closed") }
      : { stdout: "✓ Closed fx-11g\n" }
  );
  const why = await refusal(
    verb("close")({
      ...ENVELOPE_ON,
      id: "fx-11g",
      reason: "again",
      by: `seat:${S1}`,
    }),
  );
  assertEquals([why.reason, why.message], [
    "already",
    "fx-11g is already closed",
  ]);
  assertEquals(argv(), [["show", "--json", "--", "fx-11g"]]);
});

Deno.test("a close of an item bd does not hold answers missing off the read", async () => {
  const { verb, argv } = over(() => ({
    code: 1,
    stdout: fixture("show_missing"),
  }));
  const why = await refusal(
    verb("close")({
      ...ENVELOPE_ON,
      id: "fx-nobody",
      reason: "r",
      by: "run:r1",
    }),
  );
  assertEquals(why.reason, "missing");
  assertEquals(argv().length, 1);
});

Deno.test("a close bd refuses for its actor is could not tell", async () => {
  const { verb } = over((args) =>
    args[0] === "show"
      ? { stdout: fixture("show") }
      : { code: 1, stderr: CANNOT_CLOSE }
  );
  const why = await assertRejects(
    () =>
      verb("close")({
        ...ENVELOPE_ON,
        id: "fx-5n2",
        reason: "r",
        by: "run:r1",
      }),
    CouldNotTell,
  );
  assert(why.message.includes("cannot close fx-56s"), why.message);
});

// ---- lib/write.ts ------------------------------------------------------------

Deno.test("bd's not-found words must name an argument the call carried", () => {
  const args = ["update", "--title=t", "--actor=run:r1", "--", "fx-nobody"];
  assertEquals(missingIn(args, UPDATE_MISSING, undefined), {
    item: "fx-nobody",
    line: 'Error resolving fx-nobody: no issue found matching "fx-nobody"',
  });
  assertEquals(
    missingIn(["update", "--", "fx-other"], UPDATE_MISSING, undefined),
    undefined,
  );
  assertEquals(
    missingIn(
      ["close", "--", "fx-nobody"],
      "",
      'resolving fx-nobody: no issue found matching "fx-nobody"',
    )?.item,
    "fx-nobody",
  );
  assertEquals(
    missingIn(
      ["gate", "resolve", "fx-h9"],
      "Error: gate not found: fx-h9\n",
      undefined,
    )
      ?.item,
    "fx-h9",
  );
});

Deno.test("a mismatch is quoted from bd's words, not cut by the tail", () => {
  assertEquals(
    mismatchIn({ code: 13, stdout: "", stderr: MISMATCH_SEAT }),
    `assignee mismatch: fx-56s is held by "${S2}", expected "${S1}"`,
  );
  assertEquals(
    mismatchIn({ code: 13, stdout: "", stderr: "something else\n" }),
    "something else",
  );
});
