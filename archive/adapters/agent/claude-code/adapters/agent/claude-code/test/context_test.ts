// `context` end to end: main.ts run as fleet runs it, over every case under
// fixtures/context/ in fleet-14p8.8's layout — <case>/request.json, whose
// `{fixture}` is the case's absolute directory, and <case>/answer.json, the
// answer without its envelope. The transcripts under each case's config/ were
// recorded on Claude Code 2.1.280 (README.md, "The context fixtures", says
// how).
//
// last_write is the transcript's mtime, which a checkout does not keep: each
// case is copied to a scratch directory and every seat's transcript is given
// the mtime its answer names, plus 0.9 s, so the answer also proves the stamp
// is the second the file was written in and not a rounding of it.

import { assert, assertEquals } from "@std/assert";
import { CONTRACT } from "../lib/answer.ts";
import { why } from "../lib/schema.ts";
import { transcriptPath } from "../lib/transcript.ts";

const MAIN = new URL("../main.ts", import.meta.url).pathname;
const FIXTURES = new URL("../fixtures/context/", import.meta.url).pathname;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type Seat = {
  seat: string;
  session_id?: string;
  config_dir?: string;
  worktree: string;
};
type Answer = { seats: Record<string, unknown>[] };

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
    args: ["context"],
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

async function copy(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    const [src, dst] = [`${from}/${entry.name}`, `${to}/${entry.name}`];
    if (entry.isDirectory) await copy(src, dst);
    else await Deno.copyFile(src, dst);
  }
}

/** One case, laid out in a scratch copy with its mtimes set. */
async function staged(kase: string) {
  const dir = await Deno.makeTempDir({ prefix: `jymr4-${kase}-` });
  await copy(`${FIXTURES}${kase}`, dir);
  const request = JSON.parse(
    (await Deno.readTextFile(`${dir}/request.json`)).replaceAll(
      "{fixture}",
      dir,
    ),
  ) as { seats: Seat[] };
  const answer = JSON.parse(
    await Deno.readTextFile(`${dir}/answer.json`),
  ) as Answer;
  for (const [n, seat] of request.seats.entries()) {
    const stamp = answer.seats[n].last_write as string | undefined;
    if (stamp === undefined) continue;
    const path = transcriptPath(
      seat.config_dir!,
      seat.worktree,
      seat.session_id!,
    )!;
    const at = new Date(Date.parse(stamp) + 900);
    await Deno.utime(path, at, at);
  }
  return { dir, request, answer };
}

for (const kase of cases()) {
  Deno.test(`context answers the fixture ${kase}`, async () => {
    const { dir, request, answer } = await staged(kase);
    try {
      const called = await call(JSON.stringify(request), base());
      assertEquals(called.exit, 0, called.stderr);
      assertEquals(
        why(CONTRACT, CONTRACT.verbs.context.response, called.answer),
        null,
      );
      assertEquals(called.answer, { schema_version: 1, ...answer });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}

/**
 * One process answers every seat it is asked about, one row each and in the
 * order asked: every case's seats in one request answer as their cases did.
 */
Deno.test("one call answers every seat of every case, in order", async () => {
  const staging = await Promise.all(cases().map(staged));
  try {
    const seats = staging.flatMap((s) => s.request.seats);
    const called = await call(
      JSON.stringify({ schema_version: 1, root: "/work/project", seats }),
      base(),
    );
    assertEquals(called.exit, 0, called.stderr);
    assertEquals(called.answer, {
      schema_version: 1,
      seats: staging.flatMap((s) => s.answer.seats),
    });
  } finally {
    for (const s of staging) await Deno.remove(s.dir, { recursive: true });
  }
});

/**
 * Every last_write the fixtures answer is a Stamp, and a torn or blind seat
 * that has a file still has one.
 */
Deno.test("every answered last_write is a Stamp", () => {
  for (const kase of cases()) {
    const answer = JSON.parse(
      Deno.readTextFileSync(`${FIXTURES}${kase}/answer.json`),
    ) as Answer;
    for (const seat of answer.seats) {
      if (seat.last_write === undefined) continue;
      assert(STAMP.test(seat.last_write as string), `${kase}: ${seat}`);
    }
  }
});

/**
 * AC2 (controller/tests/observe.rs
 * a_transcript_resolves_under_the_directory_it_is_read_with): the transcript
 * is read under the seat's own config_dir. A named seat, which carries none,
 * reads under the operator's — CLAUDE_CONFIG_DIR, else ~/.claude — so the
 * same seat without its config_dir finds nothing there, and finds the same
 * file where the operator's directory is the one it was written under.
 */
Deno.test("a transcript resolves under the directory it is read with", async () => {
  const { dir, request, answer } = await staged("dotted-worktree");
  try {
    const [seat] = request.seats;
    const named = { ...seat, config_dir: undefined };
    const envelope = (seats: unknown[]) =>
      JSON.stringify({ schema_version: 1, root: dir, seats });
    const elsewhere = await call(envelope([named]), {
      ...base(),
      HOME: `${dir}/home`,
    });
    assertEquals(elsewhere.exit, 0, elsewhere.stderr);
    assertEquals(elsewhere.answer?.seats, [{ seat: seat.seat }]);
    const operators = await call(envelope([named]), {
      ...base(),
      CLAUDE_CONFIG_DIR: seat.config_dir!,
    });
    assertEquals(operators.answer?.seats, answer.seats);
    const underHome = await call(envelope([named]), {
      ...base(),
      HOME: dir,
    });
    assertEquals(
      underHome.answer?.seats,
      [{ seat: seat.seat }],
      "~/.claude is not config/",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * The transcript directory is keyed on the RESOLVED worktree (measured on
 * 2.1.280: `-c "/tmp/jymr4-rec/wt a_b.c"` wrote under
 * -private-tmp-jymr4-rec-wt-a-b-c), so a worktree named through a symlink is
 * resolved before it is encoded, and reads the file the session wrote.
 */
Deno.test("a worktree named through a symlink reads the resolved one's transcript", async () => {
  const { dir, request, answer } = await staged("dotted-worktree");
  try {
    const [seat] = request.seats;
    await Deno.mkdir(`${dir}/real wt`);
    await Deno.symlink(`${dir}/real wt`, `${dir}/link`);
    const resolved = await Deno.realPath(`${dir}/real wt`);
    const recorded = transcriptPath(
      seat.config_dir!,
      seat.worktree,
      seat.session_id!,
    )!;
    const moved = transcriptPath(seat.config_dir!, resolved, seat.session_id!)!;
    await Deno.mkdir(moved.slice(0, moved.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.rename(recorded, moved);
    const called = await call(
      JSON.stringify({
        schema_version: 1,
        root: dir,
        seats: [{ ...seat, worktree: `${dir}/link` }],
      }),
      base(),
    );
    assertEquals(called.exit, 0, called.stderr);
    assertEquals(called.answer?.seats, answer.seats);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * A seat whose config_dir cannot be named — none in the request, and neither
 * CLAUDE_CONFIG_DIR nor HOME set — is could not tell, exit 3, naming why; a
 * seat with no session id never asks, so it answers blind without them.
 */
Deno.test("no config dir to read under is could not tell, and no session id never asks", async () => {
  const seat = {
    seat: "0199a3c4-0000-7000-8000-00000000f001",
    worktree: "/work/project",
  };
  const blind = await call(
    JSON.stringify({ schema_version: 1, root: "/work/project", seats: [seat] }),
    base(),
  );
  assertEquals([blind.exit, blind.answer?.seats], [0, [{ seat: seat.seat }]]);
  const lost = await call(
    JSON.stringify({
      schema_version: 1,
      root: "/work/project",
      seats: [{ ...seat, session_id: "a-session" }],
    }),
    base(),
  );
  assertEquals(lost.exit, 3, lost.stderr);
  assert(lost.stderr.includes("no config dir is named"), lost.stderr);
});
