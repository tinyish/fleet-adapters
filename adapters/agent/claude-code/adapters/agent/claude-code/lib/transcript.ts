// A seat's transcript: where Claude Code writes it, and the readings taken
// off its entries. Ported from tinyfleet's in-process adapter at 451a33d —
// encode_project_dir and transcript_path (controller/src/adapter/mod.rs
// 376-389) and the entry decoder, context_tokens_in, logged_out_first_turn
// and turns_in (controller/src/observe.rs 386-548) — so `context` answers
// what fleet's own reader answered (ruling 4: the adapter reads transcripts).
//
// EVERY READER HERE IS PURE: a body in, a reading out. The file is read by
// verbs/context.ts, and fleet-jymr.3's logged-out arm reads the same entries
// through loggedOutFirstTurn.
//
// A TRANSCRIPT IS READ WHILE IT IS APPENDED TO, so a line that is not JSON —
// a torn final line — is skipped, never fatal.

/** The per-project directory's name: every non-alphanumeric a dash. */
export function encodeProjectDir(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/** A session id as it names a file: letters, digits and dashes, no more. */
const SESSION_ID = /^[A-Za-z0-9-]+$/;

/**
 * The session's transcript under a config dir:
 * `<config dir>/projects/<encodeProjectDir(worktree)>/<session id>.jsonl`.
 *
 * lessons claude-code C1: the encoding makes EVERY non-alphanumeric character
 * a dash — the separators, and the dots, underscores and spaces beside them
 * (censused on 2.1.261, and a worktree carrying all three measured on
 * 2.1.280). The per-project renaming variable (C1, since 2.1.234) is not
 * read, as fleet's reader never read it: a fleet that sets it reads blind
 * (Reviewer call 2026-09-25 (2)).
 *
 * `undefined`, no path, where the answer would be a guess. A worktree with a
 * character outside ASCII: no specimen says how the agent encodes one, and
 * mapping it to a dash could name another worktree's directory. A session id
 * that is not a plain name: it would name a file outside the project's
 * directory. A path past about 200 characters, which the agent is said to
 * truncate with a hash suffix, is NOT refused here — it is unmeasured too,
 * but the untruncated name it gives is not a directory the agent wrote, so it
 * finds no file and answers no reading, as a missing file does.
 */
export function transcriptPath(
  configDir: string,
  worktree: string,
  sessionId: string,
): string | undefined {
  // deno-lint-ignore no-control-regex
  if (/[^\x00-\x7f]/.test(worktree)) return undefined;
  if (!SESSION_ID.test(sessionId)) return undefined;
  return `${configDir.replace(/\/+$/, "")}/projects/${
    encodeProjectDir(worktree)
  }/${sessionId}.jsonl`;
}

/** An entry's usage block: the three figures the window is summed from. */
export interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** One transcript line, as the readers here see it. */
export interface Entry {
  /** `type`: user, assistant, attachment and the rest; `""` where absent. */
  type: string;
  /** `isSidechain`: a subagent's entry (lessons C3); absent is main chain. */
  isSidechain: boolean;
  /** `message.id`: the model response the entry is a block of. */
  id?: string;
  /** `message.usage`, where the entry carries one. */
  usage?: Usage;
  /** `error`: the provider's own cause on an entry it wrote itself. */
  error?: string;
  /** `isApiErrorMessage`: the provider wrote this entry, not the model. */
  isApiErrorMessage: boolean;
}

type Json = { [key: string]: unknown };

function object(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Thrown inside `decode` where a field is of a kind serde would refuse. */
class Undecodable extends Error {}

/** An optional field: absent and null are none, else it is of `kind`. */
function optional<T>(
  value: unknown,
  is: (value: unknown) => value is T,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (!is(value)) throw new Undecodable();
  return value;
}

/** A defaulted field: absent is the default, and null is refused. */
function defaulted<T>(
  value: unknown,
  is: (value: unknown) => value is T,
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (!is(value)) throw new Undecodable();
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * One line decoded as observe.rs's TranscriptEntry took it through serde: a
 * field of the wrong kind drops the entry, an absent one is its default, and
 * a field no reader names is nothing. `message.id` is the one field that
 * decoder did not read, and a malformed one is no id rather than no entry.
 */
function decode(value: unknown): Entry | undefined {
  if (!object(value)) return undefined;
  try {
    const entry: Entry = {
      type: defaulted(value.type, isString, ""),
      isSidechain: defaulted(value.isSidechain, isBool, false),
      isApiErrorMessage: defaulted(value.isApiErrorMessage, isBool, false),
    };
    const error = optional(value.error, isString);
    if (error !== undefined) entry.error = error;
    const message = optional(value.message, object);
    if (message !== undefined) {
      if (isString(message.id)) entry.id = message.id;
      const usage = optional(message.usage, object);
      if (usage !== undefined) {
        entry.usage = {};
        for (
          const figure of [
            "input_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
          ] as const
        ) {
          const n = optional(usage[figure], isCount);
          if (n !== undefined) entry.usage[figure] = n;
        }
      }
    }
    return entry;
  } catch (error) {
    if (error instanceof Undecodable) return undefined;
    throw error;
  }
}

/** A body's entries, in order: blank, torn and undecodable lines skipped. */
export function entries(body: string): Entry[] {
  const found: Entry[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = decode(value);
    if (entry !== undefined) found.push(entry);
  }
  return found;
}

/** A usage block's window: the input tokens and both cache figures. */
function window(usage: Usage): number {
  return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
}

/** The main chain's assistant entries that carry a usage block. */
function calls(all: Entry[]): (Entry & { usage: Usage })[] {
  return all.filter((e): e is Entry & { usage: Usage } =>
    e.type === "assistant" && !e.isSidechain && e.usage !== undefined
  );
}

/**
 * The session's context in tokens: the LAST main-chain assistant entry whose
 * input tokens and both cache figures sum to more than zero, that sum.
 *
 * There is no single context number in the file (lessons C2). A sidechain is
 * a subagent's turn carrying the subagent's window (C3), so it is skipped —
 * on 2.1.280 a subagent writes its own file beside the session's, and the
 * filter stands for any release that writes one into the session's. An entry
 * summing to zero is the agent's line for a turn that made no model call
 * (the logged-out answer is one): a last-entry reader would answer 0 for a
 * loaded session. `undefined` where no entry states a window.
 */
export function contextTokens(all: Entry[]): number | undefined {
  return calls(all).map((e) => window(e.usage)).filter((n) => n !== 0).at(-1);
}

/**
 * How many turns the session took: model responses on the main chain, each
 * written as entries carrying a usage block.
 *
 * THE SAME FILTER AS contextTokens, ONE STEP SHORTER: the zero-usage entry
 * that reader skips IS counted here — a session's turns and the window its
 * last turn carried are two questions.
 *
 * ONE RESPONSE, ONE TURN. Measured on 2.1.280: a response is written as one
 * entry per content block (thinking, then text or tool_use), each carrying
 * the response's whole usage under the same `message.id`, so fleet's
 * turns_in, which counted entries, answered 2 for one answer. Entries sharing
 * an id count once; an entry with none counts alone.
 */
export function turns(all: Entry[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const e of calls(all)) {
    if (e.id !== undefined) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
    }
    count++;
  }
  return count;
}

/** The provider's own cause on its logged-out answer (lessons A11). */
export const AUTHENTICATION_FAILED = "authentication_failed";

/**
 * Whether the session's FIRST main-chain assistant entry is the provider's
 * logged-out answer: an entry it wrote itself, whose cause is
 * `authentication_failed`, and whose window is zero (lessons A11; recorded on
 * 2.1.280 in fixtures/context/logged-out-first-turn).
 *
 * ALL THREE TERMS ARE REQUIRED: a term that moves in a later release yields
 * no reading, which costs one uncaught logged-out seat, where a looser match
 * would read a working seat as logged out. The first entry, not the last: the
 * question is how the session answered its first turn.
 */
export function loggedOutFirstTurn(all: Entry[]): boolean {
  const first = all.find((e) => e.type === "assistant" && !e.isSidechain);
  if (first === undefined) return false;
  return first.isApiErrorMessage && first.error === AUTHENTICATION_FAILED &&
    window(first.usage ?? {}) === 0;
}
