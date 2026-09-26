// The holds: hold.raise, hold.clear and holds.open over bd's gates — ported
// from tinyfleet's in-process adapter (core/src/store/bd/mod.rs at e416304,
// `hold_raise`, `hold_clear`, `holds_open`), measured on bd 1.3.0.

import { CouldNotTell, type Handlers, Refused } from "../lib/answer.ts";
import type { Bd, Row } from "../lib/bd.ts";
import { createdId, written } from "../lib/write.ts";

/** The type bd files a gate under, and its status once resolved. */
export const GATE = "gate";
const CLEARED = "closed";

/**
 * A hold is a gate blocking the item: `gate create --blocks <id>`, of type
 * human — the type bd gives a gate with no `--type`, measured on 1.3.0, so
 * none is passed — and the held item leaves the ready set the moment it is
 * made (measured: gone from `bd ready`, back once the gate resolved).
 *
 * THE ITEM RIDES AS ITS OWN ARGUMENT after `--blocks`, so bd's `issue not
 * found: <id>` names an argument the call carried, which is how lib/write.ts
 * tells a missing item from any other failure. An id is the store's own, and
 * never opens with `-`.
 */
export function raising(id: string, by: string, reason: string): string[] {
  return [
    "gate",
    "create",
    "--blocks",
    id,
    `--reason=${reason}`,
    `--actor=${by}`,
    "--json",
  ];
}

/**
 * Every open gate, uncapped: `gate list` answers its first 50 rows by
 * default, piped or not — core's measure on 1.3.0, 50 of 53 — and a
 * truncated list reads exactly like a whole one.
 */
export const OPEN_HOLDS = ["gate", "list", "--json", "-n", "0"];

export function clearing(hold: string, by: string): string[] {
  return ["gate", "resolve", `--actor=${by}`, "--", hold];
}

/** hold.raise, hold.clear and holds.open over the store at a request's root. */
export function holds(open: (root: string) => Bd): Handlers {
  return {
    /**
     * THE HOLD'S ID COMES OFF THE STRUCTURED ANSWER and never off a printed
     * line. An item that is not there is `missing`: measured on 1.3.0, exit
     * 1 and `{"error": "issue not found: <id>"}` on stdout, nothing on
     * stderr.
     */
    async "hold.raise"({ root, id, by, reason }) {
      return { hold: await createdId(open(root), raising(id, by, reason)) };
    },

    /**
     * A CLEAR OF A CLEARED HOLD IS READ FIRST, because bd does not refuse
     * one: measured on 1.3.0, a second `gate resolve` exits 0, prints `✓ Gate
     * resolved: <id>` and writes nothing. So the gate's own row is read
     * before the call, and a closed one answers `already` with nothing run.
     * The read also answers a hold that is not there `missing` — and so does
     * an item that is no gate, which `gate resolve` refuses (`<id> is not a
     * gate issue`, exit 1, measured) and is no hold of this store's. A
     * resolve landing between the read and the call is not caught: bd
     * answers the second as a resolve.
     */
    async "hold.clear"({ root, hold, by }) {
      const bd = open(root);
      const row = await bd.shownRow(hold);
      const id = typeof row.id === "string" ? row.id : hold;
      if (row.issue_type !== GATE) {
        throw new Refused(
          "missing",
          `${hold} is no hold: ${id} is a ${
            typeof row.issue_type === "string" ? row.issue_type : "row"
          } and not a gate`,
        );
      }
      if (row.status === CLEARED) {
        throw new Refused("already", `${hold} is already cleared`);
      }
      await written(bd, clearing(id, by));
      return {};
    },

    /**
     * Hold ids only: the listing never names the item a gate blocks —
     * measured on 1.3.0, it appears only in the description's prose — and an
     * empty one answers `null`, which reads as none.
     */
    async "holds.open"({ root }) {
      const bd = open(root);
      const rows = await bd.listed(OPEN_HOLDS);
      return {
        holds: rows.flatMap((row, n) => {
          if (row === null || typeof row !== "object" || Array.isArray(row)) {
            throw new CouldNotTell(
              `${bd.named(OPEN_HOLDS)} answered row ${n}, which is no object`,
            );
          }
          const id = (row as Row).id;
          return typeof id === "string" ? [id] : [];
        }),
      };
    },
  };
}
