#!/bin/sh
//usr/bin/env true; case "${FLEET_CLAUDE_BIN-}" in /*) run="$FLEET_CLAUDE_BIN" ;; *) run=claude ;; esac; exec deno run --no-config --no-prompt --quiet --allow-run="$run" --allow-read --allow-write --allow-env=HOME,CLAUDE_CONFIG_DIR,FLEET_CLAUDE_BIN "$0" "$@"

// The Claude Code agent adapter: `main.ts <verb>`, the request on stdin, the
// answer on stdout, the exit by docs/agent.md's table, and stderr's last line
// for people. One process per call: no daemon, no socket, no tmux.
//
// THE FIRST TWO LINES ARE SHELL, and the rest TypeScript — the bd pack's
// polyglot (fleet-packs 37d01bc). `/bin/sh` runs the file, reads the second
// line — a comment to TypeScript — and replaces itself with Deno running this
// same file under the grant, which Deno reads past: the first line is a
// shebang to it and the second a comment. A shebang alone cannot carry the
// grant: `--allow-run` has to name $FLEET_CLAUDE_BIN's value when it is an
// absolute path, and a shebang's arguments are fixed — measured on Deno
// 2.9.7, `--allow-run=claude` resolves `claude` on PATH once, at startup, and
// refuses any other path. A seam that is not absolute is granted nothing:
// lib/claude.ts refuses it, naming it.
//
// THE GRANT, and why each part:
//
//   --allow-run=claude | $FLEET_CLAUDE_BIN
//                        the one claude a call runs, and nothing else: the
//                        seam's absolute path where it names one, for that
//                        is then the only claude lib/claude.ts runs, and
//                        `claude` on PATH otherwise.
//   --allow-read, --allow-write
//                        the operator's .claude.json is read and the seat's
//                        config dir and worktree written (fleet-jymr.2,
//                        fleet-jymr.5), and the transcripts read
//                        (fleet-jymr.4). Those directories are named by the
//                        request, and Deno 2.9.7 narrows no grant after it
//                        starts (fleet-rsia.2 measured it), so both are
//                        whole, and every write goes through
//                        lib/config_dir.ts's writeInside, which refuses a
//                        path resolving outside the request's config dir
//                        and worktree.
//   --allow-env=HOME,CLAUDE_CONFIG_DIR,FLEET_CLAUDE_BIN
//                        the three variables read: the operator's config dir
//                        and its fallback, and the binary seam. The rest of
//                        the environment reaches claude without being read.
//   --no-config          Deno reads a deno.json beside the script and above
//                        it (measured on 2.9.7): this pack's own, or a
//                        checkout's around it, would move a call's imports.
//   --no-prompt          a person running this on a terminal is refused a
//                        permission, never asked.
//   --quiet              Deno's own notes stay off stderr, whose last line is
//                        the person's: measured on 2.9.7, `--allow-run=claude`
//                        with no claude on PATH prints "Failed to resolve
//                        'claude' for allow-run" on every call without it.

import { emit, type Handlers, respond } from "./lib/answer.ts";
import { CAPABILITIES } from "./lib/capabilities.ts";
import { capabilities } from "./verbs/capabilities.ts";
import { context } from "./verbs/context.ts";

/**
 * Every verb this pack answers, each from verbs/<verb>.ts. A verb of the
 * contract no file here answers yet — version, launch and resume
 * (fleet-jymr.2), read (fleet-jymr.3) — is usage, exit 2.
 */
export const HANDLERS: Handlers = {
  capabilities,
  context,
};

if (import.meta.main) {
  const stdin = await new Response(Deno.stdin.readable).text();
  Deno.exit(
    await emit(
      await respond(Deno.args[0], stdin, HANDLERS, {
        context: CAPABILITIES.context ?? false,
      }),
    ),
  );
}
