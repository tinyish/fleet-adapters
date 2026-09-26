// What the suites share: the recorded answers, a bd that answers from a
// table and records every call, and the contract's reading of an answer.

import { assertEquals } from "@std/assert";
import { CONTRACT, SCHEMA_VERSION } from "../lib/answer.ts";
import { firstValue, opened, type Ran, type Runner } from "../lib/bd.ts";
import { why } from "../lib/schema.ts";

/**
 * A recorded answer's text. The FIXTURES were recorded from bd 1.3.0 on a
 * scratch board by tinyfleet's in-process adapter (core/src/store/bd/fixtures
 * at e416304; bd_cli.rs says how): `bd init` in a temporary directory, five
 * items, three dependencies (an open `blocks`, a closed `blocks` and a
 * `discovered-from`), metadata holding an order index and a run on one item,
 * a `fleet.orders` string on another and a foreign bare `orders` and `run`
 * on a third, and a gate — with BD_JSON_ENVELOPE=1. Moving the pin
 * re-records them.
 */
export function fixture(name: string): string {
  return Deno.readTextFileSync(
    new URL(`./fixtures/${name}.json`, import.meta.url),
  );
}

/** A recorded answer as the adapter reads it: its first value, opened. */
export function answer(text: string): unknown {
  return opened(firstValue(text), () => "a recorded answer");
}

/** A recorded listing's rows. */
export function rows(text: string): Record<string, unknown>[] {
  const value = answer(text);
  if (!Array.isArray(value)) {
    throw new Error(`a recorded listing is an array: ${text}`);
  }
  return value;
}

/**
 * A seat's full id, put on a recorded row in place of `seat-1`, the holder
 * bd 1.3.0 recorded, which is no seat's id.
 */
export const SEAT = "01a0d1f1-0aec-765f-9abe-0000000005e1";

/** One call a fake bd was handed. */
export interface Call {
  bin: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

/**
 * A bd that answers each call by `answers`, handed the argv after `-C
 * <root>`, and records every call whole.
 */
export function fake(
  answers: (args: string[]) => Partial<Ran>,
): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = (bin, args, { env, cwd }) => {
    calls.push({ bin, args, env, cwd });
    const after = args[0] === "-C" ? args.slice(2) : args;
    return Promise.resolve({
      code: 0,
      stdout: "",
      stderr: "",
      ...answers(after),
    });
  };
  return { runner, calls };
}

/** The verb's answer read as the contract reads it: no reason, or why not. */
export function assertAnswers(verb: string, body: object): void {
  assertEquals(
    why(CONTRACT, CONTRACT.verbs[verb].response, {
      schema_version: SCHEMA_VERSION,
      ...body,
    }),
    null,
    `${verb}'s answer reads as the contract's`,
  );
}
