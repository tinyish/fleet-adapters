// The verbs that read: version, capabilities, resolve, show, list and
// timeline, each one handler over bd. fleet-rsia.3's writes and .4's orders,
// runs, holds, export and scratch sit beside these, each in a file of its own
// under verbs/, and main.ts names every verb this pack answers.

import type { Filter } from "../contract.d.ts";
import { CouldNotTell, type Handlers, Refused } from "../lib/answer.ts";
import { type Bd, type Row, tail } from "../lib/bd.ts";
import { entryOf, itemFrom, itemPrefixIn, summaryFrom } from "../lib/rows.ts";

/**
 * The types `bd create --type` names as its own — measured on 1.3.0, whose
 * help lists these nine and which files each. It files `event`, `gate`,
 * `molecule` and `message` too, which are its own bookkeeping and not an
 * item a person files. A project's `types.custom` is kept in bd's database
 * and not in its config, so reading it is a bd call, which a declaration
 * answered without one does not make: a custom type is not declared.
 */
export const TYPES = [
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "decision",
  "spike",
  "story",
  "milestone",
];

/** The store's own config under the root, where a prefix is named. */
export const CONFIG = ".beads/config.yaml";

/**
 * WHAT THIS PACK ANSWERS BEYOND THE VERBS EVERY STORE ANSWERS, and nothing
 * it does not answer yet: `export` and `scratch` are declared by the verbs
 * that build them (fleet-rsia.4), as `.beads/issues.jsonl` under `.beads/`
 * and `true`. Until then the contract's reading of a capability not declared
 * holds — the verb answers usage, exit 2 — and `fleet store check` refuses
 * to run, naming the missing scratch, rather than failing on a declaration
 * the pack does not keep.
 */
export const DECLARED = { export: null, scratch: false } as const;

/**
 * The version the first line of `bd version` names — `1.3.0` of `bd version
 * 1.3.0 (Homebrew)`, measured on 1.3.0 — its first token opening on a digit,
 * bare of a leading `v`. A line naming none is answered whole, so a bd that
 * printed something else is quoted rather than read as a version.
 */
export function versionIn(first: string): string {
  const token = first.split(/\s+/)
    .map((word) => word.replace(/^v/, ""))
    .find((word) => /^[0-9]/.test(word));
  return token ?? first;
}

/**
 * One listing's argv per filter. EVERY ONE CARRIES `-n 0`, which lifts the
 * verb's row cap, because a truncated list reads exactly like a whole one:
 * `ready` answers its first 100 rows by default, piped or not (measured on
 * 1.3.0, 100 of 112), and a board's `list.limit` caps a piped `list` too
 * (measured on 1.3.0: 3 of 11 with it set to 3, 11 with `-n 0`).
 *
 * A seat's listing carries `--all`, because `list` leaves closed items out
 * by default — measured on 1.3.0, an item its holder closed was gone from
 * `list -a <seat>` and back with `--all`, reading `closed` — and the
 * contract's is every item the seat holds, whatever its status. A label's is
 * the open items carrying it.
 */
export function listing(filter: Filter): string[] {
  if (filter === "ready") return ["ready", "--json", "-n", "0"];
  if ("label" in filter) {
    return [
      "list",
      `--label=${filter.label}`,
      "--status=open",
      "--json",
      "-n",
      "0",
    ];
  }
  return [
    "list",
    `--assignee=${filter.assignee}`,
    "--all",
    "--json",
    "-n",
    "0",
  ];
}

/**
 * The read verbs over the store at a request's root. `open` makes the bd a
 * verb runs, and is asked only by a verb that runs one: `capabilities` makes
 * no call, so a bd that cannot be resolved does not stop it.
 */
export function reads(
  open: (root: string) => Bd,
  readText: (path: string) => Promise<string> = Deno.readTextFile,
): Handlers {
  return {
    async version({ root }) {
      const bd = open(root);
      const args = ["version"];
      const ran = await bd.answered(args, { scoped: false });
      const first = ran.stdout.split("\n")[0].trim();
      if (first === "") {
        throw new CouldNotTell(
          `${bd.named(args)} answered no version: ${tail(ran)}`,
        );
      }
      return { name: "bd", version: versionIn(first) };
    },

    /**
     * No bd call. The prefix is the config's `issue-prefix:`, read off the
     * file and not asked of bd: a config that is not there, will not read or
     * names none is `null`. The command a seat types is `bd`, whichever
     * binary this adapter runs, because a seat's shell resolves the name on
     * its own PATH; the priorities are the 0 to 4 `bd create --priority`
     * takes, and 5 it refuses (measured on 1.3.0).
     */
    async capabilities({ root }) {
      let prefix: string | null = null;
      try {
        prefix = itemPrefixIn(await readText(`${root}/${CONFIG}`));
      } catch {
        prefix = null;
      }
      return {
        ...DECLARED,
        item_prefix: prefix,
        cli: "bd",
        items: { types: TYPES, priority: { min: 0, max: 4 } },
      };
    },

    /** The show call, answering only the row's `id`. */
    async resolve({ root, id }) {
      const bd = open(root);
      const row = await bd.shownRow(id);
      if (typeof row.id !== "string") {
        throw new CouldNotTell(
          `${
            bd.named(["show", "--json", "--", id])
          } answered a row naming no id`,
        );
      }
      return { id: row.id };
    },

    async show({ root, id }) {
      return { item: itemFrom(id, await open(root).shownRow(id)) };
    },

    async list({ root, filter }) {
      const bd = open(root);
      const args = listing(filter);
      const rows = await bd.listed(args);
      const from = bd.named(args);
      return {
        items: rows.flatMap((row) => {
          const summary = summaryFrom(row, from);
          return summary === null ? [] : [summary];
        }),
      };
    },

    /**
     * `bd comments <id> --json`: every comment on the item in append order
     * (created_at, then id; measured on 1.3.0), a person's left out. The
     * listing takes no row cap — the verb has no `-n`.
     *
     * THE JSON IS READ BEFORE THE EXIT, as `show`'s is: a missing item exits
     * 1 with `{"error": "resolving <id>: no issue found matching \"<id>\""}`,
     * which carries no code (measured on 1.3.0), and is the record's answer.
     */
    async timeline({ root, id }) {
      const bd = open(root);
      const args = ["comments", "--json", "--", id];
      const ran = await bd.run(args);
      const value = bd.json(args, ran);
      if (
        value !== null && typeof value === "object" && !Array.isArray(value) &&
        "error" in value
      ) {
        const error = (value as Row).error;
        throw new Refused(
          "missing",
          `${id} is not in the store: ${
            typeof error === "string" ? error : JSON.stringify(error)
          }`,
        );
      }
      if (ran.code !== 0) throw bd.refused(args, ran);
      let comments: unknown[];
      if (Array.isArray(value)) comments = value;
      else if (value === null || ran.stdout.trim() === "") comments = [];
      else {
        throw new CouldNotTell(
          `${bd.named(args)} did not answer a list: ${tail(ran)}`,
        );
      }
      return {
        entries: comments.flatMap((comment, n) => {
          const entry = entryOf(id, comment, n);
          return entry === null ? [] : [entry];
        }),
      };
    },
  };
}
