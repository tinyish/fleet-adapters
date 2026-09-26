// lib/listing.ts: one `claude agents --json --all` per distinct config dir,
// parsed into the adapter's own row, and a seat's row found among them. The
// arms restate controller/tests/observe.rs's lessons at tinyfleet 753fdde —
// the_roster_is_one_command (B1), the_roster_read_can_go_silently_dead (B4),
// cwd_names_a_seat_and_proves_nothing (B5, as the pack reads it now: by
// session id, else by pid, never by cwd) — and the per-dir arms
// a_transient_row_is_seen_through_its_own_directory_and_unseen_through_the_fleets
// and a_per_row_listing_that_cannot_be_read_leaves_that_row_unknown_and_the_rest_decided,
// over the listings recorded on Claude Code 2.1.280 under fixtures/read/.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  dirKey,
  type Listing,
  listingsFor,
  listUnder,
  match,
  parseListing,
  type Row,
} from "../lib/listing.ts";

const FIXTURES = new URL("../fixtures/read/", import.meta.url).pathname;
const RA = "19edc64f-9110-4368-982c-98ea5600e1d3";
const RB = "a4cb1087-78d7-4218-a251-0c3422dca5c3";
const SEAT = "0199a3c4-0000-7000-8000-000000000399";
const WT = "/private/tmp/jymr3-rec/wt";

function recorded(kase: string, dir = "config"): string {
  return Deno.readTextFileSync(`${FIXTURES}${kase}/${dir}/listing.json`);
}

function rows(listing: Listing): Row[] {
  if ("unreadable" in listing) {
    throw new Error(`unreadable: ${listing.unreadable}`);
  }
  return listing.rows;
}

function cause(listing: Listing): string {
  assert("unreadable" in listing, `read: ${JSON.stringify(listing)}`);
  return listing.unreadable;
}

// ----------------------------------------------------------------- parsing

/**
 * B10 on 2.1.280: an interactive row carries cwd, kind, name, pid,
 * sessionId, startedAt and status — never id or state — and waitingFor while
 * a human is being asked. The row the adapter keeps is its own: the fields it
 * reads, and no address.
 */
Deno.test("the recorded rows parse into the adapter's own row", () => {
  assertEquals(rows(parseListing(recorded("idle"))), [{
    sessionId: RA,
    kind: "interactive",
    pid: 84311,
    status: "idle",
    startedAt: 1790417738915,
  }]);
  assertEquals(rows(parseListing(recorded("waiting-permission"))), [{
    sessionId: RA,
    kind: "interactive",
    pid: 84311,
    status: "waiting",
    waitingFor: "permission prompt",
    startedAt: 1790417738915,
  }]);
  assertEquals(rows(parseListing(recorded("two-rows-one-worktree"))).length, 2);
});

/**
 * B1: the reader tolerates fields it does not know, and field presence is
 * kind-dependent, so a background row and an interactive one parse in one
 * listing.
 */
Deno.test("the roster is one command, and unknown fields are nothing", () => {
  assertEquals(rows(parseListing(recorded("unknown-field"))), [{
    sessionId: RA,
    kind: "interactive",
    pid: 84311,
    status: "idle",
    startedAt: 1790417738915,
  }]);
  const mixed = rows(parseListing(
    `[{"id":"aa","sessionId":"aa","cwd":"/wt/b1","kind":"background","pid":1,
       "status":"idle","state":"running","name":"orla","startedAt":10,
       "someFieldNobodyHasSeen":"harmless"},
      {"sessionId":"bb","kind":"interactive"}]`,
  ));
  assertEquals(mixed, [
    {
      sessionId: "aa",
      kind: "background",
      pid: 1,
      status: "idle",
      startedAt: 10,
    },
    { sessionId: "bb", kind: "interactive" },
  ]);
});

/**
 * B4: zero bytes with a success status is UNREADABLE, never a reading of
 * zero; the control is an empty array, a listing that answered.
 */
Deno.test("the roster read can go silently dead", () => {
  assertEquals(
    cause(parseListing(recorded("zero-bytes"))),
    "the listing answered with zero bytes and a success status",
  );
  assertEquals(
    cause(parseListing(" \n")),
    "the listing answered with zero bytes and a success status",
  );
  assertEquals(rows(parseListing(recorded("empty-listing"))), []);
});

/**
 * Rows that do not parse leave the whole listing unreadable: a row missing
 * its session id, a field the adapter reads of the wrong kind, a body that is
 * not JSON or not an array. null is absent, as serde's Option read it.
 */
Deno.test("a listing whose rows do not parse is unreadable, naming why", () => {
  for (
    const [body, why] of [
      ["[{", "is not JSON"],
      ['{"sessionId":"aa"}', "is not an array"],
      ['[{"kind":"interactive","pid":1}]', "row 0 has no sessionId"],
      ['[{"sessionId":"aa"},"row"]', "row 1 is not an object"],
      ['[{"sessionId":"aa","pid":"84311"}]', "row 0's pid"],
      ['[{"sessionId":"aa","pid":-1}]', "row 0's pid"],
      ['[{"sessionId":"aa","status":3}]', "row 0's status"],
      ['[{"sessionId":"aa","waitingFor":true}]', "row 0's waitingFor"],
      ['[{"sessionId":"aa","kind":["interactive"]}]', "row 0's kind"],
    ]
  ) {
    const said = cause(parseListing(body));
    assert(said.startsWith("the listing did not parse as rows: "), said);
    assertStringIncludes(said, why);
  }
  assertEquals(
    rows(parseListing(
      '[{"sessionId":"aa","kind":"interactive","pid":null,"waitingFor":null,"cwd":7}]',
    )),
    [{ sessionId: "aa", kind: "interactive" }],
    "null is absent, and a field no reader names is nothing, cwd among them",
  );
});

// ----------------------------------------------------------------- matching

const ra: Row = {
  sessionId: RA,
  kind: "interactive",
  pid: 84311,
  status: "idle",
  startedAt: 1790417738915,
};
const rb: Row = {
  sessionId: RB,
  kind: "interactive",
  pid: 6630,
  status: "idle",
  startedAt: 1790418212819,
};

/**
 * B5 as the pack reads it: a seat is found by its session id, else by its
 * pane's pid (docs/agent.md, "Finding a seat's session"), and never by its
 * worktree — the recorded two rows stand in one worktree and each is found
 * by its own id or pid alone.
 */
Deno.test("a seat is found by session id, else by pid, never by cwd", () => {
  const two = rows(parseListing(recorded("two-rows-one-worktree")));
  const seat = { seat: SEAT, worktree: WT };
  assertEquals(match({ ...seat, session_id: RA }, two), ra);
  assertEquals(match({ ...seat, session_id: RB }, two), rb);
  assertEquals(match({ ...seat, pid: 6630 }, two), rb);
  assertEquals(match({ ...seat, pid: 84311 }, two), ra);
  assertEquals(match(seat, two), undefined, "the worktree names nothing");
  assertEquals(match({ ...seat, pid: 6631 }, two), undefined);
  assertEquals(
    match({ ...seat, session_id: "  " }, two),
    undefined,
    "a blank session id is none",
  );
});

/**
 * The session id first: a seat whose id a row carries is that row's, whatever
 * pid the request names beside it.
 */
Deno.test("a session id outranks the pid", () => {
  assertEquals(
    match({ seat: SEAT, worktree: WT, session_id: RA, pid: 6630 }, [
      ra,
      rb,
    ]),
    ra,
  );
});

/**
 * Measured on 2.1.280: `/clear` gives the SAME pane pid a new sessionId
 * (a4cb1087… became 7fed023d… under pid 6630). A seat still holding the old
 * id is found by its pid, and the row's id is the one answered.
 */
Deno.test("a session id no row carries falls to the pane's pid", () => {
  const cleared: Row = {
    ...rb,
    sessionId: "7fed023d-e472-4d66-b89a-9270c82f677d",
  };
  assertEquals(
    match({ seat: SEAT, worktree: WT, session_id: RB, pid: 6630 }, [
      ra,
      cleared,
    ]),
    cleared,
  );
  assertEquals(
    match({ seat: SEAT, worktree: WT, session_id: RB }, [ra, cleared]),
    undefined,
    "no pid, no fall",
  );
});

/** A background row is never a seat's, by its id or by its pid. */
Deno.test("a background row is never matched", () => {
  const background: Row = { ...ra, kind: "background" };
  const kindless: Row = { sessionId: RA, pid: 84311, status: "idle" };
  for (const row of [background, kindless]) {
    assertEquals(
      match({ seat: SEAT, worktree: WT, session_id: RA, pid: 84311 }, [row]),
      undefined,
    );
  }
});

/** Two interactive rows under one id: the newest started answers. */
Deno.test("two rows under one id: the newest answers", () => {
  const older: Row = { ...ra, pid: 1, startedAt: 10 };
  const newer: Row = { ...ra, pid: 2, startedAt: 20 };
  const seat = { seat: SEAT, worktree: WT, session_id: RA };
  assertEquals(match(seat, [older, newer]), newer);
  assertEquals(match(seat, [newer, older]), newer);
});

// ------------------------------------------------------------ one per dir

Deno.test("dirKey: a trailing separator is the same directory, the root kept", () => {
  assertEquals(dirKey("/c/a/"), "/c/a");
  assertEquals(dirKey("/c/a//"), "/c/a");
  assertEquals(dirKey("/c/a"), "/c/a");
  assertEquals(dirKey("/"), "/");
});

/**
 * One listing per DISTINCT config dir (lessons A11, B10: a config dir scopes
 * the listing), all of them in flight at once: seats across three dirs cost
 * three calls, a named seat's dir is the operator's, and a dir spelled with a
 * trailing separator is not a fourth.
 */
Deno.test("listingsFor: one listing per distinct config dir, concurrently", async () => {
  const asked: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  const list = async (dir: string): Promise<Listing> => {
    asked.push(dir);
    if (asked.length === 3) release();
    await gate;
    return { rows: [{ sessionId: dir }] };
  };
  const seat = (config_dir?: string) => ({
    seat: SEAT,
    worktree: WT,
    ...(config_dir === undefined ? {} : { config_dir }),
  });
  const found = await listingsFor(
    [seat("/c/a"), seat("/c/b"), seat("/c/a/"), seat(), seat("/c/b")],
    list,
    (name) => name === "CLAUDE_CONFIG_DIR" ? "/home/op/.claude" : undefined,
  );
  assertEquals(asked.sort(), ["/c/a", "/c/b", "/home/op/.claude"]);
  assertEquals([...found.keys()].sort(), ["/c/a", "/c/b", "/home/op/.claude"]);
  assertEquals(found.get("/c/b"), { rows: [{ sessionId: "/c/b" }] });
});

/** No seats, no listing. */
Deno.test("listingsFor: no seats run no listing", async () => {
  const found = await listingsFor([], () => {
    throw new Error("listed");
  });
  assertEquals(found.size, 0);
});

// ------------------------------------------------------------- the command

/** An executable script at `<dir>/claude` holding `body` after its shebang. */
async function script(dir: string, body: string) {
  const path = `${dir}/claude`;
  await Deno.writeTextFile(path, `#!/bin/sh\n${body}\n`);
  await Deno.chmod(path, 0o755);
  return path;
}

/**
 * The listing is `agents --json --all` under the dir, with the credential
 * scope defined even when empty (lessons A11); its stdout is parsed.
 */
Deno.test("listUnder: agents --json --all under the dir, credential defined", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const claude = await script(
      dir,
      [
        'printf "%s" "$*" > "$CLAUDE_CONFIG_DIR/argv"',
        'printf "%s" "${CLAUDE_SECURESTORAGE_CONFIG_DIR+set}" > "$CLAUDE_CONFIG_DIR/cred"',
        `echo '[{"sessionId":"s","kind":"interactive","pid":7,"status":"busy"}]'`,
      ].join("\n"),
    );
    const read = await listUnder(dir, claude, () => undefined);
    assertEquals(read, {
      rows: [{ sessionId: "s", kind: "interactive", pid: 7, status: "busy" }],
    });
    assertEquals(await Deno.readTextFile(`${dir}/argv`), "agents --json --all");
    assertEquals(await Deno.readTextFile(`${dir}/cred`), "set");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * A listing that exits non-zero is that dir's unreadable, naming the exit
 * and stderr's last line; one that cannot be run or outruns its bound is
 * too — never a throw that would blind every other dir.
 */
Deno.test("listUnder: a failing listing is unreadable, naming why", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const failing = await script(
      dir,
      'echo "noise" >&2; echo "Error: no such thing" >&2; exit 2',
    );
    assertEquals(
      cause(await listUnder(dir, failing, () => undefined)),
      "`claude agents --json --all` exited 2: Error: no such thing",
    );
    await script(dir, "exit 1");
    assertEquals(
      cause(await listUnder(dir, `${dir}/claude`, () => undefined)),
      "`claude agents --json --all` exited 1",
    );
    await script(dir, "kill -9 $$");
    assertEquals(
      cause(await listUnder(dir, `${dir}/claude`, () => undefined)),
      "`claude agents --json --all` ended on a signal",
    );
    assertStringIncludes(
      cause(await listUnder(dir, `${dir}/nothing`, () => undefined)),
      "cannot be run",
    );
    await script(dir, "exec sleep 30");
    assertStringIncludes(
      cause(await listUnder(dir, `${dir}/claude`, () => undefined, 200)),
      "did not answer within 200 ms",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
