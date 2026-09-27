// What a spawned seat runs without asking, in fleet's own words, and its
// rendering into Claude Code's rules: the worktree's
// .claude/settings.local.json, which Claude Code reads once, as it comes up.
//
// MOVED HERE from tinyfleet (fleet-jymr.5; Reviewer call 2026-09-25, E8):
// the template the layers carried at overlay/per-provider/claude/
// permissions.json and the in-process render over it (render_permissions,
// without_the_touched_rule, with_tool_commands, write_settings and
// merged_settings, controller/src/adapter/claude_code.rs at tinyfleet
// dbc7908). Nothing re-decided: fixtures/permissions/ holds that render's own
// documents, and the suite holds this one's equal to them as JSON.
//
// THE NEUTRAL PART IS FLEET'S; THE RULES ARE CLAUDE CODE'S. FLEET_PERMISSIONS
// is the template stated provider-neutrally — commands allowed by prefix,
// commands refused by prefix, the worktree writable — and the request adds
// the rest in the same words (docs/agent.md, Permissions): the project's
// `[permissions] tool_commands` as `commands`, and the builder's checks as
// `touched`. Claude Code's tool names stay this adapter's format (the E11
// line): the four tools a seat is denied are DENIED_TOOLS, here and nowhere
// else.

import type { Permissions } from "../contract.d.ts";
import { CouldNotTell, Usage } from "./answer.ts";
import { writeInside } from "./config_dir.ts";

/** Fleet's permissions for every spawned seat, stated without an agent. */
export interface Neutral {
  /**
   * Commands a seat runs without asking, each one command word matched as
   * the command line's first: `git` allows `git status`.
   */
  allowed: string[];
  /**
   * Command lines refused, each matched as a prefix of the line, where `*`
   * stands for any run of characters: `git push -f ` refuses `git push -f
   * origin x`, and `git push * --delete` any push that deletes.
   */
  refused: string[];
}

/**
 * The template's lists (core/defaults/overlay/per-provider/claude/
 * permissions.json at tinyfleet dbc7908), in its order. `bd` is the store's
 * command, kept as the template kept it until fleet-x93d.2 has core hand the
 * store's own word in `commands` (fleet-3krx.2's note there).
 */
export const FLEET_PERMISSIONS: Neutral = {
  allowed: [
    "bd",
    "fleet",
    "git",
    "sh",
    "bash",
    "echo",
    "printf",
    "ls",
    "cat",
    "head",
    "tail",
    "wc",
    "grep",
    "rg",
    "sed",
    "awk",
    "cut",
    "sort",
    "uniq",
    "tr",
    "find",
    "mkdir",
    "cd",
    "pwd",
    "which",
    "command",
    "test",
    "date",
    "env",
    "dirname",
    "basename",
    "xargs",
    "diff",
    "cmp",
    "true",
    "false",
  ],
  refused: [
    "git push origin HEAD:main",
    "git push origin main",
    "git push --force",
    "git push -f ",
    "git push * --delete",
  ],
};

/**
 * Claude Code's own tools a seat is denied: a question or a plan mode waits
 * on a person no spawned seat has, and a server's access request is one.
 */
export const DENIED_TOOLS = [
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "mcp__*__request_access",
];

/** Where Claude Code reads a worktree's own rules, under the worktree. */
export const LOCAL_SETTINGS = ".claude/settings.local.json";

/** The lists a merge folds; every other key is the project's to keep. */
const MERGED_LISTS = ["allow", "deny"] as const;

/**
 * One command word: a bare name or a path relative to the repository, with
 * no space, no `*`, `?`, `[` or `]`, and no leading `-` — the rule it becomes
 * is matched by its opening token, so anything else would widen it
 * (is_command_word, cli/src/transient.rs at tinyfleet dbc7908, which core
 * checks at the call; checked here again, at the render).
 */
export function isCommandWord(word: string): boolean {
  return word !== "" && !word.startsWith("-") && !/[\s*?[\]]/.test(word);
}

const allowed = (word: string) => `Bash(${word}:*)`;
const refused = (line: string) => `Bash(${line}*)`;

/**
 * Claude Code's settings document for a seat in `worktree`, as JSON text:
 * fleet's allowed commands, the builder's checks, the worktree writable, then
 * the project's commands not already allowed, in the order given; Claude
 * Code's denied tools, then fleet's refused lines.
 *
 * A `touched` that is blank, or not there, is NO RULE: the seat's rules never
 * name a command nobody gave. A `commands` entry that is not one command word
 * is usage, naming it: the request is not the contract's.
 */
export function renderPermissions(
  permissions: Permissions,
  worktree: string,
  neutral: Neutral = FLEET_PERMISSIONS,
): string {
  for (const word of permissions.commands) {
    if (!isCommandWord(word)) {
      throw new Usage(
        `permissions.commands entry \`${word}\` is not one command word`,
      );
    }
  }
  const allow = neutral.allowed.map(allowed);
  const touched = permissions.touched?.trim() ?? "";
  if (touched !== "") allow.push(allowed(touched));
  allow.push(`Edit(/${worktree}/**)`);
  for (const word of permissions.commands) {
    const rule = allowed(word);
    if (!allow.includes(rule)) allow.push(rule);
  }
  const deny = [...DENIED_TOOLS, ...neutral.refused.map(refused)];
  return `${JSON.stringify({ permissions: { allow, deny } }, null, 2)}\n`;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The rendered rules folded into the document a project already carries:
 * the project's document is the base, its rules stand FIRST and in their own
 * order, ours are appended, and a rule it already carries is not appended
 * twice. Anything here that is not the JSON a rule can be folded into throws
 * the reason, and the caller writes nothing over it.
 */
export function mergedSettings(project: string, rendered: string): string {
  let merged: unknown;
  try {
    merged = JSON.parse(project);
  } catch (error) {
    throw new Error(`the project's document is not JSON: ${error}`);
  }
  if (!isObject(merged)) {
    throw new Error("the project's document is not a JSON object");
  }
  merged.permissions ??= {};
  const theirs = merged.permissions;
  if (!isObject(theirs)) {
    throw new Error("the project's `permissions` is not a JSON object");
  }
  const ours = (JSON.parse(rendered) as { permissions: Json }).permissions;
  for (const list of MERGED_LISTS) {
    const rules = ours[list] as string[];
    theirs[list] ??= [];
    const held = theirs[list];
    if (!Array.isArray(held)) {
      throw new Error(`the project's \`permissions.${list}\` is not an array`);
    }
    for (const rule of rules) {
      if (!held.includes(rule)) held.push(rule);
    }
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/** The settings file one launch writes, and the worktree it is written in. */
export interface Settings {
  /** The seat's worktree, resolved through a link, as a symlink is followed. */
  worktree: string;
  path: string;
  document: string;
}

/**
 * The document a launch writes to the worktree's settings file: the render,
 * merged into the file already standing there. A project tracking this file
 * on its trunk hands every worktree a copy, and writing over it would take
 * the project's own rules out of the seat and leave a tracked file modified
 * in a checkout nobody edited.
 *
 * The worktree is RESOLVED, as the in-process write followed a link to it
 * and as the trust seed keys it (lib/seed.ts): a worktree reached through a
 * link is the directory the seat's session runs in, where it reads the file.
 *
 * Read, and refused, BEFORE anything of the launch is written: a standing
 * file that cannot be read, or that is not the JSON the rules fold into, is
 * could not tell, and nothing is written over it.
 */
export async function settingsFor(
  worktree: string,
  rendered: string,
): Promise<Settings> {
  let root = worktree.replace(/\/+$/, "");
  try {
    root = await Deno.realPath(root);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const path = `${root}/${LOCAL_SETTINGS}`;
  let standing: string | undefined;
  try {
    standing = await Deno.readTextFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw new CouldNotTell(
        `the settings document at ${path} could not be read, and one that cannot be read is never written over: ${error}`,
      );
    }
  }
  if (standing === undefined) {
    return { worktree: root, path, document: rendered };
  }
  try {
    return {
      worktree: root,
      path,
      document: mergedSettings(standing, rendered),
    };
  } catch (error) {
    throw new CouldNotTell(
      `the pack's permission rules were not merged into the document at ${path}, and nothing was written over: ${
        (error as Error).message
      }`,
    );
  }
}

/**
 * Writes the document inside the worktree (writeInside refuses any path that
 * resolves outside it) and reads it back: a write that silently landed short
 * leaves a seat that can neither edit nor commit, and says so hours later.
 */
export async function writeSettings(settings: Settings): Promise<void> {
  await writeInside(
    { worktree: settings.worktree },
    settings.path,
    settings.document,
  );
  let back: string;
  try {
    back = await Deno.readTextFile(settings.path);
  } catch (error) {
    throw new CouldNotTell(
      `the permission rules at ${settings.path} do not read back: ${error}`,
    );
  }
  if (back !== settings.document) {
    throw new CouldNotTell(
      `the permission rules at ${settings.path} do not read back as they were written`,
    );
  }
}
