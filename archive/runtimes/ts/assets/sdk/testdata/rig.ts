// What every arm of the SDK's suite runs against: the shipped binary over a
// scratch machine directory and a scratch run directory, so what a step
// records and what a re-run replays travel the same path they do under a run.
//
// The stream is SEEDED with one line, the way a run's own `run.started` sits
// below every child it starts: the binary refuses a tail over a stream that is
// not there, and a wrapper whose first act is that tail would read the refusal
// where a run reads its own opening line.

import type { Env } from "../mod.ts";
import { type Line, lines as stored } from "./stream.ts";
import { type Body, enter as entered, type Entry, write } from "./store.ts";

// THE ACTOR A SESSION IS STARTED WITH IS STRIPPED, off this process and so
// off every binary an arm spawns — the real one and the fake alike. The
// controller sets FLEET_ACTOR=seat:<id> on every session it starts, and a
// suite run from inside one would otherwise write its steps as that seat
// rather than as the run, which is what a run's own cleared child does.
Deno.env.delete("FLEET_ACTOR");

/** The fleet binary every arm runs against: the one FLEET_BIN names. The
 * binary is built in fleet's own repository, so this suite runs against a
 * pinned build it is handed (`ci/check-ts.sh`) and never finds or builds one. */
export const bin: Promise<string> = (async () => {
  const named = Deno.env.get("FLEET_BIN");
  if (!named) {
    throw new Error(
      "FLEET_BIN names no fleet binary: set it to the fleet this suite runs against",
    );
  }
  await Deno.stat(named);
  return named;
})();

export interface Scratch {
  root: string;
  machine: string;
  /** The project the run was started inside: what every verb runs from. */
  project: string;
  env: Env;
}

let runs = 0;

export async function scratch(): Promise<Scratch> {
  const root = await Deno.makeTempDir({ prefix: "fleet-sdk-" });
  const machine = `${root}/machine`;
  const runId = `fleet-run-${Deno.pid}-${++runs}`;
  const runDir = `${root}/runs/${runId}`;
  const project = `${root}/project`;
  await Deno.mkdir(machine, { recursive: true });
  await Deno.mkdir(runDir, { recursive: true });
  await Deno.mkdir(project, { recursive: true });
  const stream = `${machine}/events.jsonl`;
  const opening = JSON.stringify({
    id: `${"0".repeat(24)}${Date.now().toString(16).padStart(8, "0")}-00000001`,
    seq: 1,
    ts: "2026-09-18T00:00:00Z",
    type: "run.started",
    actor: { kind: "run", id: "the-suite" },
    payload: { run: runId, hash: "0", workflow: "w" },
  });
  await Deno.writeTextFile(stream, `${opening}\n`);
  return {
    root,
    machine,
    project,
    env: {
      runId,
      stream,
      streamSeq: 1,
      runDir,
      bin: await bin,
      project,
      dir: machine,
    },
  };
}

export type { Line };

/** The fake binary's own directory under a scratch root, where a suite that
 * puts the fake in front of the real binary builds it: its canned answers, its
 * `calls.jsonl`, and the records `item show` answers from. */
export function fakeOf(s: Scratch): string {
  return `${s.root}/fake`;
}

/** An item's record planted whole where the fake's `item show` reads it:
 * `data` is the document's data, `{ id, status, timeline }`, the id and an
 * open status filled in where it names neither. */
export function plant(
  s: Scratch,
  item: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return write(fakeOf(s), item, data);
}

/** One entry appended to an item's planted record — what a verb's write leaves
 * in the store — by a seat unless an actor is named, as its `<kind>:<id>`. */
export function enter(
  s: Scratch,
  item: string,
  body: Body,
  by?: string,
): Promise<Entry> {
  return entered(fakeOf(s), item, body, by);
}

/** The stream as stored, parsed: what the writer put there. */
export function lines(s: Scratch): Promise<Line[]> {
  return stored(s.env.stream);
}

export function closes(all: Line[]): Line[] {
  return all.filter((l) => l.kind === "step.closed");
}

export function starts(all: Line[]): Line[] {
  return all.filter((l) => l.kind === "step.started");
}

/** A counting exec: how many times each named step's body ran. */
export function counters(): {
  calls: Record<string, number>;
  exec: <T>(name: string, value: T) => () => T;
} {
  const calls: Record<string, number> = {};
  return {
    calls,
    exec: (name, value) => () => {
      calls[name] = (calls[name] ?? 0) + 1;
      return value;
    },
  };
}
