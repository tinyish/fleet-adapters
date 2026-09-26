// The read verbs over a bd that answers from recorded text: the argv each
// sends, and each answer read as the contract reads it.

import { assert, assertEquals } from "@std/assert";
import { CouldNotTell, type Handler, Refused } from "../lib/answer.ts";
import { Bd, ENVELOPE } from "../lib/bd.ts";
import { listing, reads, TYPES, versionIn } from "../verbs/reads.ts";
import { assertAnswers, fake, fixture, SEAT } from "./helpers.ts";

const ROOT = "/work/project";
const ENVELOPE_ON = { schema_version: 1 as const, root: ROOT };

/** The verbs over a fake bd answering `answers`, and the calls it was handed. */
function over(answers: Parameters<typeof fake>[0], config?: string) {
  const { runner, calls } = fake(answers);
  const verbs = reads(
    (root) => new Bd(root, "bd", runner),
    (path) =>
      config !== undefined && path === `${ROOT}/.beads/config.yaml`
        ? Promise.resolve(config)
        : Promise.reject(new Deno.errors.NotFound(path)),
  );
  // deno-lint-ignore no-explicit-any
  const verb = (name: string) => verbs[name as "show"] as Handler<any>;
  return { verb, calls };
}

/** A row the recorded listings hold, fit to read: a seat holds it and no run is on it. */
function readable(text: string): string {
  return text.replaceAll('"seat-1"', `"${SEAT}"`).replace(
    /"fleet\.run": \{[^}]*\},/g,
    "",
  );
}

Deno.test("version is the first token of bd version's first line that opens on a digit", async () => {
  assertEquals(versionIn("bd version 1.3.0 (Homebrew)"), "1.3.0");
  assertEquals(versionIn("bd v1.4.0-rc1"), "1.4.0-rc1");
  assertEquals(versionIn("something else"), "something else");

  const { verb, calls } = over(() => ({
    stdout: "bd version 1.3.0 (Homebrew)\n",
  }));
  const answer = await verb("version")(ENVELOPE_ON);
  assertEquals(answer, { name: "bd", version: "1.3.0" });
  assertAnswers("version", answer);
  assertEquals(
    calls[0].args,
    ["version"],
    "it reads no store, so it takes no -C",
  );
  assertEquals(calls[0].env, { [ENVELOPE]: "1" });
});

Deno.test("a version that is no answer is could not tell", async () => {
  const silent = over(() => ({ stdout: "\n" }));
  const why = await silent.verb("version")(ENVELOPE_ON).catch((e) => e);
  assert(
    why instanceof CouldNotTell && why.message.includes("answered no version"),
    why,
  );
  const failing = over(() => ({ code: 2, stderr: "segfault\n" }));
  const exited = await failing.verb("version")(ENVELOPE_ON).catch((e) => e);
  assertEquals(exited.message, "`bd version` exited 2: segfault");
});

/**
 * No bd call. The prefix is the config's own, the command `bd`, bd's nine
 * types and 0 to 4, the export `.beads/issues.jsonl` under `.beads/`, and
 * scratch stores.
 */
Deno.test("capabilities read the prefix off the config and call no bd", async () => {
  const named = over(() => ({ code: 99 }), "# a comment\nissue-prefix: ap\n");
  const answer = await named.verb("capabilities")(ENVELOPE_ON);
  assertEquals(answer, {
    export: { file: ".beads/issues.jsonl", dir: ".beads/" },
    scratch: true,
    item_prefix: "ap",
    cli: "bd",
    items: { types: TYPES, priority: { min: 0, max: 4 } },
  });
  assertAnswers("capabilities", answer);
  assertEquals(named.calls, []);

  const bare = over(() => ({ code: 99 }), '# issue-prefix: ""\n');
  assertEquals(
    (await bare.verb("capabilities")(ENVELOPE_ON)).item_prefix,
    null,
  );
  const none = over(() => ({ code: 99 }));
  assertEquals(
    (await none.verb("capabilities")(ENVELOPE_ON)).item_prefix,
    null,
  );
});

/**
 * `-n 0` ON EVERY LISTING, because `ready` caps at 100 and a board's
 * `list.limit` caps a piped `list`; `--all` on a seat's, because `list`
 * leaves closed items out; the label's open items only. Each text rides as
 * `--flag=value`, so a label opening with `-` is never read as a flag.
 */
Deno.test("every listing lifts bd's row cap and a seat's carries closed items", () => {
  assertEquals(listing("ready"), ["ready", "--json", "-n", "0"]);
  assertEquals(listing({ label: "-x" }), [
    "list",
    "--label=-x",
    "--status=open",
    "--json",
    "-n",
    "0",
  ]);
  assertEquals(listing({ assignee: SEAT }), [
    "list",
    `--assignee=${SEAT}`,
    "--all",
    "--json",
    "-n",
    "0",
  ]);
});

Deno.test("a listing answers each recorded row as a summary", async () => {
  for (
    const [filter, name, count] of [
      ["ready", "ready", 2],
      [{ label: "fleet" }, "list", 4],
      [{ assignee: SEAT }, "list_assigned", 2],
    ] as const
  ) {
    const { verb, calls } = over(() => ({ stdout: readable(fixture(name)) }));
    const answer = await verb("list")({ ...ENVELOPE_ON, filter });
    assertEquals(answer.items.length, count, name);
    assertAnswers("list", answer);
    assertEquals(calls[0].args, ["-C", ROOT, ...listing(filter)]);
  }
  const none = over(() => ({ stdout: '{"data":[],"schema_version":1}' }));
  assertEquals(await none.verb("list")({ ...ENVELOPE_ON, filter: "ready" }), {
    items: [],
  });
});

/** A person holding a listed item refuses the listing, as it refuses the item's read. */
Deno.test("a listing a person holds a row of is could not tell", async () => {
  const { verb } = over(() => ({ stdout: fixture("ready") }));
  const why = await verb("list")({ ...ENVELOPE_ON, filter: "ready" }).catch((
    e,
  ) => e);
  assert(
    why instanceof CouldNotTell && why.message.includes("is held by seat-1"),
    why,
  );
});

Deno.test("show and resolve answer the row bd resolved the text to", async () => {
  const shown = over(() => ({ stdout: readable(fixture("show")) }));
  const answer = await shown.verb("show")({ ...ENVELOPE_ON, id: "5n2" });
  assertEquals(answer.item.id, "fx-5n2");
  assertAnswers("show", answer);
  assertEquals(shown.calls[0].args, [
    "-C",
    ROOT,
    "show",
    "--json",
    "--",
    "5n2",
  ]);
  assertEquals(await shown.verb("resolve")({ ...ENVELOPE_ON, id: "5n2" }), {
    id: "fx-5n2",
  });
});

/**
 * resolve reads the row's id alone: an item whose run's record this pack
 * does not read, or that a person holds, still resolves.
 */
Deno.test("resolve reads the id alone", async () => {
  const { verb } = over(() => ({ stdout: fixture("show") }));
  assertEquals(await verb("resolve")({ ...ENVELOPE_ON, id: "5n2" }), {
    id: "fx-5n2",
  });
  const why = await verb("show")({ ...ENVELOPE_ON, id: "5n2" }).catch((e) => e);
  assert(why instanceof CouldNotTell, why);
});

Deno.test("a missing id is refused missing by show, resolve and timeline", async () => {
  const missing = over(() => ({ code: 1, stdout: fixture("show_missing") }));
  for (const name of ["show", "resolve"]) {
    const why = await missing.verb(name)({ ...ENVELOPE_ON, id: "zz" }).catch((
      e,
    ) => e);
    assert(
      why instanceof Refused && why.reason === "missing",
      `${name}: ${why}`,
    );
  }
  const comments = over(() => ({
    code: 1,
    stdout:
      '{"data":{"error":"resolving fx-zzz: no issue found matching \\"fx-zzz\\""},"schema_version":1}',
  }));
  const why = await comments.verb("timeline")({ ...ENVELOPE_ON, id: "fx-zzz" })
    .catch((e) => e);
  assert(why instanceof Refused && why.reason === "missing", why);
  assertEquals(
    why.message,
    'fx-zzz is not in the store: resolving fx-zzz: no issue found matching "fx-zzz"',
  );
});

/**
 * bd 1.3.0's comments on one item (measured): a fleet entry and a person's,
 * in append order; the person's is left out.
 */
Deno.test("a timeline answers fleet's entries in append order and leaves a person's out", async () => {
  const text = JSON.stringify({
    data: [
      {
        id: "3c35be43-620e-528a-9f51-0aa24d587b44",
        issue_id: "fx-v8u",
        author: "seat:0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718",
        text:
          '{"fleet.entry":1,"kind":"ordered","order":"dispatch","seat":null}',
        created_at: "2026-09-26T03:16:12Z",
      },
      {
        id: "c7d4189a-c0e3-5246-b5dd-7b746ed13a6e",
        issue_id: "fx-v8u",
        author: "alberto",
        text: "a person says hi",
        created_at: "2026-09-26T03:16:13Z",
      },
      {
        id: "4d5e6f70-0000-5000-8000-000000000001",
        issue_id: "fx-v8u",
        author: "run:fleet-conformance",
        text:
          '{"fleet.entry":1,"kind":"order_withdrawn","why":"retire","seat":null}',
        created_at: "2026-09-26T03:16:14Z",
      },
    ],
    schema_version: 1,
  });
  const { verb, calls } = over(() => ({ stdout: text }));
  const answer = await verb("timeline")({ ...ENVELOPE_ON, id: "fx-v8u" });
  assertEquals(answer.entries.map((entry: { id: string }) => entry.id), [
    "3c35be43-620e-528a-9f51-0aa24d587b44",
    "4d5e6f70-0000-5000-8000-000000000001",
  ]);
  assertAnswers("timeline", answer);
  assertEquals(calls[0].args, [
    "-C",
    ROOT,
    "comments",
    "--json",
    "--",
    "fx-v8u",
  ]);

  const empty = over(() => ({ stdout: '{"data":[],"schema_version":1}' }));
  assertEquals(await empty.verb("timeline")({ ...ENVELOPE_ON, id: "fx-v8u" }), {
    entries: [],
  });
});
