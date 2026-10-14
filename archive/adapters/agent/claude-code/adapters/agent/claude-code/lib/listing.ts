// Claude Code's listing: one `claude agents --json --all` per distinct config
// dir, parsed into this adapter's own row, and a seat's row found among
// them. Ported from tinyfleet's in-process adapter at 753fdde: status and
// parse_roster (controller/src/adapter/claude_code.rs 585-606, 787-800),
// AgentRow and dir_key (controller/src/adapter/mod.rs 200-305), and
// Rosters::gather (controller/src/observe.rs 156-181); the matching is the
// one ruled at review (fleet-rge6, CORRECTIONS AT REVIEW 2026-09-25), not
// observe_seat's cwd match.
//
// ONE LISTING PER CONFIG DIR, because a config dir scopes the listing: a
// session started under its own dir is named by that dir's listing and by no
// other (lessons claude-code A11; interactive rows too, B10). So seats are
// grouped by the dir they run under, each dir is listed once, and the
// listings run at once.
//
// UNREADABLE IS PER DIR, NEVER EMPTY. A listing that exits non-zero, answers
// zero bytes with exit 0 (lessons B4), or whose rows do not parse leaves the
// seats under THAT dir unknown, and every other dir is read as usual. An
// empty array is a listing that answered, and said there is nothing.
//
// NO DAEMON, MEASURED. The in-process adapter clears the environment of its
// reads because a `claude` call could start the background daemon every
// later session was claimed from (lessons D1). On Claude Code 2.1.280
// (2026-09-26), `agents --json --all` under five scratch config dirs, over
// about four hundred listings with interactive sessions live, started no
// daemon — no `claude daemon run`, no new /tmp/cc-daemon-<uid>/ directory —
// and answered from the dir's own sessions/. So the listing runs through
// lib/claude.ts's run(), under fleet's inherited environment.

import type { SeatRef } from "../contract.d.ts";
import { CouldNotTell } from "./answer.ts";
import { claudeBin, run } from "./claude.ts";
import { configDirFor, credentialDir, type Env } from "./config_dir.ts";

/** The listing's arguments after the binary. */
export const LISTING = ["agents", "--json", "--all"];

/** How the listing is named in a cause: the command, never a fixture's path. */
const SHOWN = `\`claude ${LISTING.join(" ")}\``;

/**
 * How long one listing may take. B10 measured a listing at 100–160 ms; fleet
 * bounds the whole call at 20 s by default and kills it past that, so a
 * listing that hangs is cut at half of it and read as its own dir's
 * unknown, while the others still answer inside fleet's bound.
 */
export const LISTING_BOUND_MS = 10_000;

/** The kind of row a seat's session is: one started in a pane, not `--bg`. */
export const INTERACTIVE = "interactive";

/**
 * One row as this adapter reads it: the fields it reads, and no address
 * (Reviewer call 2026-09-25, E6: short ids never leave the adapter, so the
 * row carries no `id` at all). Every other field of the listing's row — cwd,
 * name, id, state and any the agent adds — is read past (lessons B1).
 */
export interface Row {
  /** `sessionId`: the session's full id, the one field every row carries. */
  sessionId: string;
  /** `kind`: `interactive` for a pane's session, `background` for `--bg`. */
  kind?: string;
  /** `pid`: the session's process, the pane's own under tmux (B10). */
  pid?: number;
  /** `status`: `idle`, `busy` or `waiting` on an interactive row (B10). */
  status?: string;
  /** `waitingFor`: present only while a human is being asked (B8). */
  waitingFor?: string;
  /** `startedAt`: epoch milliseconds, which of two rows is the newer. */
  startedAt?: number;
}

/** A listing under one dir: its rows, or why there are none to read. */
export type Listing = { rows: Row[] } | { unreadable: string };

type Json = { [key: string]: unknown };

function object(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Thrown inside `row` where a field it reads is of a kind serde refused. */
class Unparsed extends Error {}

/** An optional field: absent and null are none, else it is of `kind`. */
function optional<T>(
  value: Json,
  field: string,
  n: number,
  is: (value: unknown) => value is T,
  kind: string,
): T | undefined {
  const found = value[field];
  if (found === undefined || found === null) return undefined;
  if (!is(found)) {
    throw new Unparsed(
      `row ${n}'s ${field} is ${JSON.stringify(found)}, not ${kind}`,
    );
  }
  return found;
}

/** One row of the listing, or Unparsed naming what did not read. */
function row(value: unknown, n: number): Row {
  if (!object(value)) throw new Unparsed(`row ${n} is not an object`);
  if (!isString(value.sessionId)) {
    throw new Unparsed(`row ${n} has no sessionId`);
  }
  const found: Row = { sessionId: value.sessionId };
  const kind = optional(value, "kind", n, isString, "a string");
  if (kind !== undefined) found.kind = kind;
  const pid = optional(value, "pid", n, isCount, "a process id");
  if (pid !== undefined) found.pid = pid;
  const status = optional(value, "status", n, isString, "a string");
  if (status !== undefined) found.status = status;
  const waitingFor = optional(value, "waitingFor", n, isString, "a string");
  if (waitingFor !== undefined) found.waitingFor = waitingFor;
  const startedAt = optional(value, "startedAt", n, isCount, "a count");
  if (startedAt !== undefined) found.startedAt = startedAt;
  return found;
}

/**
 * The listing's stdout read as rows, or why it is not a reading.
 *
 * ZERO BYTES WITH A SUCCESS STATUS IS UNREADABLE (lessons B4): the force of
 * the rule is that empty is unreadable, never a reading of zero. `[]` is a
 * listing that answered. A body that is not a JSON array, or any row of it
 * that does not parse, leaves the whole listing unreadable, as parse_roster's
 * one serde call did.
 */
export function parseListing(stdout: string): Listing {
  if (stdout.trim() === "") {
    return {
      unreadable: "the listing answered with zero bytes and a success status",
    };
  }
  const refused = (why: string) => ({
    unreadable: `the listing did not parse as rows: ${why}`,
  });
  let body: unknown;
  try {
    body = JSON.parse(stdout);
  } catch (error) {
    return refused(
      `it is not JSON (${error instanceof Error ? error.message : error})`,
    );
  }
  if (!Array.isArray(body)) return refused("it is not an array");
  try {
    return { rows: body.map(row) };
  } catch (error) {
    if (error instanceof Unparsed) return refused(error.message);
    throw error;
  }
}

/**
 * A directory as seats are grouped by it: trailing separators removed, the
 * root left alone (dir_key, controller/src/adapter/mod.rs 295-302).
 */
export function dirKey(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? path : trimmed;
}

/** The last line of `text` that is not blank, trimmed. */
function lastLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).filter((line) =>
    line !== ""
  ).at(-1) ?? "";
}

/**
 * The listing under `configDir`: `claude agents --json --all` run with
 * CLAUDE_CONFIG_DIR set to it and the credential scope beside it
 * (config_dir.ts's credentialDir, defined even when empty: lessons A11).
 *
 * EVERY FAILURE IS THIS DIR'S UNREADABLE, NEVER A THROW: a non-zero exit,
 * naming stderr's last line; a signal; a claude that cannot be run or that
 * outruns `boundMs`. One dir's failure must leave every other dir read.
 */
export async function listUnder(
  configDir: string,
  bin: string,
  env?: Env,
  boundMs: number = LISTING_BOUND_MS,
): Promise<Listing> {
  let ran;
  try {
    ran = await run(
      [bin, ...LISTING],
      { configDir, credentialDir: credentialDir(env) },
      boundMs,
    );
  } catch (error) {
    if (error instanceof CouldNotTell) return { unreadable: error.message };
    throw error;
  }
  if (ran.code === null) return { unreadable: `${SHOWN} ended on a signal` };
  if (ran.code !== 0) {
    const said = lastLine(ran.stderr);
    return {
      unreadable: `${SHOWN} exited ${ran.code}${
        said === "" ? "" : `: ${said}`
      }`,
    };
  }
  return parseListing(ran.stdout);
}

/** How one dir is listed; tests hand their own. */
export type Lister = (configDir: string) => Promise<Listing>;

function listerFor(bin: string, env?: Env): Lister {
  return (configDir) => listUnder(configDir, bin, env);
}

/**
 * Every listing the seats need: one per distinct config dir — the seat's
 * own, or for a named seat the operator's (configDirFor) — keyed by dirKey,
 * all run at once. No seats, no listing.
 *
 * A seat whose config dir cannot be named at all (no config_dir, no
 * CLAUDE_CONFIG_DIR, no HOME) is could not tell for the whole call, as
 * `context` answers it: a broken environment, not a seat.
 */
export async function listingsFor(
  seats: SeatRef[],
  list?: Lister,
  env?: Env,
): Promise<Map<string, Listing>> {
  const dirs = [
    ...new Set(seats.map((seat) => dirKey(configDirFor(seat, env)))),
  ];
  if (dirs.length === 0) return new Map();
  // The binary is chosen once, and only where there is a dir to list: a seam
  // that names no absolute path is could not tell for the whole call.
  const lister: Lister = list ?? listerFor(claudeBin(), env);
  return new Map(
    await Promise.all(
      dirs.map(async (dir) => [dir, await lister(dir)] as const),
    ),
  );
}

/** The newest of `rows` by startedAt; a row with none is the oldest. */
function newest(rows: Row[]): Row | undefined {
  return rows.reduce<Row | undefined>(
    (best, row) =>
      best === undefined || (row.startedAt ?? 0) > (best.startedAt ?? 0)
        ? row
        : best,
    undefined,
  );
}

/**
 * The seat's row among `rows`: the interactive row carrying the seat's
 * session id; where none does, the interactive row whose pid is the pane's
 * (the request's `pid`, fleet-14p8.2), whose sessionId the answer then
 * teaches. Two rows under one key: the newest started.
 *
 * NEVER BY CWD. A working directory names a seat and proves nothing (lessons
 * B5), and fleet-rge6.3 removed that match: the pane's pid is the one
 * attribution kept, since the agent is the pane's own process (E2).
 *
 * A BACKGROUND ROW IS NEVER A SEAT'S, nor one with no kind: fleet's seats
 * run interactively in their own panes since fleet-rge6.2.
 *
 * AN ID NO ROW CARRIES FALLS TO THE PID. Measured on 2.1.280: `/clear` gives
 * the same pane pid a new sessionId, so a seat still holding the old id is
 * found by its pane, and learns the new id from the answer.
 */
export function match(seat: SeatRef, rows: Row[]): Row | undefined {
  const interactive = rows.filter((row) => row.kind === INTERACTIVE);
  const id = seat.session_id?.trim() ?? "";
  if (id !== "") {
    const byId = newest(interactive.filter((row) => row.sessionId === id));
    if (byId !== undefined) return byId;
  }
  if (seat.pid === undefined || seat.pid === null) return undefined;
  return newest(interactive.filter((row) => row.pid === seat.pid));
}
