// The plain writes: create, update (with its fence and the reopen), append
// and close, each one handler over bd — ported from core/src/store/bd/mod.rs
// at e416304 (`create`, `update`, `append`, `close`), every "measured on"
// claim taken on bd 1.3.0 on a scratch board.
//
// EVERY FLAG CARRIES ITS VALUE AFTER `=`, and the text a person typed that is
// no flag's — an id, an entry's text — goes after `--`, so a title, a reason
// or a comment that opens with `-` is read as the text it is. Measured on
// 1.3.0: `create --title=-a-title` filed the title `-a-title`, and `comments
// add … -- <id> -starts-with-dash` appended that text.
//
// EVERY WRITE CARRIES `--actor`, the request's `by`, which bd records as the
// write's author: a comment's `author` is what `timeline` answers as `by`.
//
// WHAT CORE'S ADAPTER HELD AN ENTRY TO BEYOND ITS SCHEMA is not held here:
// `append`'s request is held to the contract's NewEntry before this runs
// (main.ts), and the rules a kind keeps past its shape — a delivery's shas,
// a landing's checks — are fleet's `Body::validate`, which fleet asks before
// it sends one (core/src/store/exec.rs `append`). Dropped, because a second
// copy of those rules here would drift from fleet's.

import type { NewItem } from "../contract.d.ts";
import { type Handlers, Refused, Usage } from "../lib/answer.ts";
import type { Bd } from "../lib/bd.ts";
import { createdId, fenced, holderNamed, written } from "../lib/write.ts";

/** The highest priority the contract names, and bd takes (measured, 1.3.0). */
export const PRIORITY_MAX = 4;

/**
 * The item, or the refusal no store may be sent it: a priority outside the
 * contract's 0 to 4 — fleet-b47's rule, in core's words. main.ts refuses the
 * same request first, as it fails the contract's schema; this holds the
 * handler to it where nothing else has.
 */
export function validatedNew(item: NewItem): void {
  const n = item.priority;
  if (typeof n === "number" && (n > PRIORITY_MAX || n < 0)) {
    throw new Usage(
      `the item \`${item.title}\` does not validate: priority is ${n}; the range is 0 to ${PRIORITY_MAX} — nothing was written`,
    );
  }
}

/** A seat's id as bd keeps an assignee: trimmed and in lowercase. */
function seatText(seat: string): string {
  return seat.trim().toLowerCase();
}

/** A holder as a write names one to bd: the seat's id, or `""` for nobody. */
export function heldText(held: string | null): string {
  return held === null ? "" : seatText(held);
}

/** An actor as bd records one: a seat's id in lowercase, anything else as sent. */
export function actorText(by: string): string {
  return by.startsWith("seat:") ? `seat:${seatText(by.slice(5))}` : by;
}

/**
 * The actor a close carries: A SEAT CLOSES AS ITS BARE ID, and every other
 * actor as its text (fleet-pjl's ruling). bd 1.3.0 closes an assigned item
 * only for an actor equal to its assignee, and an assignee is the seat's bare
 * id — measured: `--actor seat:<id>` on an item assigned `<id>` exits 1 with
 * `cannot close X: assignee is "<id>", actor is "seat:<id>"; reclaim or use
 * --force to override`, and `--actor <id>` closes it. An unassigned item has
 * no such fence, and `--actor run:<id>` closes one; on an assigned item that
 * actor is refused the same way, which no verb meets: a landing closes as the
 * seat that holds the item, and every other close is of a run's record, filed
 * with no assignee.
 */
export function closer(by: string): string {
  return by.startsWith("seat:") ? seatText(by.slice(5)) : by;
}

/**
 * One label as `--labels` takes it. bd splits the flag's value as CSV —
 * measured on 1.3.0: `--labels=a,b` filed `a` and `b`, and `--labels="x,y"`
 * filed the one label `x,y` — so a label carrying a comma or a quote is
 * quoted, its quotes doubled, and each label is a flag of its own (repeated,
 * measured: `--labels=p --labels=q` filed both). Core's adapter joined them
 * with commas, which filed a label carrying one as two.
 */
export function labelFlag(label: string): string {
  const text = /[",]/.test(label) ? `"${label.replaceAll('"', '""')}"` : label;
  return `--labels=${text}`;
}

/**
 * The text a comment keeps for one entry: the entry's object, compact, its
 * keys sorted at every depth — the text core's `entry::encode` writes, whose
 * serde_json map sorts its keys — so the same entry is the same text whoever
 * sent it, and the export moves only when the timeline does.
 */
export function wireText(entry: unknown): string {
  return JSON.stringify(sorted(entry));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, sorted(object[key])]),
  );
}

/** The argv of one update, the fence first, before the id. */
export function updateArgs(
  id: string,
  change: {
    title?: string | null;
    assignee?: string | null;
    status?: string;
    if_assignee?: string | null;
  },
  by: string,
): string[] {
  const args = ["update"];
  if (change.if_assignee !== undefined) {
    args.push(`--if-assignee=${heldText(change.if_assignee)}`);
  }
  if (typeof change.title === "string") args.push(`--title=${change.title}`);
  if (change.assignee !== undefined) {
    args.push(`--assignee=${heldText(change.assignee)}`);
  }
  if (change.status !== undefined) args.push(`--status=${change.status}`);
  args.push(`--actor=${actorText(by)}`, "--", id);
  return args;
}

/**
 * The plain writes over the store at a request's root. `open` makes the bd
 * each runs.
 */
export function writes(open: (root: string) => Bd): Handlers {
  return {
    /**
     * The item is held to its rule before anything is sent. `--labels` and
     * `--priority` go only where the item names them: bd files an item that
     * names no priority at its own default (2, measured on 1.3.0). The id
     * comes off the create's own answer.
     */
    async create({ root, item, by }) {
      validatedNew(item);
      const args = [
        "create",
        `--title=${item.title}`,
        `--description=${item.description}`,
        `--type=${item.type}`,
        ...(item.labels ?? []).map(labelFlag),
        ...(typeof item.priority === "number"
          ? [`--priority=${item.priority}`]
          : []),
        `--actor=${actorText(by)}`,
        "--json",
      ];
      return { id: await createdId(open(root), args) };
    },

    /**
     * ONE `update` carrying every field the change names: bd takes `--title`
     * and `--assignee` on one call — measured on 1.3.0, where one call moved
     * both — and the empty assignee is what clears the field: the item read
     * back with no `assignee` at all.
     *
     * THE FENCE IS `--if-assignee`, and `""` fences on nobody holding the
     * item — measured on 1.3.0: it took the write on an item never assigned
     * and on one whose holder `--assignee=` had cleared, and on an item a
     * seat held it wrote nothing, exited 13 and named the holder on stderr,
     * which answers moved. The fence is also what a writer who is not the
     * holder names to move the assignee of an `in_progress` item: bd 1.3.0
     * refuses the plain `--assignee` from anyone but the holder — measured:
     * `cannot reassign X: held by "S1" (in_progress); …`, exit 1, which is
     * could not tell — and takes it with `--if-assignee` naming the holder.
     *
     * `--status=open` RIDES THE SAME CALL, and it is taken from a writer who
     * is not the holder: with the holder's fence, measured on an item its
     * holder had closed, and unfenced on an `in_progress` item — it is the
     * assignee and not the status that bd 1.3.0 keeps for the holder alone.
     *
     * AN UPDATE NAMING NO TITLE, ASSIGNEE OR STATUS is usage, exit 2, with
     * nothing run — docs/store.md at tinyfleet 7fadcde (fleet-wpf0.1), which
     * fleet itself answers as could not tell before this is ever run. A
     * `title` of `null` names none, as fleet reads one. A status other than
     * `open` fails the contract's schema before this runs, and is usage too.
     */
    async update({ root, id, by, title, assignee, status, if_assignee }) {
      if (typeof title !== "string" && assignee === undefined && !status) {
        throw new Usage(
          "an update names no title, assignee or status — nothing was written",
        );
      }
      if (status !== undefined && status !== "open") {
        throw new Usage(
          `an update sets a status only to open, and this one names \`${status}\` — nothing was written`,
        );
      }
      const bd = open(root);
      const args = updateArgs(
        id,
        { title, assignee, status, if_assignee },
        by,
      );
      if (if_assignee === undefined) await written(bd, args);
      else {
        await fenced(
          bd,
          args,
          id,
          `held by ${holderNamed(heldText(if_assignee))}`,
        );
      }
      return {};
    },

    /**
     * ONE COMMENT per entry, whose text is the entry's wire text. Measured on
     * bd 1.3.0: `bd comments add <id> <text> --actor A --json` answers `{id,
     * issue_id, author: A, text, created_at}`, and the id — content-derived,
     * not time-ordered — is what this answers. A missing item exits 1 with
     * nothing on stderr and the error `resolving <id>: no issue found
     * matching "<id>"` as the JSON answer, which answers missing. A closed
     * item takes comments.
     */
    async append({ root, id, by, entry }) {
      const args = [
        "comments",
        "add",
        `--actor=${actorText(by)}`,
        "--json",
        "--",
        id,
        wireText(entry),
      ];
      return { entry: await createdId(open(root), args) };
    },

    /**
     * A CLOSE OF A CLOSED ITEM IS READ FIRST, because bd does not refuse one.
     * Measured on 1.3.0, on a scratch board: a second `bd close` of a closed
     * item exits 0 — printing `✓ Closed <id> — <title>: <reason>` — and
     * writes nothing: the item reads back with the first close's
     * `close_reason`. So the item's own row is read before the call, its
     * status alone, and a closed one is refused already with nothing run.
     * The read is also what refuses an item that is not there, as missing. A
     * close landing between the read and the call is not caught: bd answers
     * the second close as a close.
     */
    async close({ root, id, by, reason }) {
      const bd = open(root);
      const row = await bd.shownRow(id);
      if (row.status === "closed") {
        throw new Refused("already", `${id} is already closed`);
      }
      await written(bd, [
        "close",
        `--reason=${reason}`,
        `--actor=${closer(by)}`,
        "--",
        id,
      ]);
      return {};
    },
  };
}
