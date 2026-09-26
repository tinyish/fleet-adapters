// Claude Code as this adapter runs it: which binary, and one bounded run of
// it under a config dir and a credential scope. Ported from tinyfleet's
// in-process adapter (controller/src/adapter/claude_code.rs at 451a33d):
// resolve_effect_bin's rule for the binary, and with_environment's two
// variables for the scope.
//
// THE ENVIRONMENT IS INHERITED, and two variables are set over it. fleet runs
// this adapter under its own environment, as the store's exec does
// (Reviewer call 2026-09-25), so PATH, HOME and the rest reach claude from
// there; the per-seat values travel in the request. A launched session's
// environment is not this: it is launch's answer, which core sets exactly
// (D1, E2). The in-process adapter also clears and rebuilds the environment
// of its reads, because a `claude` call could start the background daemon
// every later session was claimed from (lessons claude-code D1); fleet's
// seats run in their own tmux sessions since fleet-rge6.2, and whether a read
// such as `claude agents` still starts that daemon on 2.1.280 is
// fleet-jymr.3's to measure before it reads the listing through run().
//
// NO PROCESS GROUP: Deno starts a child in this process's own group, and the
// bound here kills the child alone. fleet bounds the whole call at 20 s and
// kills this adapter's group, claude and anything it started among it.

import { CouldNotTell } from "./answer.ts";

/** The binary a call runs when nothing names another, resolved on PATH. */
export const CLAUDE = "claude";

/** The variable naming the claude to run, by absolute path, in PATH's place. */
export const SEAM = "FLEET_CLAUDE_BIN";

/** The config dir a claude runs under, and the credential scope beside it. */
export interface Scope {
  /** CLAUDE_CONFIG_DIR: the seat's, or the operator's own (config_dir.ts). */
  configDir: string;
  /**
   * CLAUDE_SECURESTORAGE_CONFIG_DIR: set on every run, DEFINED EVEN WHEN
   * EMPTY — unset, claude looks its login up under a name suffixed by the
   * config dir, which is the logged-out child (lessons claude-code A11).
   */
  credentialDir: string;
}

/** One run's result, as the process left it. */
export interface Ran {
  /** The exit code, or `null` where a signal ended it. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The claude a call runs: $FLEET_CLAUDE_BIN where it names an ABSOLUTE path
 * to an executable file, else `claude` on this process's PATH.
 *
 * A SEAM NAMING ANYTHING ELSE IS COULD NOT TELL, saying why, and claude on
 * PATH is never tried in its place: a caller that named a claude meant that
 * one, and a relative path would be read against whatever directory fleet
 * was started in. The seam's value is granted to Deno by main.ts's first two
 * lines; `--allow-run=claude` alone refuses every path but the one `claude`
 * resolved to on PATH when Deno started (measured on Deno 2.9.7).
 */
export function claudeBin(
  seam: string | undefined = Deno.env.get(SEAM),
  executable: (path: string) => boolean = isExecutable,
): string {
  const named = seam?.trim() ?? "";
  if (named === "") return CLAUDE;
  if (!named.startsWith("/")) {
    throw new CouldNotTell(
      `the agent binary seam ${SEAM} names \`${named}\`, which is not an absolute path`,
    );
  }
  if (!executable(named)) {
    throw new CouldNotTell(
      `the agent binary seam ${SEAM} names \`${named}\`, which is not an executable file`,
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

/** `promise`'s value, or `undefined` where it has not settled within `ms`. */
async function within<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One run of `argv` — the binary first, as claudeBin() chose it — under
 * `scope`, stdin closed, both streams read whole, and killed where it has
 * not ended within `boundMs`.
 *
 * A CLAUDE THAT CANNOT BE RUN — not found, not permitted — or one that
 * outruns the bound is could not tell, exit 3, naming the command. An exit
 * that is not 0 is the caller's to read: `version` answers null on one.
 */
export async function run(
  argv: string[],
  scope: Scope,
  boundMs: number,
): Promise<Ran> {
  const [bin, ...args] = argv;
  const shown = argv.join(" ");
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(bin, {
      args,
      env: {
        CLAUDE_CONFIG_DIR: scope.configDir,
        CLAUDE_SECURESTORAGE_CONFIG_DIR: scope.credentialDir,
      },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (error) {
    throw new CouldNotTell(
      `\`${bin}\` cannot be run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const output = child.output();
  const out = await within(output, boundMs);
  if (out === undefined) {
    try {
      child.kill("SIGKILL");
    } catch {
      // It ended between the bound and the kill.
    }
    // The streams close with the process; a grandchild holding them open is
    // left to fleet's group kill rather than waited on here.
    await within(output.catch(() => undefined), 1_000);
    throw new CouldNotTell(
      `\`${shown}\` did not answer within ${boundMs} ms, and was killed`,
    );
  }
  const decoder = new TextDecoder();
  return {
    code: out.signal === null ? out.code : null,
    stdout: decoder.decode(out.stdout),
    stderr: decoder.decode(out.stderr),
  };
}
