// `read`: what the agent in each seat's live session is doing, every seat in
// one process, one row each, in the order asked — from one `claude agents
// --json --all` per distinct config dir (lib/listing.ts), and, for the two
// readings the listing cannot give, the transcript's first turn and the
// pane's screen.
//
// ACTIVITY IS THE ADAPTER'S; PRESENCE IS CORE'S (ruling 3). Whether the
// session exists and its pane is alive is read from tmux by fleet, never
// here, and whether a start that never arrives has failed is core's too. So
// a seat with no row answers `starting` and never an end.
//
// THE ROW'S READING (lessons claude-code B8, B10; measured again on 2.1.280,
// 2026-09-26, fixtures/read/): `waitingFor` is keyed on PRESENCE — present,
// the seat is blocked whatever the status beside it; `permission prompt`, the
// one value recorded, is blocked on permission (Reviewer call 2026-09-25
// (1): each new value recorded gets its fixture and its mapping in the same
// landing) — and otherwise `status` is the activity: idle, busy, or waiting,
// which is blocked. All of it is typed.
//
// `usage_limit` IS NEVER ANSWERED until its shape is measured
// (fleet-tnkuq.54).

import type { SeatActivity, SeatRef } from "../contract.d.ts";
import type { Handler } from "../lib/answer.ts";
import { configDirFor } from "../lib/config_dir.ts";
import {
  dirKey,
  type Listing,
  listingsFor,
  match,
  type Row,
} from "../lib/listing.ts";
import {
  entries,
  loggedOutFirstTurn,
  transcriptFor,
} from "../lib/transcript.ts";

/** The one `waitingFor` value recorded, and the block it names. */
export const PERMISSION_PROMPT = "permission prompt";

/**
 * The workspace-trust question as 2.1.280 draws it (recorded 2026-09-26,
 * fixtures/read/trust-question): the question, and its accepting choice
 * beneath "No, exit" (lessons A15, D8).
 */
export const TRUST_QUESTION = "Is this a project you created or one you trust?";
export const TRUST_CHOICE = "Yes, I trust this folder";

/**
 * Whether `screen` shows the workspace-trust question: the question AND its
 * accepting choice, read with whitespace collapsed so a phrase the pane's
 * width wrapped is still one. Both, because either alone is text a session
 * could show for another reason.
 */
export function trustQuestion(screen: string | null | undefined): boolean {
  const flat = (screen ?? "").split(/\s+/).filter((word) => word !== "")
    .join(" ");
  return flat.includes(TRUST_QUESTION) && flat.includes(TRUST_CHOICE);
}

/**
 * Whether the session's first turn was the provider's logged-out answer:
 * its transcript under `configDir`, found for the seat's worktree resolved,
 * read by the three-term rule (loggedOutFirstTurn; lessons A11). A
 * transcript that is not there or will not open is a reading nobody has,
 * and the row's own reading stands.
 */
async function loggedOut(
  configDir: string,
  worktree: string,
  sessionId: string,
): Promise<boolean> {
  const path = await transcriptFor(configDir, worktree, sessionId);
  if (path === undefined) return false;
  try {
    return loggedOutFirstTurn(entries(await Deno.readTextFile(path)));
  } catch {
    return false;
  }
}

/** A matched row's reading, before the transcript is asked. */
function fromRow(seat: SeatRef, row: Row): SeatActivity {
  const typed = {
    seat: seat.seat,
    evidence: "typed",
    session_id: row.sessionId,
  } as const;
  if (row.waitingFor !== undefined) {
    return row.waitingFor === PERMISSION_PROMPT
      ? { ...typed, activity: "blocked", blocked_on: "permission" }
      : {
        ...typed,
        activity: "blocked",
        cause: `the agent waits for \`${row.waitingFor}\``,
      };
  }
  switch (row.status) {
    case "idle":
      return { ...typed, activity: "idle" };
    case "busy":
      return { ...typed, activity: "busy" };
    case "waiting":
      return {
        ...typed,
        activity: "blocked",
        cause: "the listing says waiting and names no cause",
      };
    case undefined:
      return {
        ...typed,
        activity: "unknown",
        cause: "the listing's row carries no status",
      };
    default:
      return {
        ...typed,
        activity: "unknown",
        cause: `the listing's status is ${
          JSON.stringify(row.status)
        }, a word this adapter does not read`,
      };
  }
}

/**
 * One seat's activity, from the listing of its config dir.
 *
 * - The listing unreadable: unknown, with its cause.
 * - A row (lib/listing.ts's match): the row's reading, and its sessionId
 *   answered, which is how a seat known only by its pane learns its session.
 *   An IDLE row whose session's first turn was the logged-out answer is
 *   blocked on logged_out: a logged-out session is live and idle on the
 *   listing, and only its transcript says otherwise (lessons A11). This
 *   answers the state every poll; the once-per-row dedupe and the
 *   transient-only rule stay core's (logged_out_dispatch, fleet-14p8.3).
 * - No row: launch seeds trust (ruling 13), so the trust dialog should not
 *   be up; where the screen shows it anyway (the row is absent while it is
 *   up, B10), blocked on a question, read off the screen; otherwise
 *   starting.
 */
export async function activityOf(
  seat: SeatRef,
  listing: Listing,
  configDir: string,
): Promise<SeatActivity> {
  if ("unreadable" in listing) {
    return {
      seat: seat.seat,
      activity: "unknown",
      evidence: "typed",
      cause: listing.unreadable,
    };
  }
  const row = match(seat, listing.rows);
  if (row === undefined) {
    return trustQuestion(seat.screen)
      ? {
        seat: seat.seat,
        activity: "blocked",
        blocked_on: "question",
        evidence: "screen",
      }
      : { seat: seat.seat, activity: "starting", evidence: "typed" };
  }
  const reading = fromRow(seat, row);
  if (
    reading.activity === "idle" &&
    await loggedOut(configDir, seat.worktree, row.sessionId)
  ) {
    return { ...reading, activity: "blocked", blocked_on: "logged_out" };
  }
  return reading;
}

export const read: Handler<"read"> = async (request) => {
  const listings = await listingsFor(request.seats);
  return {
    seats: await Promise.all(request.seats.map((seat) => {
      const configDir = dirKey(configDirFor(seat));
      return activityOf(seat, listings.get(configDir)!, configDir);
    })),
  };
};
