// `context`: each seat's transcript read — the window its last main-chain
// turn carried, the turns it took and when it last wrote — every seat in one
// process, one row each, in the order asked. It runs no claude.
//
// A SEAT THE ADAPTER CANNOT READ ANSWERS ITS ID ALONE, never a 0: no session
// id, a transcript that does not resolve or will not open, and every reader
// of fleet renders a missing reading as blind, where a 0 would read as an
// empty session (controller/src/observe.rs 430-435 at 451a33d). A file that
// opened and holds no turn is `turns: 0`, a measured zero.
//
// `window` IS NEVER ANSWERED. The transcript states none, and the window is
// the agent's and moves by model (lessons claude-code C5), so the rest
// threshold stays fleet's policy and this adapter reports no denominator it
// cannot read (Reviewer call 2026-09-25 (3)).

import type { SeatContext, SeatRef } from "../contract.d.ts";
import type { Handler } from "../lib/answer.ts";
import { configDirFor, type Env } from "../lib/config_dir.ts";
import {
  contextTokens,
  entries,
  transcriptFor,
  turns,
} from "../lib/transcript.ts";

/**
 * A file's mtime as a Stamp, `YYYY-MM-DDTHH:MM:SSZ` in UTC to the second it
 * falls in (Reviewer call 2026-09-25, E9). It is the last WRITE, not the
 * last word: a torn entry still has an mtime, and a second is far inside any
 * window set in hours (controller/src/adapter/claude_code.rs 622-627).
 */
export function stamp(mtime: Date): string {
  return `${mtime.toISOString().slice(0, 19)}Z`;
}

/** One seat's reading, or its id alone where there is none. */
export async function seatContext(
  seat: SeatRef,
  env?: Env,
): Promise<SeatContext> {
  const blind: SeatContext = { seat: seat.seat };
  const session = seat.session_id?.trim() ?? "";
  if (session === "") return blind;
  const path = await transcriptFor(
    configDirFor(seat, env),
    seat.worktree,
    session,
  );
  if (path === undefined) return blind;
  let body: string;
  let written: Date | null;
  try {
    body = await Deno.readTextFile(path);
    // After the read, so the stamp is no older than the last entry read.
    written = (await Deno.stat(path)).mtime;
  } catch {
    return blind;
  }
  const all = entries(body);
  const reading: SeatContext = { seat: seat.seat, turns: turns(all) };
  const tokens = contextTokens(all);
  if (tokens !== undefined) reading.tokens = tokens;
  if (written !== null) reading.last_write = stamp(written);
  return reading;
}

export const context: Handler<"context"> = async (request) => ({
  seats: await Promise.all(request.seats.map((seat) => seatContext(seat))),
});
