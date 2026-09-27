// `launch`: a seat's session as the pane's own command (E2), and the writes
// its start needs first. Ported from the in-process ClaudeCode::launch
// (controller/src/adapter/claude_code.rs at tinyfleet 807107b); nothing
// re-decided.
//
// THE ARGV is an INTERACTIVE session — no --bg: the pane is the session's
// host (fleet-rge6.2) — naming everything a start would otherwise choose for
// itself: the name the listing shows (lessons B3), the model and the posture
// (A5: on 2.1.280 a start naming neither came up on Opus 5.5 in auto mode,
// fleet-031), the pack's own plugin (D5; lib/plugin.ts), then the first turn
// as the positional prompt, which submits on its own (D8).
//
// THE ENV is set exactly by core over its own for the seat (D1, E2): the
// request's variables (FLEET_ACTOR, FLEET_BIN, PATH, ...) and this agent's
// three over them (lib/claude.ts sessionEnv) — the seat's config dir, else the
// operator's own for a named seat, as read runs its listing under; the
// credential scope, defined even when empty (A11); the auto-updater off.
//
// THE WRITES come first, inside the request's config dir and the seat's
// worktree and nowhere else (E8): a spawned seat's config dir is seeded with
// onboarding and its own worktree's trust (lib/seed.ts; ruling 13), and the
// request's neutral permissions are rendered into the worktree's
// .claude/settings.local.json, merged into any file standing there
// (lib/permissions.ts) — before the start, because Claude Code reads the file
// once, as it comes up. Everything that can refuse is asked before the first
// byte: the render, and the read of the standing file. A named seat carries
// no config dir: its worktree is a person's checkout, so it is seeded with
// nothing and no rules are rendered into it.

import type { Handler } from "../lib/answer.ts";
import { claudeBin, SEAM, sessionEnv } from "../lib/claude.ts";
import { configDirFor, credentialDir, type Env } from "../lib/config_dir.ts";
import { pluginDir } from "../lib/plugin.ts";
import {
  renderPermissions,
  settingsFor,
  writeSettings,
} from "../lib/permissions.ts";
import { flagFor } from "../lib/posture.ts";
import { seedOnboarding, seedTrust } from "../lib/seed.ts";

const PROCESS: Env = (name) => Deno.env.get(name);

/** `launch`, reading the adapter's environment through `env`. */
export function launchWith(env: Env = PROCESS): Handler<"launch"> {
  return async (request) => {
    // Everything that can refuse without writing, first.
    const mode = flagFor(request.posture);
    const bin = claudeBin(env(SEAM));
    const scope = {
      configDir: configDirFor(request, env),
      credentialDir: credentialDir(env),
    };
    const seatDir = request.config_dir?.trim() ?? "";
    if (seatDir !== "") {
      const settings = await settingsFor(
        request.worktree,
        renderPermissions(request.permissions, request.worktree),
      );
      await seedOnboarding(seatDir, env);
      await seedTrust(seatDir, request.worktree);
      await writeSettings(settings);
    }
    return {
      argv: [
        bin,
        "--name",
        request.name,
        "--model",
        request.model,
        "--permission-mode",
        mode,
        "--plugin-dir",
        pluginDir(),
        request.first_turn,
      ],
      env: { ...request.env, ...sessionEnv(scope) },
    };
  };
}

export const launch: Handler<"launch"> = launchWith();
