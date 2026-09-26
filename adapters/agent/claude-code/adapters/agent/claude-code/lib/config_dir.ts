// Which config dir a seat's claude runs under, the credential scope beside
// it, and the ONE HELPER EVERY WRITE GOES THROUGH.
//
// THE WRITE BOUNDARY IS HERE, NOT IN THE GRANT. main.ts grants Deno read and
// write on the whole filesystem: the directories a call may write in are
// named by its request, and Deno 2.9.7 narrows no grant once it has started
// (fleet-rsia.2 measured it for bd's root). So a launch may write inside the
// request's config dir and inside the seat's worktree, and nowhere else
// (Reviewer call 2026-09-25, E8: the transient seat's permission file lands
// in the worktree, controller/src/transient.rs at 2a48e90), and writeInside
// refuses every other path before a byte is written.

import { CouldNotTell, Usage } from "./answer.ts";

/** How a variable of the adapter's environment is read; tests hand their own. */
export type Env = (name: string) => string | undefined;

const PROCESS: Env = (name) => Deno.env.get(name);

/** The operator's own config dir variable, and the credential scope's. */
export const CONFIG_DIR_VAR = "CLAUDE_CONFIG_DIR";

function set(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The config dir a seat's claude runs under: the request's `config_dir`, a
 * spawned seat's own; else, for a named seat, which carries none (E9), the
 * operator's own — CLAUDE_CONFIG_DIR where it is set, else $HOME/.claude
 * (config_dir_from, controller/src/adapter/claude_code.rs at 451a33d).
 */
export function configDirFor(
  seat: { config_dir?: string | null },
  env: Env = PROCESS,
): string {
  const named = set(seat.config_dir) ?? set(env(CONFIG_DIR_VAR));
  if (named !== undefined) return named;
  const home = set(env("HOME"));
  if (home === undefined) {
    throw new CouldNotTell(
      `no config dir is named: the request carries no config_dir, and neither ${CONFIG_DIR_VAR} nor HOME is set`,
    );
  }
  return `${home.replace(/\/+$/, "")}/.claude`;
}

/**
 * The credential scope every claude this adapter runs carries:
 * CLAUDE_CONFIG_DIR as the operator gave it, trimmed, and EMPTY where it is
 * not set — not the home default. Defined-but-empty restores the unsuffixed
 * name the operator's own login was stored under; a seat's own config dir
 * here is the logged-out child (credential_dir_from; lessons claude-code
 * A11).
 */
export function credentialDir(env: Env = PROCESS): string {
  return set(env(CONFIG_DIR_VAR)) ?? "";
}

/** The directories one call may write in. */
export interface Roots {
  /** The request's config_dir; a named seat has none, and so no such root. */
  configDir?: string | null;
  /** The seat's worktree. */
  worktree: string;
}

/** An absolute path's segments; `undefined` where one is empty, `.` or `..`. */
function segments(path: string): string[] | undefined {
  if (!path.startsWith("/")) return undefined;
  const parts = path.slice(1).split("/");
  if (parts.length === 1 && parts[0] === "") return [];
  return parts.every((part) => part !== "" && part !== "." && part !== "..")
    ? parts
    : undefined;
}

function missing(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    error instanceof Deno.errors.NotADirectory;
}

/**
 * Where `parts` resolves on disk: the deepest part that exists, every symlink
 * on the way to it followed, and the parts below it, which do not exist and
 * so follow nothing, appended. `undefined` where a part is a symlink to
 * nothing: where a write through it would land is not known here.
 */
async function resolved(parts: string[]): Promise<string | undefined> {
  for (let depth = parts.length; depth >= 0; depth--) {
    const head = `/${parts.slice(0, depth).join("/")}`;
    let real: string;
    try {
      real = await Deno.realPath(head);
    } catch (error) {
      if (!missing(error)) throw error;
      try {
        if ((await Deno.lstat(head)).isSymlink) return undefined;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      continue;
    }
    const tail = parts.slice(depth);
    return [real.replace(/\/$/, ""), ...tail].join("/") || "/";
  }
  return `/${parts.join("/")}`;
}

/**
 * A root as the paths under it are compared with: resolved as `resolved`
 * does, except that THE ROOT ITSELF IS NEVER FOLLOWED. A root that is a
 * symlink is refused: its writes would land wherever it points, outside the
 * directory the request named.
 */
async function rootOf(label: string, root: string): Promise<string> {
  const parts = segments(root);
  if (parts === undefined || parts.length === 0) {
    throw new Usage(
      `the request's ${label} is \`${root}\`, which is not an absolute path to a directory`,
    );
  }
  try {
    if ((await Deno.lstat(root)).isSymlink) {
      throw new CouldNotTell(
        `refusing to write under the ${label} \`${root}\`: it is a symlink, and its writes would land where it points`,
      );
    }
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const parent = await resolved(parts.slice(0, -1));
  if (parent === undefined) {
    throw new CouldNotTell(
      `refusing to write under the ${label} \`${root}\`: a directory above it is a symlink to nothing`,
    );
  }
  return `${parent.replace(/\/$/, "")}/${parts.at(-1)}`;
}

function inside(path: string, root: string): boolean {
  return path.startsWith(`${root}/`);
}

/**
 * Writes `body` to `path`, which must resolve strictly inside the request's
 * config dir or the seat's worktree, making the directories above it.
 *
 * REFUSED, could not tell, before a byte is written: a path that is not
 * absolute or carries an empty, `.` or `..` segment; one that resolves —
 * through any symlink on its way, the file itself included — outside both
 * roots; and a root that is itself a symlink. A root the request names
 * relatively is usage: fleet never sends one.
 *
 * The file is written beside itself and renamed over, so a claude reading it
 * never reads half of it, and a file already there keeps its mode.
 */
export async function writeInside(
  roots: Roots,
  path: string,
  body: string,
): Promise<void> {
  const named: [string, string][] = [["worktree", roots.worktree]];
  if (set(roots.configDir) !== undefined) {
    named.unshift(["config_dir", roots.configDir!.trim()]);
  }
  const parts = segments(path);
  const refuse = (why: string) =>
    new CouldNotTell(`refusing to write \`${path}\`: ${why}`);
  if (parts === undefined) {
    throw refuse("it is not an absolute path without `.` or `..` in it");
  }
  const target = await resolved(parts);
  if (target === undefined) {
    throw refuse("it passes through a symlink to nothing");
  }
  let within = false;
  let symlinked: CouldNotTell | undefined;
  for (const [label, root] of named) {
    let base: string;
    try {
      base = await rootOf(label, root);
    } catch (error) {
      if (error instanceof CouldNotTell) {
        symlinked = error;
        continue;
      }
      throw error;
    }
    if (inside(target, base)) within = true;
  }
  if (!within) {
    if (symlinked !== undefined) throw symlinked;
    throw refuse(
      `it resolves to \`${target}\`, outside the ${
        named.map(([label, root]) => `${label} \`${root}\``).join(" and the ")
      }`,
    );
  }
  const dir = path.slice(0, path.lastIndexOf("/")) || "/";
  await Deno.mkdir(dir, { recursive: true });
  let mode: number | undefined;
  try {
    mode = ((await Deno.stat(path)).mode ?? undefined) as number | undefined;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const temporary = `${path}.${Deno.pid}.writing`;
  await Deno.writeTextFile(temporary, body);
  try {
    if (mode !== undefined) await Deno.chmod(temporary, mode & 0o7777);
    await Deno.rename(temporary, path);
  } catch (error) {
    await Deno.remove(temporary).catch(() => undefined);
    throw error;
  }
}
