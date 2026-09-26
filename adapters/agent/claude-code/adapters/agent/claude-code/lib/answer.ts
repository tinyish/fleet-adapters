// The contract's side of one call: the request read off stdin and held to the
// schema, the verb run, and its answer written by the exit table of
// docs/agent.md — every exit this adapter gives is decided here.
//
// | Exit | Here                                        | stdout              |
// | ---- | ------------------------------------------- | ------------------- |
// | 0    | the verb's answer                           | its response        |
// | 1    | a `Refused` thrown: unsupported or missing  | `{refused}`         |
// | 2    | `Usage`: an unknown verb, a verb not yet    | nothing             |
// |      | answered, `context` undeclared, a request   |                     |
// |      | that fails the schema or names a relative   |                     |
// |      | root                                        |                     |
// | 3    | `CouldNotTell` — a claude that cannot be    | `{error}`           |
// |      | run among it — and anything else thrown     |                     |
//
// Every exit but 0 ends with one line on stderr for the person reading the
// refusal fleet prints, which carries that line.
//
// The bd pack's lib/answer.ts (fleet-packs 37d01bc) is the model: the same
// table, over the agent contract's refusal, which names no candidates.

import contract from "../contract.json" with { type: "json" };
import type {
  ErrorAnswer,
  Refusal,
  RefusalAnswer,
  RefusalReason,
  Verb,
  Verbs,
} from "../contract.d.ts";
import { type Document, type Schema, why } from "./schema.ts";

/** The one version of the contract this adapter speaks. */
export const SCHEMA_VERSION = 1;

/** The contract document `fleet agent schema` printed, committed beside it. */
export const CONTRACT = contract as unknown as Document & {
  verbs: { [verb: string]: { request: Schema; response: Schema } };
};

/**
 * Exit 1: the agent will not take what was asked — `unsupported`, a posture
 * or a model; `missing`, a resume of a session it does not have.
 */
export class Refused extends Error {
  constructor(readonly reason: RefusalReason, message: string) {
    super(message);
  }
}

/** Exit 2: the request is not one this adapter speaks, and nothing ran. */
export class Usage extends Error {}

/** Exit 3: claude could not be run, or did not answer something readable. */
export class CouldNotTell extends Error {}

/** A verb's answer without the version, which the envelope adds. */
export type Body<V extends Verb> = Omit<Verbs[V]["response"], "schema_version">;

/** What a verb is run with: its request, already held to the schema. */
export type Handler<V extends Verb> = (
  request: Verbs[V]["request"],
) => Promise<Body<V>>;

/** The verbs this adapter answers, each by its handler. */
export type Handlers = { [V in Verb]?: Handler<V> };

/** What `respond` reads off the adapter's own declaration. */
export interface Declared {
  /** Whether capabilities declares `context`; asked where it does not, 2. */
  context: boolean;
}

/** One call's ending: the exit, what stdout carries, and stderr's line. */
export interface Outcome {
  exit: 0 | 1 | 2 | 3;
  stdout?: unknown;
  stderr?: string;
}

/** The answer's own JSON: the body inside the envelope. */
function enveloped(body: object): object {
  return { schema_version: SCHEMA_VERSION, ...body };
}

/** The ending an error thrown out of a verb gives, by the exit table. */
export function outcomeOf(error: unknown): Outcome {
  if (error instanceof Refused) {
    const refused: Refusal = {
      reason: error.reason,
      message: line(error.message),
    };
    const answer: RefusalAnswer = { schema_version: 1, refused };
    return { exit: 1, stdout: answer, stderr: refused.message };
  }
  if (error instanceof Usage) return { exit: 2, stderr: line(error.message) };
  const said = line(
    error instanceof CouldNotTell
      ? error.message
      : `the claude-code pack failed: ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      }`,
  );
  const answer: ErrorAnswer = { schema_version: 1, error: said };
  return { exit: 3, stdout: answer, stderr: said };
}

/** A root the request names: absolute, as the envelope promises it is. */
function rooted(request: { root?: unknown }): void {
  if (typeof request.root !== "string" || !request.root.startsWith("/")) {
    throw new Usage(
      `the request's root is ${
        JSON.stringify(request.root)
      }, and it is an absolute path`,
    );
  }
}

/**
 * One call, start to end: `verb` as argv[1] names it, `stdin` the request's
 * text. Never throws — every ending is an `Outcome`.
 *
 * A VERB THE CONTRACT NAMES AND THIS ADAPTER DOES NOT ANSWER YET is usage,
 * exit 2, as an unknown verb is: the table's word for a call the adapter does
 * not speak. So a check of a partial adapter reports each unfilled verb as
 * failing, and never as a crash.
 */
export async function respond(
  verb: string | undefined,
  stdin: string,
  handlers: Handlers,
  declared: Declared = { context: true },
): Promise<Outcome> {
  try {
    if (verb === undefined || !(verb in CONTRACT.verbs)) {
      throw new Usage(
        `\`${
          verb ?? ""
        }\` is not a verb of the agent contract — the verbs are ${
          Object.keys(CONTRACT.verbs).join(", ")
        }`,
      );
    }
    if (verb === "context" && !declared.context) {
      throw new Usage(
        "the claude-code pack declares no context in its capabilities, so it is not asked",
      );
    }
    const handler = handlers[verb as Verb] as
      | ((request: unknown) => Promise<object>)
      | undefined;
    if (handler === undefined) {
      throw new Usage(`the claude-code pack does not answer \`${verb}\` yet`);
    }
    let request: unknown;
    try {
      request = JSON.parse(stdin);
    } catch (error) {
      throw new Usage(
        `the request on stdin is not one JSON value: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const refused = why(CONTRACT, CONTRACT.verbs[verb].request, request);
    if (refused !== null) {
      throw new Usage(
        `the ${verb} request does not read as the contract's: ${refused}`,
      );
    }
    rooted(request as { root?: unknown });
    return { exit: 0, stdout: enveloped(await handler(request)) };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** One line, as stderr's last line is read: no line breaks inside it. */
export function line(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * The outcome written out, answered as the exit code to leave with.
 *
 * STDERR'S LINE IS THE ERROR'S OWN TEXT, with nothing before it: fleet adds
 * the adapter's last line to its refusal only where the refusal does not
 * already carry it, and exit 3's refusal carries `error` — so the same words
 * are printed once.
 */
export async function emit(outcome: Outcome): Promise<number> {
  const encoder = new TextEncoder();
  if (outcome.stdout !== undefined) {
    await Deno.stdout.write(
      encoder.encode(JSON.stringify(outcome.stdout) + "\n"),
    );
  }
  if (outcome.stderr !== undefined) {
    await Deno.stderr.write(encoder.encode(`${outcome.stderr}\n`));
  }
  return outcome.exit;
}
