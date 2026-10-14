// `resume`: a seat's ended session back as a new pane's command — the full
// session id with the start's own model, posture and plugin (Reviewer call
// 2026-09-25, E3), and no name and no first turn, which are the session's
// already. Ported from the in-process ClaudeCode::resume
// (controller/src/adapter/claude_code.rs at tinyfleet 807107b).
//
// MEASURED ON 2.1.280 AND TMUX 3.7b (fleet-rge6.4, 2026-09-26): a session
// killed after a turn and resumed this way as a new tmux session was listed
// under the SAME session id on the new pane's pid, under the name its start
// gave it, on the flags' model and posture; the plugin's session-start hook
// fired with source `resume`, and the next turn went to the same transcript.
// Not a fork (lessons A9 was the background session's reading).
//
// The env is this agent's three (lib/claude.ts sessionEnv): a resume request
// carries none of fleet's, which core sets beside these. The config dir is
// not seeded again: the start seeded it, and the session resumes where it
// ran. A resume writes nothing.
//
// It does not ask Claude Code whether it has the session: a pane resuming an
// id nobody has is core's to watch come up, or not. A BLANK id is refused
// `missing` here, because `--resume` with no id opens Claude Code's own
// session picker in the pane.

import { type Handler, Refused } from "../lib/answer.ts";
import { claudeBin, SEAM, sessionEnv } from "../lib/claude.ts";
import { configDirFor, credentialDir, type Env } from "../lib/config_dir.ts";
import { pluginDir } from "../lib/plugin.ts";
import { flagFor } from "../lib/posture.ts";

const PROCESS: Env = (name) => Deno.env.get(name);

/** `resume`, reading the adapter's environment through `env`. */
export function resumeWith(env: Env = PROCESS): Handler<"resume"> {
  // Every refusal a rejection, never a throw out of the call.
  return (request) =>
    Promise.resolve().then(() => {
      const mode = flagFor(request.posture);
      const id = request.session_id.trim();
      if (id === "") {
        throw new Refused(
          "missing",
          "Claude Code has no session with a blank id to resume",
        );
      }
      return {
        argv: [
          claudeBin(env(SEAM)),
          "--resume",
          id,
          "--model",
          request.model,
          "--permission-mode",
          mode,
          "--plugin-dir",
          pluginDir(),
        ],
        env: sessionEnv({
          configDir: configDirFor(request, env),
          credentialDir: credentialDir(env),
        }),
      };
    });
}

export const resume: Handler<"resume"> = resumeWith();
