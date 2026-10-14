// `read` end to end: main.ts run as fleet runs it, over every case under
// fixtures/read/ in fleet-14p8.8's layout — <case>/request.json and
// <case>/env.json, whose `{fixture}` is the case's absolute directory, and
// <case>/answer.json, the answer without its envelope. Each case's env.json
// names fixtures/read/claude as FLEET_CLAUDE_BIN, which replays the
// `claude agents --json --all` recorded under each of the case's config dirs
// (README.md, "The read fixtures", says how each was recorded).
//
// The arms after the fixtures are the row's acceptance: seats across three
// config dirs cost three listings in one process, one dir's failing listing
// leaves the others read, and the reading of one row — status, the
// logged-out first turn, the trust question — arm by arm. B8's waitingFor,
// keyed on presence, is test/lessons/waiting_for_names_the_block.test.ts
// (fleet-jymr.6).

import { assert, assertEquals } from "@std/assert";
import type { SeatRef } from "../contract.d.ts";
import { CONTRACT } from "../lib/answer.ts";
import type { Listing, Row } from "../lib/listing.ts";
import { why } from "../lib/schema.ts";
import { encodeProjectDir } from "../lib/transcript.ts";
import { activityOf, trustQuestion } from "../verbs/read.ts";

const MAIN = new URL("../main.ts", import.meta.url).pathname;
const FIXTURES = new URL("../fixtures/read/", import.meta.url).pathname;
const REPLAY = `${FIXTURES}claude`;
const SEAT = "0199a3c4-0000-7000-8000-000000000399";
const WT = "/private/tmp/jymr3-rec/wt";
const RA = "19edc64f-9110-4368-982c-98ea5600e1d3";
const RLO = "11c48ca5-d5ee-4f86-b7a1-c06047a74398";

interface Called {
  exit: number;
  answer: Record<string, unknown> | undefined;
  stderr: string;
}

async function call(
  stdin: string,
  env: Record<string, string> = {},
): Promise<Called> {
  const child = new Deno.Command(MAIN, {
    args: ["read"],
    env,
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const out = await child.output();
  const stdout = new TextDecoder().decode(out.stdout).trim();
  return {
    exit: out.code,
    answer: stdout === "" ? undefined : JSON.parse(stdout),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

/** The environment main.ts needs to start at all: deno on PATH. */
function base(): Record<string, string> {
  return { PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" };
}

function cases(): string[] {
  return [...Deno.readDirSync(FIXTURES)].filter((e) => e.isDirectory)
    .map((e) => e.name).sort();
}

/** A case's file, with `{fixture}` as fleet agent check fills it in. */
function filled(kase: string, file: string): unknown {
  return JSON.parse(
    Deno.readTextFileSync(`${FIXTURES}${kase}/${file}`).replaceAll(
      "{fixture}",
      `${FIXTURES}${kase}`,
    ),
  );
}

function envelope(seats: unknown[]): string {
  return JSON.stringify({ schema_version: 1, root: "/work/project", seats });
}

for (const kase of cases()) {
  Deno.test(`read answers the fixture ${kase}`, async () => {
    const request = filled(kase, "request.json");
    const env = filled(kase, "env.json") as Record<string, string>;
    const answer = filled(kase, "answer.json") as object;
    const called = await call(JSON.stringify(request), { ...base(), ...env });
    assertEquals(called.exit, 0, called.stderr);
    assertEquals(
      why(CONTRACT, CONTRACT.verbs.read.response, called.answer),
      null,
    );
    assertEquals(called.answer, { schema_version: 1, ...answer });
  });
}

/**
 * One process answers every seat it is asked about, one row each and in the
 * order asked: every case's seats in one request answer as their cases did.
 */
Deno.test("one call answers every seat of every case, in order", async () => {
  const seats = cases().flatMap((kase) =>
    (filled(kase, "request.json") as { seats: unknown[] }).seats
  );
  const answers = cases().flatMap((kase) =>
    (filled(kase, "answer.json") as { seats: unknown[] }).seats
  );
  const called = await call(envelope(seats), {
    ...base(),
    FLEET_CLAUDE_BIN: REPLAY,
  });
  assertEquals(called.exit, 0, called.stderr);
  assertEquals(called.answer, { schema_version: 1, seats: answers });
});

/**
 * A fake claude that records each call — its parent's pid and the config dir
 * it ran under — in a file beside the dirs. Its body names no path, so every
 * run of the suite execs the same script (a freshly written executable's
 * first exec can stall on macOS).
 */
async function recordingClaude(root: string): Promise<string> {
  const path = `${root}/claude`;
  await Deno.writeTextFile(
    path,
    [
      "#!/bin/sh",
      'echo "$PPID $CLAUDE_CONFIG_DIR" >> "$CLAUDE_CONFIG_DIR/../record"',
      'cat "$CLAUDE_CONFIG_DIR/listing.json"',
      "",
    ].join("\n"),
  );
  await Deno.chmod(path, 0o755);
  return path;
}

/**
 * ACCEPTANCE: seats across three config dirs cost exactly three listings,
 * every one of them a child of the one main.ts process that answered them
 * all; a dir named twice, or with a trailing separator, is not a fourth.
 */
Deno.test("seats across three config dirs cost three listings in one process", async () => {
  const root = await Deno.makeTempDir({ prefix: "jymr3-three-" });
  try {
    const claude = await recordingClaude(root);
    for (const [dir, pid] of [["a", 11], ["b", 22], ["c", 33]] as const) {
      await Deno.mkdir(`${root}/${dir}`);
      await Deno.writeTextFile(
        `${root}/${dir}/listing.json`,
        JSON.stringify([{
          sessionId: `session-${dir}`,
          kind: "interactive",
          pid,
          status: "idle",
        }]),
      );
    }
    const seat = (n: number, dir: string, pid: number) => ({
      seat: `0199a3c4-0000-7000-8000-0000000004${n}0`,
      pid,
      config_dir: `${root}/${dir}`,
      worktree: "/work/project",
    });
    const called = await call(
      envelope([
        seat(1, "a", 11),
        seat(2, "b", 22),
        seat(3, "a/", 11),
        seat(4, "c", 33),
        seat(5, "b", 99),
      ]),
      { ...base(), FLEET_CLAUDE_BIN: claude },
    );
    assertEquals(called.exit, 0, called.stderr);
    const record = (await Deno.readTextFile(`${root}/record`)).trim()
      .split("\n").map((line) => line.split(" "));
    assertEquals(record.length, 3, JSON.stringify(record));
    assertEquals(new Set(record.map(([ppid]) => ppid)).size, 1);
    assertEquals(
      record.map(([, dir]) => dir).sort(),
      [`${root}/a`, `${root}/b`, `${root}/c`],
    );
    assertEquals(
      (called.answer!.seats as Record<string, unknown>[]).map((s) => [
        s.activity,
        s.session_id,
      ]),
      [
        ["idle", "session-a"],
        ["idle", "session-b"],
        ["idle", "session-a"],
        ["idle", "session-c"],
        ["starting", undefined],
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/** A read of no seats answers none, and runs no claude. */
Deno.test("a read of no seats answers none and lists nothing", async () => {
  const root = await Deno.makeTempDir({ prefix: "jymr3-none-" });
  try {
    const claude = await recordingClaude(root);
    const called = await call(envelope([]), {
      ...base(),
      FLEET_CLAUDE_BIN: claude,
    });
    assertEquals([called.exit, called.answer], [0, {
      schema_version: 1,
      seats: [],
    }]);
    let recorded = true;
    await Deno.stat(`${root}/record`).catch(() => recorded = false);
    assertEquals(recorded, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/**
 * A binary seam that names no absolute path is could not tell for the whole
 * call, exit 3, as every verb that runs claude answers it: the adapter is
 * misconfigured, and no dir's reading is its own.
 */
Deno.test("a seam naming a relative path is could not tell, exit 3", async () => {
  const called = await call(
    envelope([{ seat: SEAT, pid: 1, worktree: WT, config_dir: "/c" }]),
    { ...base(), FLEET_CLAUDE_BIN: "bin/claude" },
  );
  assertEquals(called.exit, 3, called.stderr);
  assert(called.stderr.includes("not an absolute path"), called.stderr);
});

// ------------------------------------------------------ one row's reading

const idle: Row = {
  sessionId: RA,
  kind: "interactive",
  pid: 84311,
  status: "idle",
};
const seat: SeatRef = { seat: SEAT, pid: 84311, worktree: WT };

function read(row: Partial<Row>, configDir = "/nowhere", with_ = seat) {
  const listing: Listing = { rows: [{ ...idle, ...row }] };
  return activityOf(with_, listing, configDir);
}

/**
 * lessons B10 on 2.1.280: status is three words — idle, busy and waiting —
 * and each is a typed activity; the row teaches its session id.
 */
Deno.test("status: idle, busy and waiting are typed activities", async () => {
  assertEquals(await read({ status: "idle" }), {
    seat: SEAT,
    activity: "idle",
    evidence: "typed",
    session_id: RA,
  });
  assertEquals(await read({ status: "busy" }), {
    seat: SEAT,
    activity: "busy",
    evidence: "typed",
    session_id: RA,
  });
  assertEquals(await read({ status: "waiting" }), {
    seat: SEAT,
    activity: "blocked",
    evidence: "typed",
    session_id: RA,
    cause: "the listing says waiting and names no cause",
  });
});

/** A status no rule reads, or none at all, is unknown, saying which. */
Deno.test("a status this adapter does not read is unknown, naming it", async () => {
  assertEquals(await read({ status: "dreaming" }), {
    seat: SEAT,
    activity: "unknown",
    evidence: "typed",
    session_id: RA,
    cause:
      'the listing\'s status is "dreaming", a word this adapter does not read',
  });
  assertEquals(
    (await read({ status: undefined })).cause,
    "the listing's row carries no status",
  );
});

/**
 * An unreadable listing is every seat under it unknown, with the listing's
 * cause (the rule controller/tests/observe.rs:1044 pins).
 */
Deno.test("an unreadable listing is unknown with its cause", async () => {
  assertEquals(
    await activityOf(seat, { unreadable: "its socket is gone" }, "/c"),
    {
      seat: SEAT,
      activity: "unknown",
      evidence: "typed",
      cause: "its socket is gone",
    },
  );
});

/**
 * lessons A11 — the logged-out first turn is read off the transcript of an
 * IDLE row, the session the row names, under the seat's config dir: the
 * recorded 2.1.280 transcript reads blocked on logged_out; the same row busy,
 * or the logged-in session's transcript, or none at all, does not.
 */
Deno.test("an idle row whose first turn was the logged-out answer is blocked", async () => {
  const loggedOut = `${FIXTURES}logged-out/config`;
  assertEquals(await read({ sessionId: RLO }, loggedOut), {
    seat: SEAT,
    activity: "blocked",
    blocked_on: "logged_out",
    evidence: "typed",
    session_id: RLO,
  });
  assertEquals(
    (await read({ sessionId: RLO, status: "busy" }, loggedOut)).activity,
    "busy",
  );
  assertEquals(
    (await read({ sessionId: RA }, `${FIXTURES}idle/config`)).activity,
    "idle",
    "the logged-in session's first turn answered",
  );
  assertEquals(
    (await read({ sessionId: RLO }, `${FIXTURES}idle/config`)).activity,
    "idle",
    "no transcript is a reading nobody has",
  );
});

/**
 * The transcript directory is keyed on the RESOLVED worktree (measured on
 * 2.1.280, fleet-jymr.4), so a worktree named through a symlink — macOS's
 * /var and /tmp are two — reads the file the session wrote.
 */
Deno.test("the logged-out transcript is found through a symlinked worktree", async () => {
  const root = await Deno.makeTempDir({ prefix: "jymr3-link-" });
  try {
    await Deno.mkdir(`${root}/real wt`);
    await Deno.symlink(`${root}/real wt`, `${root}/link`);
    const resolved = await Deno.realPath(`${root}/real wt`);
    const project = `${root}/config/projects/${encodeProjectDir(resolved)}`;
    await Deno.mkdir(project, { recursive: true });
    await Deno.copyFile(
      `${FIXTURES}logged-out/config/projects/-private-tmp-jymr3-rec-wt/${RLO}.jsonl`,
      `${project}/${RLO}.jsonl`,
    );
    const through = await read(
      { sessionId: RLO },
      `${root}/config`,
      { ...seat, worktree: `${root}/link` },
    );
    assertEquals(through.blocked_on, "logged_out");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/**
 * No row: the workspace-trust question on the screen (lessons A15, B10: the
 * row is absent while it is up; its text recorded on 2.1.280) is blocked on
 * a question, read off the screen; anything else is starting, typed.
 */
Deno.test("no row: the trust question is blocked, anything else starting", async () => {
  const empty: Listing = { rows: [] };
  const screen = (filled("trust-question", "request.json") as {
    seats: SeatRef[];
  }).seats[0].screen!;
  assertEquals(await activityOf({ ...seat, screen }, empty, "/c"), {
    seat: SEAT,
    activity: "blocked",
    blocked_on: "question",
    evidence: "screen",
  });
  for (const other of [undefined, null, "", '❯ Try "write a test"']) {
    assertEquals(await activityOf({ ...seat, screen: other }, empty, "/c"), {
      seat: SEAT,
      activity: "starting",
      evidence: "typed",
    });
  }
});

/**
 * The trust rule wants the question and its accepting choice both, read with
 * whitespace collapsed so a pane's wrap is one phrase: either alone is text
 * that could be anywhere on a screen.
 */
Deno.test("the trust rule wants the question and the accepting choice", () => {
  const question =
    "Quick safety check: Is this a project you created or one you trust?";
  const choice = "Yes, I trust this folder";
  assert(trustQuestion(`${question}\n ❯ No, exit\n   ${choice}`));
  assert(
    trustQuestion(
      "Is this a project you created or\n one you trust?\n Yes, I trust\nthis folder",
    ),
  );
  assert(!trustQuestion(question));
  assert(!trustQuestion(choice));
  assert(!trustQuestion(undefined));
});
