// The verbs about the store itself: export, the one file a landing commits,
// and scratch, a new empty store for a suite — ported from tinyfleet's
// in-process adapter (core/src/store/bd/mod.rs at e416304, `export` and
// `scratch`), measured on bd 1.3.0. Both are declared in verbs/reads.ts's
// DECLARED, which names the export's file once for both.

import { CouldNotTell, type Handlers } from "../lib/answer.ts";
import type { Bd } from "../lib/bd.ts";
import { CONFIG, DECLARED } from "./reads.ts";

/** The prefix a scratch store's ids carry: `fx-a1b2`. */
export const SCRATCH_PREFIX = "fx";

/** How a scratch store is made: in `into`, never under `-C`. */
export const INIT = ["init", "--prefix", SCRATCH_PREFIX, "--quiet"];

/**
 * `path` as an absolute one, with `.` and `..` read out: itself where it is
 * absolute, else under `root`. A request's directory is resolved against its
 * root and never against this process's working directory, which fleet never
 * relies on.
 */
export function under(root: string, path: string): string {
  const joined = path.startsWith("/") ? path : `${root}/${path}`;
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/**
 * The config with the prefix named in it: the commented `# issue-prefix:`
 * line `bd init --prefix` leaves (measured on 1.3.0) replaced by the named
 * one, or the named one added where the config carries none.
 */
export function prefixed(config: string, prefix: string): string {
  const named = `issue-prefix: "${prefix}"`;
  const lines = config.split("\n");
  const at = lines.findIndex((line) => /^\s*#?\s*issue-prefix:/.test(line));
  if (at >= 0) {
    lines[at] = named;
    return lines.join("\n");
  }
  return `${config}${
    config === "" || config.endsWith("\n") ? "" : "\n"
  }${named}\n`;
}

/** What the filesystem calls these verbs make, so a suite can stand in for it. */
export interface Disk {
  mkdir(path: string): Promise<void>;
  entries(path: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export const DISK: Disk = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  async entries(path) {
    const names: string[] = [];
    for await (const entry of Deno.readDir(path)) names.push(entry.name);
    return names;
  },
  read: (path) => Deno.readTextFile(path),
  write: (path, text) => Deno.writeTextFile(path, text),
};

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** export and scratch over the store at a request's root. */
export function store(
  open: (root: string) => Bd,
  disk: Disk = DISK,
): Handlers {
  return {
    /**
     * `bd export -o <file>`, the file the declared one under `into`, and
     * ABSOLUTE: `-o` is resolved against the CALLER's working directory and
     * not against `-C` — measured on 1.3.0, `bd -C <root> export -o
     * .beads/issues.jsonl` run from elsewhere wrote under the caller, or
     * failed there where no `.beads` stood. THE DIRECTORY IS MADE FIRST: bd
     * writes the export through a temp file beside it and makes no directory
     * of its own (measured: `atomicfile: create temp: … no such file or
     * directory`, exit 1). It regenerates that one file and touches nothing
     * else under `.beads`.
     */
    async export({ root, into }) {
      const file = under(under(root, into), DECLARED.export.file);
      const dir = file.slice(0, file.lastIndexOf("/"));
      try {
        await disk.mkdir(dir);
      } catch (error) {
        throw new CouldNotTell(
          `the export's directory ${dir} could not be made: ${why(error)}`,
        );
      }
      await open(root).answered(["export", "-o", file]);
      return { file };
    },

    /**
     * `bd init --prefix fx --quiet` run IN `into` and never under `-C`,
     * which bd 1.3.0 refuses on a directory holding no store. NO SERVER
     * FLAG, so the store is bd's embedded engine under `into/.beads` and
     * never a port another board is served on.
     *
     * `into` HAS TO BE THERE AND EMPTY — the directory fleet made for it —
     * and anything else is could not tell with nothing made: bd writes its
     * agent integrations beside the store even under `--quiet` (measured on
     * 1.3.0: a CLAUDE.md, an AGENTS.md, `.agents`, `.claude`, `.codex`,
     * `.cursor`, a `.gitignore` and a repository of its own), which are left
     * as they are, and a directory holding anything else would have them
     * written over it.
     *
     * THE PREFIX IS WRITTEN INTO THE CONFIG after: `bd init --prefix` leaves
     * `issue-prefix:` commented (measured on 1.3.0), so the new store's
     * capabilities would name no prefix its ids carry.
     */
    async scratch({ root, into }) {
      const at = under(root, into);
      let held: string[];
      try {
        held = await disk.entries(at);
      } catch (error) {
        throw new CouldNotTell(
          `the scratch directory ${at} could not be read: ${
            why(error)
          } — it is an empty directory the caller made, and no scratch store was made`,
        );
      }
      if (held.length > 0) {
        throw new CouldNotTell(
          `the scratch directory ${at} holds ${
            held.toSorted().join(", ")
          } — it is an empty directory the caller made, and no scratch store was made`,
        );
      }
      await open(root).answered(INIT, { scoped: false, cwd: at });
      const config = `${at}/${CONFIG}`;
      try {
        await disk.write(
          config,
          prefixed(await disk.read(config), SCRATCH_PREFIX),
        );
      } catch (error) {
        throw new CouldNotTell(
          `the scratch store's config ${config} could not name its prefix: ${
            why(error)
          }`,
        );
      }
      return { root: at };
    },
  };
}
