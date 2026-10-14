// `version`: which agent this adapter drives, and at which version of itself
// — `claude --version`, read this call, its first token (parse_version and
// ClaudeCode::version, controller/src/adapter/claude_code.rs at tinyfleet
// 807107b). 2.1.280 prints "2.1.280 (Claude Code)" (lessons A1, fleet-031).
//
// A CLAUDE THAT WILL NOT ANSWER IS A VERSION NOBODY HAS — null — and never an
// error: not found, not runnable, a seam naming no executable, an exit that
// is not 0, nothing printed, or no answer within the bound. The adapter
// itself answered. Comparing the version with capabilities' `measured` is
// core's (ruling 8).
//
// The name is `claude`, the program, as the in-process adapter answers it
// (AGENT); the adapter's own name, claude-code, is fleet's to know.

import { CouldNotTell, type Handler } from "../lib/answer.ts";
import { claudeBin, run, SEAM } from "../lib/claude.ts";
import { configDirFor, credentialDir, type Env } from "../lib/config_dir.ts";

const PROCESS: Env = (name) => Deno.env.get(name);

/** The agent this adapter drives, as `version` names it. */
export const AGENT = "claude";

/** How long `claude --version` is given, well inside fleet's 20 s per call. */
export const VERSION_BOUND_MS = 10_000;

/** The first token of what `claude --version` printed, or null. */
export function parseVersion(stdout: string): string | null {
  return stdout.split(/\s+/).find((token) => token !== "") ?? null;
}

/** `version`, reading the adapter's environment through `env`. */
export function versionWith(
  env: Env = PROCESS,
  boundMs: number = VERSION_BOUND_MS,
): Handler<"version"> {
  return async () => {
    let version: string | null = null;
    try {
      const ran = await run(
        [claudeBin(env(SEAM)), "--version"],
        { configDir: configDirFor({}, env), credentialDir: credentialDir(env) },
        boundMs,
      );
      if (ran.code === 0) version = parseVersion(ran.stdout);
    } catch (error) {
      if (!(error instanceof CouldNotTell)) throw error;
    }
    return { name: AGENT, version };
  };
}

export const version: Handler<"version"> = versionWith();
