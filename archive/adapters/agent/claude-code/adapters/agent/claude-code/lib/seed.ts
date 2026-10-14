// A spawned seat's config dir, seeded so its interactive session comes up
// with nothing in front of it: the onboarding keys copied from the
// operator's own .claude.json, and the workspace-trust acceptance for the
// seat's own worktree. Ported from seed_config and operator_file
// (controller/src/adapter/claude_code.rs at tinyfleet 807107b), fleet-rge6.2's
// rules moved out of the controller; nothing re-decided.
//
// WHY (lessons claude-code D8, A15; measured on 2.1.280 by fleet-rge6.2 and
// fleet-031): an interactive start under an EMPTY config dir stops at the
// theme picker, then at the login-method menu, listed nowhere; one whose
// .claude.json carries hasCompletedOnboarding, lastOnboardingVersion and
// oauthAccount met neither, and with the credential scope defined-but-empty
// came up logged in. The trust question waits with "No, exit" selected; an
// entry projects[<resolved worktree>].hasTrustDialogAccepted = true skipped
// it.
//
// ONLY A SPAWNED SEAT IS SEEDED (ruling 13): fleet trusts only worktrees it
// created, and only a spawn into fleet's own worktree carries a config dir.
// launch calls neither function for a named seat, whose checkout is a
// person's.
//
// EVERY WRITE GOES THROUGH writeInside (lib/config_dir.ts), inside the config
// dir, at 0600: the file carries the operator's oauthAccount.

import { CouldNotTell, Usage } from "./answer.ts";
import { credentialDir, type Env, writeInside } from "./config_dir.ts";

const PROCESS: Env = (name) => Deno.env.get(name);

/** Claude Code's own state file in a config dir. */
export const STATE_FILE = ".claude.json";

/**
 * The keys a seat's config dir is seeded with, each REQUIRED of the
 * operator's file: the three measured sufficient on 2.1.280 (fleet-rge6.2;
 * whether each is needed alone was not separated).
 */
export const ONBOARDING_KEYS = [
  "hasCompletedOnboarding",
  "lastOnboardingVersion",
  "oauthAccount",
] as const;

/**
 * The fourth key D8 copied, carried WHERE THE OPERATOR'S FILE HAS IT and
 * never required: on 2.1.280 a dir seeded without it met no theme picker,
 * and the measuring machine's own file carries none — the setting lives in
 * its settings.json — so requiring it would refuse every spawn there
 * (fleet-rge6.2's reviewer call 1).
 */
export const THEME_KEY = "theme";

/** The per-directory table, and the flag that says trust was answered yes. */
export const PROJECTS_KEY = "projects";
export const TRUST_KEY = "hasTrustDialogAccepted";

/** The seeded file's mode: it carries the operator's oauthAccount. */
export const SEED_MODE = 0o600;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The operator's own state file, which the seed copies from: inside the
 * config dir the operator configured, where CLAUDE_CONFIG_DIR names one, and
 * in the home otherwise — where Claude Code itself keeps it in each case.
 */
export function operatorFile(env: Env = PROCESS): string {
  const configured = credentialDir(env);
  if (configured !== "") {
    return `${configured.replace(/\/+$/, "")}/${STATE_FILE}`;
  }
  const home = env("HOME")?.trim() ?? "";
  if (home === "") {
    throw new CouldNotTell(
      `the operator's ${STATE_FILE} cannot be found to seed a seat from: neither CLAUDE_CONFIG_DIR nor HOME is set`,
    );
  }
  return `${home.replace(/\/+$/, "")}/${STATE_FILE}`;
}

/** The JSON object at `path`; `undefined` where there is no file. */
async function readObject(path: string): Promise<Json | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw new CouldNotTell(
      `${path} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CouldNotTell(
      `${path} is not JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isObject(value)) throw new CouldNotTell(`${path} is not a JSON object`);
  return value;
}

/** The seat's state file merged by `change`, written back at SEED_MODE. */
async function merged(
  configDir: string,
  change: (seeded: Json, path: string) => void,
): Promise<void> {
  if (!configDir.trim().startsWith("/")) {
    throw new Usage(
      `the request's config_dir is \`${configDir}\`, which is not an absolute path`,
    );
  }
  const path = `${configDir.trim().replace(/\/+$/, "")}/${STATE_FILE}`;
  const seeded = (await readObject(path)) ?? {};
  change(seeded, path);
  await writeInside(
    { configDir },
    path,
    `${JSON.stringify(seeded, null, 2)}\n`,
    SEED_MODE,
  );
}

/**
 * The onboarding keys, copied from the operator's file into the seat's,
 * MERGED into whatever is there: a seeded key is set, nothing else is
 * touched, and nothing else of the operator's is copied — their projects
 * table least of all, which would trust every directory they ever trusted.
 *
 * Could not tell, naming it, and nothing written: no operator file, one that
 * is not a JSON object, or one missing a required key.
 */
export async function seedOnboarding(
  configDir: string,
  env: Env = PROCESS,
): Promise<void> {
  const source = operatorFile(env);
  const theirs = await readObject(source);
  if (theirs === undefined) {
    throw new CouldNotTell(
      `${source} is not there to copy the onboarding keys from`,
    );
  }
  for (const key of ONBOARDING_KEYS) {
    if (!(key in theirs)) {
      throw new CouldNotTell(
        `${source} carries no \`${key}\`, which a seat's config dir is seeded with so its session meets no onboarding`,
      );
    }
  }
  await merged(configDir, (seeded) => {
    for (const key of ONBOARDING_KEYS) seeded[key] = theirs[key];
    if (THEME_KEY in theirs) seeded[THEME_KEY] = theirs[THEME_KEY];
  });
}

/**
 * The workspace-trust acceptance for `worktree` and for no other directory,
 * merged into the seat's file. Keyed on the worktree RESOLVED: the session
 * reads its directory off its own process, which hands it back resolved — a
 * start given /tmp/x is listed at /private/tmp/x, and an entry keyed on the
 * resolved path held for it (fleet-rge6.2's Run C, 2.1.280). A worktree that
 * does not resolve is keyed as given.
 */
export async function seedTrust(
  configDir: string,
  worktree: string,
): Promise<void> {
  if (!worktree.startsWith("/")) {
    throw new Usage(
      `the request's worktree is \`${worktree}\`, which is not an absolute path`,
    );
  }
  let trusted = worktree;
  try {
    trusted = await Deno.realPath(worktree);
  } catch {
    // Not there yet, or not readable: keyed as given.
  }
  await merged(configDir, (seeded, path) => {
    const projects = seeded[PROJECTS_KEY] ?? {};
    if (!isObject(projects)) {
      throw new CouldNotTell(`${path}: \`${PROJECTS_KEY}\` is not an object`);
    }
    const entry = projects[trusted] ?? {};
    if (!isObject(entry)) {
      throw new CouldNotTell(`${path}: the worktree's entry is not an object`);
    }
    entry[TRUST_KEY] = true;
    projects[trusted] = entry;
    seeded[PROJECTS_KEY] = projects;
  });
}
