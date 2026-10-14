// bd as this adapter runs it: which binary, the argv each call sends, the
// envelope each JSON answer is opened out of, and the reading of an exit and
// a stderr — ported from tinyfleet's in-process adapter
// (core/src/store/bd/mod.rs at e416304), whose every "measured on" claim was
// taken on the pinned bd, 1.3.0.
//
// EVERY CALL CARRIES BD_JSON_ENVELOPE=1, so a JSON answer comes as
// `{"schema_version": N, "data": …}` — the shape bd v2.0 makes the default —
// and that answer is opened in ONE place, `opened`, before anything reads
// it. bd applies the envelope to a `--json` answer alone (measured on 1.3.0:
// a rendering, the export and a write's own line were byte-identical with it
// and without), so one setting here cannot leave a read out.
//
// EVERY READ TAKES THE FIRST JSON VALUE of the answer and ignores what
// trails it: `bd show --json` answers one value and a newline, and a reader
// demanding the whole text be one value refuses a well-formed answer.
//
// THE TEXT A PERSON TYPED GOES AFTER `--`: every flag a call carries comes
// before it, so an id or a label that opens with `-` is read as the text it
// is and never as a flag of bd's. Measured on 1.3.0: `bd show --json -- v8u`
// answers fx-v8u, and `bd show --json -- --help` answers not found.
//
// NO BOUND OF ITS OWN: fleet bounds each adapter call at 60 seconds and kills
// the adapter's whole process group, bd among it, so a bd that hangs is
// killed with the call that ran it.

import { CouldNotTell, Refused } from "./answer.ts";

/** The binary a call runs when nothing names another, resolved on PATH. */
export const BD = "bd";

/**
 * The bd release this pack is measured against. A pin move is this line, the
 * PINNED line of the pack's doctor/bd-version/run.sh (test/doctor_test.ts
 * holds the two equal), and the re-measure: every claim in lib/ re-run on
 * the new release, and the fixtures re-recorded.
 */
export const PINNED = "1.3.0";

/** The newest `schema_version` bd answers that this adapter knows. */
export const BD_SCHEMA_VERSION = 1;

/** The variable that opts a call into the envelope before bd v2.0. */
export const ENVELOPE = "BD_JSON_ENVELOPE";

/** The variable naming the bd to run, by absolute path, in PATH's place. */
export const SEAM = "FLEET_BD_BIN";

/**
 * The exit bd 1.3.0 gives a write whose `--if-assignee` or `--if-status` no
 * longer holds: nothing was written (fleet-rsia.3's and .4's fences).
 */
export const FENCE_MISMATCH = 13;

/** One call's result, as the process left it. */
export interface Ran {
  /** The exit code, or `null` where a signal ended it. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** How a call is made: the binary, its argv, its environment and directory. */
export type Runner = (
  bin: string,
  args: string[],
  options: { env: Record<string, string>; cwd?: string },
) => Promise<Ran>;

/** The real runner: one process, stdin closed, both streams read whole. */
export const spawn: Runner = async (bin, args, { env, cwd }) => {
  const out = await new Deno.Command(bin, {
    args,
    env,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: out.signal === null ? out.code : null,
    stdout: decoder.decode(out.stdout),
    stderr: decoder.decode(out.stderr),
  };
};

/**
 * The bd a call runs: $FLEET_BD_BIN where it names an ABSOLUTE path to an
 * executable file, else `bd` on this process's PATH.
 *
 * A SEAM NAMING ANYTHING ELSE IS COULD NOT TELL, saying why, and bd on PATH
 * is never tried in its place: a caller that named a bd meant that one. The
 * seam's value is granted to Deno by main.ts's first two lines, which
 * `--allow-run=bd` alone would refuse — measured on Deno 2.9.7, it resolves
 * `bd` on PATH once, at startup, and refuses every other path.
 */
export function binary(
  seam: string | undefined,
  executable: (path: string) => boolean = isExecutable,
): string {
  const named = seam?.trim() ?? "";
  if (named === "") return BD;
  if (!named.startsWith("/")) {
    throw new CouldNotTell(
      `the item-tracker seam names \`${named}\`, which is not an absolute path`,
    );
  }
  if (!executable(named)) {
    throw new CouldNotTell(
      `the item-tracker seam names \`${named}\`, which is not an executable file`,
    );
  }
  return named;
}

function isExecutable(path: string): boolean {
  try {
    const info = Deno.statSync(path);
    return info.isFile && ((info.mode ?? 0o111) & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * The first JSON value of a text, with whatever trails it discarded, or
 * `undefined` where the text opens on none.
 */
export function firstValue(text: string): unknown {
  const start = text.search(/\S/);
  if (start < 0) return undefined;
  const open = text[start];
  let end = -1;
  if (open === "{" || open === "[") {
    let depth = 0;
    let quoted = false;
    for (let at = start; at < text.length; at++) {
      const c = text[at];
      if (quoted) {
        if (c === "\\") at++;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          end = at + 1;
          break;
        }
      }
    }
  } else if (open === '"') {
    for (let at = start + 1; at < text.length; at++) {
      if (text[at] === "\\") at++;
      else if (text[at] === '"') {
        end = at + 1;
        break;
      }
    }
  } else {
    const token = /^[^\s,\]}]+/.exec(text.slice(start));
    end = token === null ? -1 : start + token[0].length;
  }
  if (end < 0) return undefined;
  try {
    return JSON.parse(text.slice(start, end));
  } catch {
    return undefined;
  }
}

/** A warning said on stderr the first time only, as a verb may read often. */
function once(): (line: string) => void {
  let said = false;
  return (line) => {
    if (!said) {
      said = true;
      console.error(line);
    }
  };
}

const warnOnce = once();

/**
 * The answer inside bd's envelope, or the value itself where it carries none.
 *
 * A `schema_version` above the one this adapter knows is WARNED ABOUT ONCE,
 * on stderr, AND READ: a newer bd adds keys far more often than it moves one.
 *
 * BOTH KEYS MAKE AN ENVELOPE. A bare error carries `schema_version` beside
 * `error` and no `data` — measured on 1.3.0 with the envelope off — and is
 * handed back whole for `shown` to read.
 */
export function opened(
  value: unknown,
  from: () => string,
  warn: (line: string) => void = warnOnce,
): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const answer = value as Record<string, unknown>;
  const version = answer.schema_version;
  if (typeof version === "number" && version > BD_SCHEMA_VERSION) {
    warn(
      `${from()} answered schema_version ${version}, newer than the ${BD_SCHEMA_VERSION} this adapter knows — reading it anyway`,
    );
  }
  if ("schema_version" in answer && "data" in answer) return answer.data;
  return answer;
}

/**
 * What a call said last: the last line of its stderr that is not blank, else
 * of its stdout, cut to 160 characters.
 */
export function tail(ran: Ran): string {
  const body = ran.stderr.trim() === "" ? ran.stdout : ran.stderr;
  const last = body.split("\n").reverse().find((line) => line.trim() !== "");
  return (last ?? "no output").trim().slice(0, 160);
}

/**
 * The words a stderr line names an ambiguity with: bd 1.3.0's, measured, and
 * bd 1.2.2's, which 1.3.0 moved — kept, so a bd off the pin still refuses an
 * ambiguous id by its matches rather than as an id that is not there.
 */
const AMBIGUOUS = ["ambiguous issue ID", "ambiguous ID"];

/**
 * The items bd named for an ambiguous id, off its stderr — `Error fetching
 * 0: ambiguous issue ID: "0" matches 2 issues: [fx-0bp fx-0qi]`, measured on
 * 1.3.0, with `Use more characters to disambiguate` after it as the last
 * line — or `undefined` where stderr says nothing of an ambiguity. `line` is
 * the whole line that said it, for a refusal naming no ids in brackets.
 */
export function ambiguous(
  said: string,
): { candidates: string[]; line: string } | undefined {
  const line = said.split("\n").find((line) =>
    AMBIGUOUS.some((words) => line.includes(words))
  );
  if (line === undefined) return undefined;
  const listed = /\[([^\]]*)\]/.exec(line);
  const candidates = listed === null
    ? []
    : listed[1].split(/\s+/).filter((id) => id !== "");
  return { candidates, line: line.trim() };
}

/** A JSON object, as a row or an error is one. */
export type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The row an opened `show` answer holds, or the store's word that there is
 * none. `text` is what the request named the item by, and `said` the call's
 * stderr.
 *
 * AN ERROR CARRYING A CODE is classified by it: `not_found` is the record's
 * answer, and any other code is a store that did not answer. An error with
 * NO code is read by its key alone, as an item that is not there — measured
 * on bd 1.3.0, whose missing id answers an error, a hint and no code. A
 * `code` that is not text reads as no code.
 *
 * AN ARGUMENT NAMING MORE THAN ONE ITEM is told from one naming none by
 * stderr alone: bd 1.3.0 answers both with the same JSON error, and only its
 * stderr says `ambiguous issue ID: … matches N issues: [...]`. So the refusal
 * names the matches bd listed, and no verb guesses which one was meant.
 */
export function shown(text: string, value: unknown, said: string): Row {
  const row = Array.isArray(value) ? value[0] : value;
  if (row === undefined) {
    throw new Refused("missing", `\`${text}\` is not in the store`);
  }
  if (!isRow(row)) {
    throw new CouldNotTell(`show \`${text}\` answered a row that is no object`);
  }
  if (typeof row.error === "string") {
    const code = typeof row.code === "string" ? row.code : undefined;
    if (code !== undefined && code !== "not_found") {
      throw new CouldNotTell(
        `\`${text}\` could not be read (${code}): ${row.error}`,
      );
    }
    const matched = ambiguous(said);
    if (matched !== undefined) {
      const named = matched.candidates.length > 0
        ? matched.candidates.join(", ")
        : matched.line;
      throw new Refused(
        "ambiguous",
        `\`${text}\` matches more than one item — ${named} — and more of the id says which one this is`,
        matched.candidates,
      );
    }
    throw new Refused(
      "missing",
      `\`${text}\` is not in the store: ${row.error}`,
    );
  }
  return row;
}

/**
 * The store as `bd` answers it, scoped to one project: `-C <root>` on every
 * call, so the store a verb reads is the project's whatever directory fleet
 * ran this adapter from.
 */
export class Bd {
  constructor(
    readonly root: string,
    readonly bin: string = BD,
    private readonly runner: Runner = spawn,
  ) {}

  /** The call as a message names it: the binary and the argv after `-C`. */
  named(args: string[]): string {
    return `\`${this.bin} ${
      args.map((arg) => arg === "" ? "''" : arg).join(" ")
    }\``;
  }

  /**
   * One call under `-C <root>`. `scoped: false` leaves `-C` off, for a call
   * that reads no store (`bd version`) or is made where no store is yet, in
   * `cwd` (`bd init`, fleet-rsia.4's scratch). A bd that cannot be run is
   * could not tell.
   */
  async run(
    args: string[],
    options: { scoped?: boolean; cwd?: string } = {},
  ): Promise<Ran> {
    const argv = options.scoped === false ? args : ["-C", this.root, ...args];
    try {
      return await this.runner(this.bin, argv, {
        env: { [ENVELOPE]: "1" },
        cwd: options.cwd,
      });
    } catch (error) {
      throw new CouldNotTell(
        `\`${this.bin}\` could not be run (${
          error instanceof Error ? error.message : String(error)
        }) — nothing was written`,
      );
    }
  }

  /** The refusal of a call that exited other than 0: its argv, exit and tail. */
  refused(args: string[], ran: Ran): CouldNotTell {
    const exit = ran.code === null
      ? "was ended by a signal"
      : `exited ${ran.code}`;
    return new CouldNotTell(`${this.named(args)} ${exit}: ${tail(ran)}`);
  }

  /** The JSON a call answered, opened out of its envelope. */
  json(args: string[], ran: Ran): unknown {
    const value = firstValue(ran.stdout);
    return value === undefined
      ? undefined
      : opened(value, () => this.named(args));
  }

  /** One call that has to exit 0, its result handed back whole. */
  async answered(
    args: string[],
    options: { scoped?: boolean; cwd?: string } = {},
  ): Promise<Ran> {
    const ran = await this.run(args, options);
    if (ran.code !== 0) throw this.refused(args, ran);
    return ran;
  }

  /**
   * One listing, as its rows.
   *
   * AN EMPTY LISTING MAY ANSWER `null` AND NOT `[]` — measured on bd 1.3.0
   * for `gate list` — or nothing at all, and both read as no rows: a reader
   * demanding an array would read "nothing here" as a store that would not
   * answer.
   */
  async listed(args: string[]): Promise<unknown[]> {
    const ran = await this.answered(args);
    const value = this.json(args, ran);
    if (Array.isArray(value)) return value;
    if (value === null) return [];
    if (value === undefined && ran.stdout.trim() === "") return [];
    throw new CouldNotTell(
      `${this.named(args)} did not answer a list: ${tail(ran)}`,
    );
  }

  /**
   * The row `bd show` answers for the text, before anything is read out of
   * it. bd resolves a partial id itself — measured on 1.3.0: a whole id,
   * then a whole hash, then the ids whose hash opens with the text
   * (fleet-z5m's rule) — and the row's `id` is the full one.
   *
   * THE JSON IS READ BEFORE THE EXIT: bd exits 1 on an item it does not hold
   * and prints the error object, which is the record's answer and not a
   * refusal. A call that printed no JSON at all — a root with no store,
   * measured on 1.3.0: exit 1, `cannot use -C directory …: no beads project
   * found` on stderr, nothing on stdout — is could not tell.
   */
  async shownRow(text: string): Promise<Row> {
    const args = ["show", "--json", "--", text];
    const ran = await this.run(args);
    const value = this.json(args, ran);
    if (value === undefined) {
      throw new CouldNotTell(
        `${this.named(args)} answered no JSON: ${tail(ran)}`,
      );
    }
    const row = shown(text, value, ran.stderr);
    if (ran.code !== 0) throw this.refused(args, ran);
    return row;
  }
}
