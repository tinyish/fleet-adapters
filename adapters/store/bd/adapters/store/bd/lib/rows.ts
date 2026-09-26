// A bd row as the contract's types: an issue as an Item or an ItemSummary, a
// comment as an Entry, and fleet's two metadata keys as an order state and a
// run's record — ported from core/src/store/bd/mod.rs and keys.rs at e416304.
//
// A BOARD IS SHARED. A project may keep its own `orders` or `run` key, so
// fleet's keys carry its name and nothing reads a bare one: an item holding
// no fleet key reads as no order and no run, whatever else its metadata holds.
//
// DOTTED AND TOP-LEVEL, AND NEVER ONE NESTED `fleet` OBJECT. bd merges a
// `--metadata` write at the top level and replaces one key's object whole —
// measured on bd 1.3.0, a nested `{"fleet":{"run":…}}` was lost to the next
// `{"fleet":{"orders":…}}` write, where `fleet.run` and `fleet.orders` kept
// each other — so the writers (fleet-rsia.4) each write the one key they own
// through `stamped`, and a nested `fleet` object is another writer's key.
//
// ONLY THE FIELDS READ ARE CHECKED. The in-process adapter decoded every row
// into bd's wire types, generated from beads' OpenAPI spec; this pack carries
// no generated bd types, so a field no verb reads is not held to its type,
// and a field one reads that is the wrong type refuses the read naming the
// row's id and the key.

import type {
  Entry,
  Item,
  ItemSummary,
  Order,
  OrderState,
  RunRecord,
} from "../contract.d.ts";
import { CouldNotTell, unlike } from "./answer.ts";
import type { Row } from "./bd.ts";

/** The order index a dispatch writes. */
export const ORDERS = "fleet.orders";

/** A run's own object, on its record item. */
export const RUN = "fleet.run";

/** The field each fleet key's object carries its version in. */
export const VERSION_FIELD = "v";

/** The one version this pack writes and reads. */
export const VERSION = 1;

/** The key a fleet entry's text carries, at the one version read. */
export const ENTRY_KEY = "fleet.entry";
export const ENTRY_VERSION = 1;

/**
 * The dependency types bd's ready set honours as blocking, measured on bd
 * 1.3.0 in a scratch board: one item per type, each depending on one open
 * item, then `bd ready --json -n 0`. These three took their item out of the
 * ready set, and a hold raised by `bd gate create --blocks` is a `blocks`
 * edge. `parent-child`, `related`, `discovered-from` and the rest left it
 * ready.
 */
export const BLOCKING = ["blocks", "conditional-blocks", "waits-for"];

type Metadata = unknown;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A fleet key's object with its version stamped in: `{"<key>": {…, "v": 1}}`. */
export function stamped(
  key: string,
  object: Record<string, unknown>,
): Record<string, unknown> {
  return { [key]: { ...object, [VERSION_FIELD]: VERSION } };
}

/**
 * The object a fleet key holds, or the sentence saying why this pack cannot
 * read it: not an object, or at a version it does not know.
 */
export function versioned(
  key: string,
  held: unknown,
): Record<string, unknown> | string {
  if (!isObject(held)) {
    return `\`${key}\` holds something that is not an object`;
  }
  const found = held[VERSION_FIELD];
  if (found === VERSION) return held;
  return found === undefined
    ? `\`${key}\` carries no ${VERSION_FIELD}, and this pack reads ${VERSION_FIELD} ${VERSION} and no other`
    : `\`${key}\` carries ${VERSION_FIELD} ${
      JSON.stringify(found)
    }, and this pack reads ${VERSION_FIELD} ${VERSION} and no other`;
}

function without(
  object: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const { [field]: _, ...rest } = object;
  return rest;
}

/** A seat's full id as fleet prints one: trimmed and in lowercase. */
const SEAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function seatOf(text: string): string | undefined {
  const seat = text.trim().toLowerCase();
  return SEAT.test(seat) ? seat : undefined;
}

/**
 * The order index off a row's metadata, as one of its three answers.
 *
 * Absent or `null` is no order. A key that is there and is not an object at
 * `v` 1 whose other fields read as the contract's Order — a partly filled
 * index, one at a version this pack does not know, one whose `at` is no stamp
 * — is unreadable: present, and never guessed at as an order.
 */
export function orderOf(metadata: Metadata): OrderState {
  const held = isObject(metadata) ? metadata[ORDERS] : undefined;
  if (held === undefined || held === null) return { state: "none" };
  const index = versioned(ORDERS, held);
  if (typeof index === "string") return { state: "unreadable" };
  const fields = without(index, VERSION_FIELD);
  if (unlike("Order", fields) !== null) return { state: "unreadable" };
  const order = fields as unknown as Order;
  // A seat left out and a seat written null are one order naming none,
  // which the contract prints by leaving it out.
  return {
    state: "ordered",
    order: {
      kind: order.kind,
      by: actorOf(order.by),
      at: order.at,
      ...(typeof order.seat === "string" ? { seat: seatOf(order.seat) } : {}),
    },
  };
}

/** An actor as fleet prints one: a seat's id in lowercase. */
function actorOf(actor: string): string {
  return actor.startsWith("seat:") ? `seat:${seatOf(actor.slice(5))}` : actor;
}

/**
 * The keys a row's metadata holds that are not fleet's two: another
 * writer's, named and never read. A bare `orders` is one, a nested `fleet`
 * object is one, and so is a `fleet.` key fleet never writes. Metadata that
 * is not an object holds no key.
 */
export function foreignOf(metadata: Metadata): string[] {
  if (!isObject(metadata)) return [];
  return Object.keys(metadata).filter((key) => key !== ORDERS && key !== RUN);
}

/**
 * A run's record off a row's metadata: absent or `null` is no record, and
 * one at `v` 1 that reads as the contract's RunRecord is the record.
 *
 * ANYTHING ELSE REFUSES THE READ. A record this pack cannot read is a run
 * whose state it cannot tell, and the item is not answered as though it
 * carried none.
 */
export function runOf(id: string, metadata: Metadata): RunRecord | null {
  const held = isObject(metadata) ? metadata[RUN] : undefined;
  if (held === undefined || held === null) return null;
  const version = isObject(held) && VERSION_FIELD in held
    ? JSON.stringify(held[VERSION_FIELD])
    : "none";
  const refused = (why?: string) =>
    new CouldNotTell(
      `${id}'s run record is not one this fleet reads (${RUN}, ${VERSION_FIELD} ${version})${
        why === undefined ? "" : ` — ${why}`
      }`,
    );
  const record = versioned(RUN, held);
  if (typeof record === "string") throw refused();
  const fields = without(record, VERSION_FIELD);
  const why = unlike("RunRecord", fields);
  if (why !== null) throw refused(why);
  return fields as unknown as RunRecord;
}

/**
 * The row's holder as a seat: none where the key is absent or empty — `""`
 * is what `--assignee` is handed to clear one — and a seat's full id where it
 * is one. Anything else is a person, and the read refuses naming them
 * (fleet-herk may move this).
 */
export function holderOf(id: string, held: string | undefined): string | null {
  if (held === undefined || held === "") return null;
  const seat = seatOf(held);
  if (seat === undefined) {
    throw new CouldNotTell(
      `${id} is held by ${held}, which is not a seat of this fleet — a person holds it, and fleet reads only seat holders`,
    );
  }
  return seat;
}

/** The fields of a row a verb reads, each held to its type. */
class Fields {
  constructor(
    private readonly row: Row,
    private readonly id: string,
    private readonly from: string,
  ) {}

  private refused(key: string, value: unknown, want: string): CouldNotTell {
    return new CouldNotTell(
      `${this.from} answered a row this pack does not read: \`${key}\` of ${this.id} is ${
        JSON.stringify(value)
      }, which is not ${want}`,
    );
  }

  /** Text, or `undefined` where the key is absent or `null`. */
  text(key: string, row: Row = this.row, path = key): string | undefined {
    const value = row[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw this.refused(path, value, "text");
    return value;
  }

  /** A list of text, empty where the key is absent or `null`. */
  texts(key: string): string[] {
    const value = this.row[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw this.refused(key, value, "a list");
    return value.map((item, n) => {
      if (typeof item !== "string") {
        throw this.refused(`${key}[${n}]`, item, "text");
      }
      return item;
    });
  }

  /** A list of objects, empty where the key is absent or `null`. */
  rows(key: string): Row[] {
    const value = this.row[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw this.refused(key, value, "a list");
    return value.map((item, n) => {
      if (!isObject(item)) {
        throw this.refused(`${key}[${n}]`, item, "an object");
      }
      return item;
    });
  }
}

/**
 * The dependencies that still stand between this item and a start: one the
 * store reports closed has been answered, and one of a type bd's ready set
 * does not honour never stood. One that names no type, or no status, is
 * kept: the cautious reading.
 */
function blockersOf(fields: Fields, dependencies: Row[]): string[] {
  return dependencies.flatMap((dependency, n) => {
    const at = `dependencies[${n}]`;
    const status = fields.text("status", dependency, `${at}.status`);
    const type = fields.text(
      "dependency_type",
      dependency,
      `${at}.dependency_type`,
    );
    const id = fields.text("id", dependency, `${at}.id`);
    if (status === "closed") return [];
    if (type !== undefined && !BLOCKING.includes(type)) return [];
    return id === undefined ? [] : [id];
  });
}

/**
 * One `bd show` row as the contract's Item. `text` is what the request named
 * the item by, which stands for its id where the row names none. The run's
 * record is read first and the holder second, so a row refused on both is
 * refused in the run's words, as the in-process adapter refused it.
 */
export function itemFrom(text: string, row: Row): Required<Item> {
  const read = new Fields(row, String(row.id ?? text), `show \`${text}\``);
  const id = read.text("id") ?? text;
  const metadata = row.metadata;
  const run = runOf(id, metadata);
  return {
    id,
    title: read.text("title") ?? "",
    description: read.text("description") ?? "",
    status: read.text("status") ?? "",
    type: read.text("issue_type") ?? "",
    labels: read.texts("labels"),
    assignee: holderOf(id, read.text("assignee")),
    order: orderOf(metadata),
    blockers: blockersOf(read, read.rows("dependencies")),
    run,
    foreign: foreignOf(metadata),
  };
}

/**
 * One listing row as the contract's ItemSummary, through the readers
 * `itemFrom` reads a row with, refusing where it refuses and in its words.
 * A row naming no id is no row.
 *
 * EACH ROW CARRIES ITS HOLDER AND ITS METADATA, so the assignee and the run's
 * record come off the listing's own rows and no row is shown after it:
 * measured on 1.3.0, `ready`, `list --label` and `list -a` each answered
 * `assignee` and the whole `metadata` object on every row.
 */
export function summaryFrom(
  row: unknown,
  from: string,
): Required<ItemSummary> | null {
  if (!isObject(row)) {
    throw new CouldNotTell(`${from} answered a row that is no object`);
  }
  const read = new Fields(row, String(row.id ?? "a row naming no id"), from);
  const id = read.text("id");
  if (id === undefined) return null;
  const metadata = row.metadata;
  const run = runOf(id, metadata);
  return {
    id,
    title: read.text("title") ?? "",
    status: read.text("status") ?? "",
    type: read.text("issue_type") ?? "",
    labels: read.texts("labels"),
    assignee: holderOf(id, read.text("assignee")),
    order: orderOf(metadata),
    run,
    foreign: foreignOf(metadata),
  };
}

/**
 * One `bd comments` row as the Entry fleet appended, or `null` for a
 * person's comment: a text that is no JSON object, or one without
 * `fleet.entry`.
 *
 * ONE THAT CARRIES THE KEY AND DOES NOT READ REFUSES THE WHOLE TIMELINE,
 * naming the comment: a timeline with a hole in it answers every question
 * wrong. The entry answered is the text's object without the key, with the
 * comment's id, its time and its author as `id`, `at` and `by` beside it,
 * held to the contract's Entry.
 *
 * Measured on bd 1.3.0: a comment answers `{id, issue_id, author, text,
 * created_at}`, its `author` the `--actor` the append carried and its
 * `created_at` to the second in UTC (`2026-09-26T03:16:12Z`); the listing is
 * in append order (created_at, then id).
 */
export function entryOf(
  item: string,
  comment: unknown,
  n: number,
): Entry | null {
  const from = `the timeline of ${item}`;
  if (!isObject(comment)) {
    throw new CouldNotTell(`${from} answered comment ${n}, which is no object`);
  }
  const read = new Fields(comment, `${item}'s comment ${n}`, from);
  const id = read.text("id") ?? "";
  const author = read.text("author") ?? "";
  const text = read.text("text") ?? "";
  const at = read.text("created_at") ?? "";
  let body: unknown;
  try {
    body = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!isObject(body) || !(ENTRY_KEY in body)) return null;
  const refused = (why: string) =>
    new CouldNotTell(
      `${item}'s comment ${id} carries ${ENTRY_KEY} and does not read: ${why}`,
    );
  if (body[ENTRY_KEY] !== ENTRY_VERSION) {
    throw refused(
      `it carries ${ENTRY_KEY} ${
        JSON.stringify(body[ENTRY_KEY])
      }, and this pack reads version ${ENTRY_VERSION}`,
    );
  }
  if (unlike("Actor", author) !== null) {
    throw new CouldNotTell(
      `${item}'s comment ${id} names its author ${author}, which is not an actor reference (<kind>:<id>)`,
    );
  }
  const entry = { ...without(body, ENTRY_KEY), id, at, by: author };
  const why = unlike("Entry", entry);
  if (why !== null) throw refused(why);
  return entry as unknown as Entry;
}

/**
 * The item prefix `.beads/config.yaml` carries, where it carries one: the
 * top-level `issue-prefix:` key, bare or quoted. A commented line, an empty
 * value and a file that says it some other way are `null` — a prefix nobody
 * named, never one guessed. `bd init --prefix` leaves the key commented
 * (measured on 1.3.0), so a board made without naming it again answers none.
 */
export function itemPrefixIn(config: string): string | null {
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || !line.startsWith("issue-prefix:")) continue;
    const value = line.slice("issue-prefix:".length).trim().replace(
      /^["']+|["']+$/g,
      "",
    );
    return value === "" ? null : value;
  }
  return null;
}
