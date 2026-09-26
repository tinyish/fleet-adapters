#!/bin/sh
//usr/bin/env true; case "${FLEET_BD_BIN-}" in /*) run="bd,$FLEET_BD_BIN" ;; *) run=bd ;; esac; exec deno run --no-config --no-prompt --allow-run="$run" --allow-read --allow-write --allow-env=FLEET_BD_BIN "$0" "$@"

// The bd store adapter: `main.ts <verb>`, the request on stdin, the answer on
// stdout, the exit by docs/store.md's table, and stderr's last line for
// people. One process per call.
//
// THE FIRST TWO LINES ARE SHELL, and the rest TypeScript. `/bin/sh` runs the
// file, reads the second line — a comment to TypeScript — and replaces itself
// with Deno running this same file under the grant, which Deno reads past:
// the first line is a shebang to it and the second a comment. A shebang alone
// cannot carry the grant: `--allow-run` has to name $FLEET_BD_BIN's value
// when it is an absolute path, and a shebang's arguments are fixed — measured
// on Deno 2.9.7, `--allow-run=bd` resolves `bd` on PATH once, at startup, and
// refuses any other path. A value that is not absolute is granted nothing:
// lib/bd.ts refuses it, naming it.
//
// THE GRANT, and why each part:
//
//   --allow-run=bd[,$FLEET_BD_BIN]  bd, and nothing else, is run.
//   --allow-read, --allow-write     the store's config is read under the
//                                   request's root, and fleet-rsia.4's export
//                                   and scratch write there. The root is
//                                   known only once the request is read, and
//                                   Deno 2.9.7 narrows no grant after start —
//                                   measured: a revoke of one path leaves the
//                                   whole grant standing, and a revoke of the
//                                   whole leaves nothing the root could be
//                                   granted back from — so both are whole.
//   --allow-env=FLEET_BD_BIN        the one variable read.
//   --no-config                     Deno reads a deno.json beside the script
//                                   and above it (measured on 2.9.7): this
//                                   pack's own, or a checkout's around it,
//                                   would move a call's imports and lock.
//   --no-prompt                     a person running this on a terminal is
//                                   refused a permission, never asked.

import { emit, type Handlers, respond } from "./lib/answer.ts";
import { Bd, binary, SEAM } from "./lib/bd.ts";
import { reads } from "./verbs/reads.ts";
import { writes } from "./verbs/writes.ts";

/** The bd every verb runs, resolved when the first verb that runs one asks. */
function open(root: string): Bd {
  return new Bd(root, binary(Deno.env.get(SEAM)));
}

/**
 * Every verb this pack answers. A verb of the contract not named here —
 * fleet-rsia.4's order.set, order.withdraw, run.set, hold.raise, hold.clear,
 * holds.open, export and scratch — answers usage, exit 2, until its file
 * lands.
 */
export const HANDLERS: Handlers = { ...reads(open), ...writes(open) };

if (import.meta.main) {
  const stdin = await new Response(Deno.stdin.readable).text();
  Deno.exit(await emit(await respond(Deno.args[0], stdin, HANDLERS)));
}
