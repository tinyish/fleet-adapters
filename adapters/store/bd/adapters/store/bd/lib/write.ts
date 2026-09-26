// A bd write as this adapter reads its ending: taken, the record's refusal
// (an item that is not there, a fence the item no longer meets), or a store
// that did not answer — ported from core/src/store/bd/mod.rs at e416304
// (`written`, `not_written`, `created_id`, `fenced` and `missing`), every
// "measured on" claim taken on bd 1.3.0.
//
// ONE PLACE CLASSIFIES A WRITE'S FAILURE, so every write reads a missing item
// alike: fleet-rsia.3's create, update, append and close, and fleet-rsia.4's
// orders, runs and holds.

import { CouldNotTell, Refused } from "./answer.ts";
import { type Bd, FENCE_MISMATCH, type Ran, type Row, tail } from "./bd.ts";

/**
 * bd's word that a write named an item it does not hold: the argument it
 * named, and the line of `said` (the call's stderr), or the `error` of its
 * JSON answer, that names it as not found. `undefined` where neither does.
 *
 * Measured on bd 1.3.0, on a scratch board, each write on an id the board
 * does not hold exits 1, having written nothing:
 * - `update … -- <id>`, fenced or not: stderr `Error resolving <id>: no
 *   issue found matching "<id>"`, and nothing on stdout.
 * - `close … -- <id>`: stderr `Error: resolving ID <id>: no issue found
 *   matching "<id>"`.
 * - `comments add … --json -- <id> <text>`: nothing on stderr, and the error
 *   `resolving <id>: no issue found matching "<id>"` as the JSON answer.
 * - `gate create --blocks <id> … --json`: the error `issue not found: <id>`
 *   as the JSON answer; `gate resolve <hold>`: stderr `Error: gate not
 *   found: <hold>` (core's measure, for fleet-rsia.4's holds).
 *
 * THE WORDS MUST NAME AN ARGUMENT THE CALL CARRIED — quoted, or ending the
 * line — so an answer about any other id is not read as one this write named
 * being missing. An ambiguous fragment is a different answer (`ambiguous
 * issue ID: …`), and carries none of these words.
 */
export function missingIn(
  args: string[],
  said: string,
  error: string | undefined,
): { item: string; line: string } | undefined {
  const lines = [...said.split("\n"), ...(error === undefined ? [] : [error])]
    .map((line) => line.trim());
  for (const arg of args) {
    if (arg === "") continue;
    const quoted = `no issue found matching "${arg}"`;
    const ending = [`issue not found: ${arg}`, `gate not found: ${arg}`];
    const line = lines.find((line) =>
      line.includes(quoted) || ending.some((end) => line.endsWith(end))
    );
    if (line !== undefined) return { item: arg, line };
  }
  return undefined;
}

/**
 * The refusal a write answers where bd did not take it: bd's word that an
 * item the write names is not there is the record's answer, missing, and
 * anything else a store that did not answer.
 */
export function notWritten(bd: Bd, args: string[], ran: Ran): Error {
  const answer = bd.json(args, ran);
  const error = answer !== null && typeof answer === "object" &&
      !Array.isArray(answer) && typeof (answer as Row).error === "string"
    ? (answer as Row).error as string
    : undefined;
  const missing = missingIn(args, ran.stderr, error);
  if (missing !== undefined) {
    return new Refused(
      "missing",
      `${missing.item} is not in the store — nothing was written (${missing.line})`,
    );
  }
  return bd.refused(args, ran);
}

/** One write that has to be taken, its result handed back whole. */
export async function written(bd: Bd, args: string[]): Promise<Ran> {
  const ran = await bd.run(args);
  if (ran.code !== 0) throw notWritten(bd, args, ran);
  return ran;
}

/**
 * The id off a write's OWN answer — `create`'s item, `comments add`'s
 * comment, fleet-rsia.4's gate: `{"schema_version": 1, "data": {"id": …}}`,
 * measured on 1.3.0. A second read for the newest one would name whatever
 * else landed between the two calls.
 */
export async function createdId(bd: Bd, args: string[]): Promise<string> {
  const ran = await written(bd, args);
  const answer = bd.json(args, ran);
  const id = answer !== null && typeof answer === "object" &&
      !Array.isArray(answer)
    ? (answer as Row).id
    : undefined;
  if (typeof id !== "string" || id === "") {
    throw new CouldNotTell(`${bd.named(args)} answered no id: ${tail(ran)}`);
  }
  return id;
}

/** A holder as a refusal names one: the seat, or nobody for `""`. */
export function holderNamed(seat: string): string {
  return seat === "" ? "nobody" : `\`${seat}\``;
}

/**
 * A write carrying `--if-assignee`, `--if-status` or both, whose exit 13 is
 * bd's word that the item moved and nothing was written — measured on 1.3.0:
 * `assignee mismatch: X is held by "S2", expected "S1"` (and `status
 * mismatch: X has status "closed", expected "in_progress"`), exit 13, said
 * twice on stderr under `Error updating X:` and `X: updating issue:`.
 * `fence` is what the write was fenced on, as the refusal says it.
 *
 * THE REFUSAL QUOTES bd's MISMATCH, which names what holds the item or the
 * status it reads: from the first line saying it, from `… mismatch:` on, so
 * the holder is never cut off by the 160 characters a tail keeps.
 */
export async function fenced(
  bd: Bd,
  args: string[],
  item: string,
  fence: string,
): Promise<void> {
  const ran = await bd.run(args);
  if (ran.code === FENCE_MISMATCH) {
    throw new Refused(
      "moved",
      `${item} is not ${fence} — nothing was written (${mismatchIn(ran)})`,
    );
  }
  if (ran.code !== 0) throw notWritten(bd, args, ran);
}

/** bd's own words for a fence the item did not meet, else the call's tail. */
export function mismatchIn(ran: Ran): string {
  for (const line of ran.stderr.split("\n")) {
    const at = line.search(/\b(assignee|status) mismatch: /);
    if (at >= 0) return line.slice(at).trim();
  }
  return tail(ran);
}
