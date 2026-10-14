// lib/bd.ts: the binary, the envelope, the first value, the exit and the
// stderr — each quirk of bd 1.3.0 it carries, with the answer bd gave.

import { assert, assertEquals, assertThrows } from "@std/assert";
import { CouldNotTell, Refused } from "../lib/answer.ts";
import {
  ambiguous,
  Bd,
  binary,
  ENVELOPE,
  firstValue,
  opened,
  shown,
  tail,
} from "../lib/bd.ts";
import { answer, fake, fixture } from "./helpers.ts";

const ROOT = "/work/project";

/** bd 1.3.0's stderr for a fragment two ids open with, measured. */
const AMBIGUOUS_STDERR =
  'Error fetching 0: ambiguous issue ID: "0" matches 2 issues: ' +
  "[fx-0bp fx-0qi]\nUse more characters to disambiguate\n";

function refused(read: () => unknown): Refused {
  return assertThrows(read, Refused);
}

Deno.test("the first JSON value is read and what trails it is not", () => {
  assertEquals(firstValue('{"a":[1,"]}"]} trailing text\n{"b":2}'), {
    a: [1, "]}"],
  });
  assertEquals(firstValue('\n  [1, {"x": "\\"]"}]\n'), [1, { x: '"]' }]);
  assertEquals(firstValue("null\n"), null);
  assertEquals(firstValue('"text" more'), "text");
  assertEquals(firstValue("   "), undefined);
  assertEquals(firstValue("Error: not json"), undefined);
  assertEquals(firstValue('{"unclosed": 1'), undefined);
});

/** BOTH KEYS MAKE AN ENVELOPE; a bare answer and a bare error read as they are. */
Deno.test("the envelope is opened and a bare answer read as it is", () => {
  const from = () => "a call";
  assertEquals(opened({ schema_version: 1, data: [1] }, from), [1]);
  assertEquals(opened({ schema_version: 1, data: null }, from), null);
  assertEquals(
    opened([1], from),
    [1],
    "a bd before the envelope answers the bare value",
  );
  assertEquals(
    opened({ schema_version: 1, error: "no issue fx-1" }, from),
    { schema_version: 1, error: "no issue fx-1" },
    "a bare error carries schema_version and no data, measured on 1.3.0",
  );
});

/** A newer bd is warned about and read: it adds keys far more often than it moves one. */
Deno.test("an answer at a newer schema_version is warned about and read", () => {
  const said: string[] = [];
  assertEquals(
    opened(
      { schema_version: 2, data: [7] },
      () => "`bd ready`",
      (line) => said.push(line),
    ),
    [7],
  );
  assertEquals(said.length, 1);
  assert(said[0].includes("`bd ready` answered schema_version 2"), said[0]);
});

Deno.test("a call's tail is its last line on stderr, else on stdout", () => {
  assertEquals(
    tail({ code: 1, stdout: "out\n", stderr: "first\nlast\n\n" }),
    "last",
  );
  assertEquals(
    tail({ code: 1, stdout: "only out\n", stderr: "  \n" }),
    "only out",
  );
  assertEquals(tail({ code: 1, stdout: "", stderr: "" }), "no output");
  assertEquals(
    tail({ code: 1, stdout: "", stderr: "x".repeat(200) }).length,
    160,
  );
});

/**
 * AMBIGUITY IS TOLD ON STDERR ONLY: bd 1.3.0 answers an ambiguous fragment
 * and a missing id with the same JSON error, and its stderr names the
 * matches. The ids come out of the brackets; 1.2.2's wording is read too.
 */
Deno.test("an ambiguous fragment is told by stderr and its matches named", () => {
  assertEquals(ambiguous(AMBIGUOUS_STDERR), {
    candidates: ["fx-0bp", "fx-0qi"],
    line:
      'Error fetching 0: ambiguous issue ID: "0" matches 2 issues: [fx-0bp fx-0qi]',
  });
  assertEquals(
    ambiguous('Error: ambiguous ID "a" matches [fx-a1 fx-a2]')?.candidates,
    [
      "fx-a1",
      "fx-a2",
    ],
  );
  assertEquals(ambiguous("Error: ambiguous issue ID: a")?.candidates, []);
  assertEquals(ambiguous("Issue zzz not found\nHint: …"), undefined);

  const missing = answer(fixture("show_missing"));
  const it = refused(() => shown("0", missing, AMBIGUOUS_STDERR));
  assertEquals(it.reason, "ambiguous");
  assertEquals(it.candidates, ["fx-0bp", "fx-0qi"]);
  assertEquals(
    it.message,
    "`0` matches more than one item — fx-0bp, fx-0qi — and more of the id says which one this is",
  );
});

/**
 * A MISSING ID IS AN ERROR WITH NO CODE, measured on 1.3.0 (the recorded
 * answer), and it is the record's answer: missing, never could not tell.
 */
Deno.test("a recorded missing id is the record's answer", () => {
  const it = refused(() =>
    shown("fx-nothere", answer(fixture("show_missing")), "")
  );
  assertEquals(it.reason, "missing");
  assert(
    it.message.startsWith("`fx-nothere` is not in the store: no issues found"),
    it.message,
  );
  assertEquals(
    refused(() => shown("fx-1", [], "")).reason,
    "missing",
    "an empty answer",
  );
});

/** A code bd did not spell as text still leaves the answer an error, read as missing. */
Deno.test("an error whose code is not text is still missing", () => {
  for (const code of [404, true, { kind: "not_found" }, null, "not_found"]) {
    const it = refused(() =>
      shown("fx-1", { error: "no issue fx-1", code }, "")
    );
    assertEquals(
      [it.reason, it.message],
      ["missing", "`fx-1` is not in the store: no issue fx-1"],
      JSON.stringify(code),
    );
  }
  const other = assertThrows(
    () =>
      shown("fx-1", { error: "the database is locked", code: "locked" }, ""),
    CouldNotTell,
  );
  assertEquals(
    other.message,
    "`fx-1` could not be read (locked): the database is locked",
  );
});

/** A bare error — schema_version beside error, no data — reads as the error it is. */
Deno.test("a bare error with no envelope reads as missing", () => {
  const bare = opened(
    { schema_version: 1, error: "no issues found" },
    () => "show",
  );
  assertEquals(refused(() => shown("fx-1", bare, "")).reason, "missing");
});

/**
 * $FLEET_BD_BIN names the bd by ABSOLUTE path to an executable file, and
 * anything else it names is could not tell — bd on PATH is never tried in
 * its place. Unset or blank, it is `bd` on PATH.
 */
Deno.test("the seam names bd by absolute path or is refused", () => {
  const executable = (path: string) => path === "/opt/bd/bin/bd";
  assertEquals(binary(undefined, executable), "bd");
  assertEquals(binary("  ", executable), "bd");
  assertEquals(binary(" /opt/bd/bin/bd ", executable), "/opt/bd/bin/bd");
  assertEquals(
    assertThrows(() => binary("relative/bd", executable), CouldNotTell).message,
    "the item-tracker seam names `relative/bd`, which is not an absolute path",
  );
  assertEquals(
    assertThrows(() => binary("/no/such/bd", executable), CouldNotTell).message,
    "the item-tracker seam names `/no/such/bd`, which is not an executable file",
  );
});

/**
 * EVERY CALL CARRIES BD_JSON_ENVELOPE=1 and `-C <root>`, run by the binary
 * resolved and no other; a call that reads no store carries no `-C`.
 */
Deno.test("every call carries the envelope and the root", async () => {
  const { runner, calls } = fake(() => ({
    stdout: '{"schema_version":1,"data":[]}',
  }));
  const bd = new Bd(ROOT, "/opt/bd/bin/bd", runner);
  await bd.listed(["ready", "--json", "-n", "0"]);
  await bd.run(["version"], { scoped: false });
  assertEquals(calls.map((call) => call.bin), [
    "/opt/bd/bin/bd",
    "/opt/bd/bin/bd",
  ]);
  assertEquals(calls.map((call) => call.env), [{ [ENVELOPE]: "1" }, {
    [ENVELOPE]: "1",
  }]);
  assertEquals(calls[0].args, ["-C", ROOT, "ready", "--json", "-n", "0"]);
  assertEquals(calls[1].args, ["version"]);
});

/**
 * AN EMPTY LISTING MAY ANSWER `null` AND NOT `[]` (measured on 1.3.0 for
 * `gate list`), or nothing at all: both are no rows. Anything else that is
 * not a list is could not tell, and so is a listing that exits other than 0.
 */
Deno.test("an empty listing may answer null or nothing and reads as no rows", async () => {
  for (const stdout of ['{"data":null,"schema_version":1}', "", "\n"]) {
    const { runner } = fake(() => ({ stdout }));
    assertEquals(
      await new Bd(ROOT, "bd", runner).listed(["gate", "list"]),
      [],
      stdout,
    );
  }
  const { runner } = fake(() => ({
    stdout: '{"data":{"id":"x"},"schema_version":1}',
  }));
  const why = await new Bd(ROOT, "bd", runner).listed(["ready"]).catch((e) =>
    e
  );
  assert(
    why instanceof CouldNotTell &&
      why.message.includes("did not answer a list"),
    why,
  );

  const failing = fake(() => ({
    code: 1,
    stderr: "Error: the database is locked\n",
  }));
  const exited = await new Bd(ROOT, "bd", failing.runner).listed(["ready"])
    .catch((e) => e);
  assertEquals(
    exited.message,
    "`bd ready` exited 1: Error: the database is locked",
  );
});

/** A bd that cannot be run is could not tell, naming the binary. */
Deno.test("a bd that cannot be run is could not tell", async () => {
  const bd = new Bd(
    ROOT,
    "bd",
    () => Promise.reject(new Error("No such file or directory")),
  );
  const why = await bd.run(["ready"]).catch((e) => e);
  assert(why instanceof CouldNotTell);
  assertEquals(
    why.message,
    "`bd` could not be run (No such file or directory) — nothing was written",
  );
});

/**
 * THE JSON OF A SHOW IS READ BEFORE ITS EXIT: bd exits 1 on an item it does
 * not hold and prints the error, which is the record's answer. A show that
 * printed no JSON — a root holding no store, measured on 1.3.0 — is could
 * not tell. The text goes after `--`, so a fragment opening with `-` is never
 * read as a flag of bd's.
 */
Deno.test("a show reads its JSON before its exit", async () => {
  const { runner, calls } = fake(() => ({
    code: 1,
    stdout: fixture("show_missing"),
    stderr: AMBIGUOUS_STDERR,
  }));
  const it = await new Bd(ROOT, "bd", runner).shownRow("0").catch((e) => e);
  assert(it instanceof Refused && it.reason === "ambiguous", it);
  assertEquals(calls[0].args, ["-C", ROOT, "show", "--json", "--", "0"]);

  const absent = fake(() => ({
    code: 1,
    stderr: 'Error: cannot use -C directory "/x": no beads project found\n',
  }));
  const why = await new Bd("/x", "bd", absent.runner).shownRow("x").catch((e) =>
    e
  );
  assert(why instanceof CouldNotTell, why);
  assertEquals(
    why.message,
    '`bd show --json -- x` answered no JSON: Error: cannot use -C directory "/x": no beads project found',
  );

  const row = fake(() => ({ stdout: fixture("show") }));
  assertEquals(
    (await new Bd(ROOT, "bd", row.runner).shownRow("5n2")).id,
    "fx-5n2",
  );
});
