// What the arms under test/lessons/ share: main.ts run as fleet runs it,
// under a cleared environment; the recorded fixtures, read and filled in as
// `fleet agent check` fills them; listings made up for one arm and replayed
// through the read fixtures' own claude; and LESSONS.md read as the entries
// and the table the arms hold the pack to.

import { assertEquals } from "@std/assert";
import type { SeatActivity, SeatContext, SeatRef } from "../contract.d.ts";
import { CONTRACT } from "../lib/answer.ts";
import { why } from "../lib/schema.ts";

/** The adapter's own directory, a trailing slash on it. */
export const ADAPTER = decodeURIComponent(
  new URL("../", import.meta.url).pathname,
);
export const MAIN = `${ADAPTER}main.ts`;
export const READ_FIXTURES = `${ADAPTER}fixtures/read/`;
export const CONTEXT_FIXTURES = `${ADAPTER}fixtures/context/`;

/**
 * The read fixtures' claude: it replays `<config dir>/listing.json`, and
 * answers `agents --json --all` alone. An arm that makes up a listing writes
 * it there and names this as FLEET_CLAUDE_BIN, so no arm writes an
 * executable of its own.
 */
export const REPLAY = `${READ_FIXTURES}claude`;

export interface Called {
  exit: number;
  answer: Record<string, unknown> | undefined;
  stderr: string;
}

/** The environment main.ts needs to start at all: deno on PATH. */
export function base(): Record<string, string> {
  return { PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" };
}

/**
 * One call of main.ts, as fleet makes it: the file itself, executed, under a
 * CLEARED environment carrying deno's PATH and `env` alone, so nothing of the
 * machine running the suite — its own CLAUDE_CONFIG_DIR above all — reaches
 * the answer.
 */
export async function main(
  verb: string,
  request: unknown,
  env: Record<string, string> = {},
): Promise<Called> {
  const child = new Deno.Command(MAIN, {
    args: [verb],
    env: { ...base(), ...env },
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(request)));
  await writer.close();
  const out = await child.output();
  const stdout = new TextDecoder().decode(out.stdout).trim();
  return {
    exit: out.code,
    answer: stdout === "" ? undefined : JSON.parse(stdout),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

/** A fixture file, with `{fixture}` as fleet agent check fills it in. */
export function filled(dir: string, file: string): unknown {
  return JSON.parse(
    Deno.readTextFileSync(`${dir}/${file}`).replaceAll("{fixture}", dir),
  );
}

/** A request's envelope around `seats`. */
export function envelope(seats: unknown[]): Record<string, unknown> {
  return { schema_version: 1, root: "/work/project", seats };
}

/** A read fixture case's request, its recorded answer, and main.ts's. */
export async function readCase(kase: string) {
  const dir = `${READ_FIXTURES}${kase}`;
  const request = filled(dir, "request.json") as { seats: SeatRef[] };
  const env = filled(dir, "env.json") as Record<string, string>;
  const expected = filled(dir, "answer.json") as { seats: SeatActivity[] };
  const called = await main("read", request, env);
  assertEquals(called.exit, 0, called.stderr);
  assertEquals(
    why(CONTRACT, CONTRACT.verbs.read.response, called.answer),
    null,
  );
  return {
    request,
    expected,
    seats: called.answer!.seats as SeatActivity[],
  };
}

/**
 * `read` over listings made up for one arm: each named dir under a scratch
 * root gets `listing.json` (and, where given, `listing.exit` and
 * `listing.stderr`), replayed by REPLAY. `seats` is handed the dirs' paths.
 */
export async function readOver(
  listings: Record<
    string,
    string | { stdout: string; exit?: number; stderr?: string }
  >,
  seats: (dir: Record<string, string>) => SeatRef[],
): Promise<SeatActivity[]> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lessons-read-" }),
  );
  try {
    const dirs: Record<string, string> = {};
    for (const [name, listing] of Object.entries(listings)) {
      const dir = `${root}/${name}`;
      await Deno.mkdir(dir);
      const { stdout, exit, stderr } = typeof listing === "string"
        ? { stdout: listing, exit: undefined, stderr: undefined }
        : listing;
      await Deno.writeTextFile(`${dir}/listing.json`, stdout);
      if (exit !== undefined) {
        await Deno.writeTextFile(`${dir}/listing.exit`, `${exit}\n`);
      }
      if (stderr !== undefined) {
        await Deno.writeTextFile(`${dir}/listing.stderr`, stderr);
      }
      dirs[name] = dir;
    }
    const called = await main("read", envelope(seats(dirs)), {
      FLEET_CLAUDE_BIN: REPLAY,
    });
    assertEquals(called.exit, 0, called.stderr);
    assertEquals(
      why(CONTRACT, CONTRACT.verbs.read.response, called.answer),
      null,
    );
    return called.answer!.seats as SeatActivity[];
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/**
 * A context fixture case's request, and main.ts's answer to it, but for
 * `last_write`: a checkout keeps no mtime, and test/context_test.ts is the
 * arm that holds the stamp.
 */
export async function contextCase(kase: string) {
  const dir = `${CONTEXT_FIXTURES}${kase}`;
  const request = filled(dir, "request.json") as { seats: SeatRef[] };
  const expected = filled(dir, "answer.json") as { seats: SeatContext[] };
  const called = await main("context", request);
  assertEquals(called.exit, 0, called.stderr);
  assertEquals(
    why(CONTRACT, CONTRACT.verbs.context.response, called.answer),
    null,
  );
  return {
    request,
    expected: expected.seats.map(unstamped),
    seats: (called.answer!.seats as SeatContext[]).map(unstamped),
  };
}

function unstamped(seat: SeatContext): SeatContext {
  const { last_write: _, ...rest } = seat;
  return rest;
}

// ------------------------------------------------------------- LESSONS.md

export const LESSONS = `${ADAPTER}LESSONS.md`;

/** One entry of LESSONS.md: its id, and its text from heading to the next. */
export interface Entry {
  id: string;
  text: string;
}

/** Every entry of LESSONS.md, in file order. */
export function entries(body = Deno.readTextFileSync(LESSONS)): Entry[] {
  const found: Entry[] = [];
  let current: Entry | undefined;
  for (const line of body.split("\n")) {
    const heading = line.match(/^### ([A-D]\d+)\. /);
    if (heading !== null) {
      current = { id: heading[1], text: `${line}\n` };
      found.push(current);
    } else if (line.startsWith("## ") || line === "---") {
      current = undefined;
    } else if (current !== undefined) {
      current.text += `${line}\n`;
    }
  }
  return found;
}

/** One entry by id; an arm naming one this file lacks fails here. */
export function entry(id: string): Entry {
  const found = entries().find((e) => e.id === id);
  if (found === undefined) throw new Error(`LESSONS.md carries no ${id}`);
  return found;
}

/** One row of the inventory: the test, the entry, and its file. */
export interface InventoryRow {
  test: string;
  entry: string;
  file: string;
}

/** The `## Test inventory` table's rows, in order. */
export function inventory(
  body = Deno.readTextFileSync(LESSONS),
): InventoryRow[] {
  const at = body.indexOf("\n## Test inventory\n");
  if (at === -1) throw new Error("LESSONS.md carries no ## Test inventory");
  const rows: InventoryRow[] = [];
  for (const line of body.slice(at).split("\n")) {
    const cells = line.match(
      /^\|\s*`([^`]+)`\s*\|\s*([A-D]\d+)\s*\|\s*`([^`]+)`\s*\|$/,
    );
    if (cells !== null) {
      rows.push({ test: cells[1], entry: cells[2], file: cells[3] });
    }
  }
  return rows;
}
