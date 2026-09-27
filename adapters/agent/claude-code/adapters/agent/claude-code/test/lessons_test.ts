// LESSONS.md, held to its own contract: every entry names one test, the
// table at its foot names each once with the file it is in, each file is
// there and holds a Deno test of that name, and every file under
// test/lessons/ is a row. fleet-jymr.7's CI reads the same table.

import { assert, assertEquals } from "@std/assert";
import { CAPABILITIES } from "../lib/capabilities.ts";
import { ADAPTER, entries, inventory } from "./lessons_support.ts";

const LESSONS_DIR = `${ADAPTER}test/lessons/`;

/** An entry's Test field: the name it owes, or null for `none — <why>`. */
function testOf(text: string): string | null {
  const field = text.match(/^- \*\*Test:\*\* (.*)$/m);
  assert(field !== null, `no Test field in:\n${text}`);
  const named = field[1].match(/^`(lessons::[a-z0-9_]+)`/);
  return named === null ? null : named[1];
}

Deno.test("every entry names one test, and the table names each once with its file", () => {
  const all = entries();
  assert(all.length > 0, "LESSONS.md was read");
  const rows = inventory();
  assertEquals(
    rows.map((r) => [r.test, r.entry]),
    all.map((e) => [testOf(e.text), e.id]),
    "the table is the entries' own Test fields, in the entries' order",
  );
  assertEquals(new Set(rows.map((r) => r.test)).size, rows.length);
  for (const row of rows) {
    const slug = row.test.replace(/^lessons::/, "");
    assertEquals(row.file, `test/lessons/${slug}.test.ts`, row.test);
  }
});

Deno.test("each row's file is there, holding a Deno test of the row's name", () => {
  for (const row of inventory()) {
    const body = Deno.readTextFileSync(`${ADAPTER}${row.file}`);
    assert(
      body.includes(`"${row.test}`),
      `${row.file} holds no Deno test named ${row.test}`,
    );
  }
});

Deno.test("every file under test/lessons/ is a row", () => {
  const files = [...Deno.readDirSync(LESSONS_DIR)].map((e) =>
    `test/lessons/${e.name}`
  ).sort();
  assertEquals(files, inventory().map((r) => r.file).sort());
});

/**
 * measured is per version (fleet-2u3.8's per-version half): each release
 * the pack declares measured is one every entry here was re-read on, and
 * says so in a Version line of its own.
 */
Deno.test("every entry carries a Version line for each release measured names", () => {
  for (const entry of entries()) {
    for (const release of CAPABILITIES.measured) {
      assert(
        entry.text.includes(`- **Version ${release}`),
        `${entry.id} carries no **Version ${release}** line`,
      );
    }
  }
});
