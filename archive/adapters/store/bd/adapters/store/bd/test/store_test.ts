// export and scratch over a bd that answers what bd 1.3.0 answered, and a
// disk held in memory: the argv each sends, the directory each call is made
// in, and what each writes.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { CouldNotTell, type Handler } from "../lib/answer.ts";
import { Bd, type Ran } from "../lib/bd.ts";
import { itemPrefixIn } from "../lib/rows.ts";
import { DECLARED } from "../verbs/reads.ts";
import { type Disk, INIT, prefixed, store, under } from "../verbs/store.ts";
import { assertAnswers, fake } from "./helpers.ts";

const ROOT = "/work/project";
const ENVELOPE_ON = { schema_version: 1 as const, root: ROOT };

/**
 * The config `bd init --prefix fx --quiet` leaves, measured on 1.3.0, cut to
 * the lines about the prefix: the key is there only commented.
 */
const INIT_CONFIG = `# Beads Configuration File
# All settings can also be set via environment variables (BD_* prefix)

# Issue prefix for this repository (used by bd init)
# If not set, bd init will auto-detect from directory name
# Example: issue-prefix: "myproject" creates issues like "myproject-1", "myproject-2", etc.
# issue-prefix: ""

# Use no-db mode: JSONL-only, no Dolt database
# no-db: false
`;

/** A disk in memory: each directory its entries, each file its text. */
function memory(dirs: Record<string, string[]> = {}) {
  const made: string[] = [];
  const files: Record<string, string> = {};
  const disk: Disk = {
    mkdir(path) {
      made.push(path);
      return Promise.resolve();
    },
    entries(path) {
      return path in dirs
        ? Promise.resolve(dirs[path])
        : Promise.reject(new Deno.errors.NotFound(`no such directory ${path}`));
    },
    read(path) {
      return path in files
        ? Promise.resolve(files[path])
        : Promise.reject(new Deno.errors.NotFound(path));
    },
    write(path, text) {
      files[path] = text;
      return Promise.resolve();
    },
  };
  return { disk, made, files };
}

function over(
  answers: (args: string[]) => Partial<Ran>,
  disk: Disk = memory().disk,
) {
  const { runner, calls } = fake(answers);
  const verbs = store((root) => new Bd(root, "bd", runner), disk);
  // deno-lint-ignore no-explicit-any
  const verb = (name: string) => verbs[name as "export"] as Handler<any>;
  return { verb, calls };
}

Deno.test("a path is resolved against the root and read out of its dots", () => {
  assertEquals(under(ROOT, "/elsewhere/lane"), "/elsewhere/lane");
  assertEquals(under(ROOT, "lane"), `${ROOT}/lane`);
  assertEquals(under(ROOT, "./a/../b/"), `${ROOT}/b`);
  assertEquals(under(ROOT, "."), ROOT);
  assertEquals(under("/", "../x"), "/x");
});

/**
 * `-o` IS HANDED AN ABSOLUTE PATH: bd resolves it against the caller's
 * working directory and not against `-C` (measured on 1.3.0). The directory
 * is made first, as bd makes none; and an `into` that is not absolute is
 * resolved against the root, never this process's directory.
 */
Deno.test("export writes the declared file under into, by an absolute -o, its directory made first", async () => {
  for (
    const [into, file] of [
      ["/work/lane", "/work/lane/.beads/issues.jsonl"],
      ["lane", `${ROOT}/lane/.beads/issues.jsonl`],
      [".", `${ROOT}/.beads/issues.jsonl`],
    ]
  ) {
    const disk = memory();
    const { verb, calls } = over(
      () => ({ stdout: `Exported 3 issues to ${file}\n` }),
      disk.disk,
    );
    const answer = await verb("export")({ ...ENVELOPE_ON, into });
    assertEquals(answer, { file });
    assertAnswers("export", answer);
    assertEquals(calls.map((call) => call.args), [
      ["-C", ROOT, "export", "-o", file],
    ]);
    assert(calls[0].args[4].startsWith("/"), "-o is absolute");
    assertEquals(disk.made, [file.slice(0, file.lastIndexOf("/"))]);
    assertEquals(file.endsWith(DECLARED.export.file), true);
  }
});

Deno.test("an export bd did not write is could not tell", async () => {
  const { verb } = over(() => ({
    code: 1,
    stderr:
      "Error: failed to create output file: atomicfile: create temp: open /x/.beads/.~issues.jsonl.1: no such file or directory\n",
  }));
  await assertRejects(
    () => verb("export")({ ...ENVELOPE_ON, into: "/x" }),
    CouldNotTell,
    "no such file or directory",
  );
});

/**
 * `bd init` IN `into`, never under `-C` (which bd refuses where no store is
 * yet), and THE PREFIX WRITTEN after, which `bd init --prefix` leaves
 * commented.
 */
Deno.test("scratch makes the store in into, then names its prefix in the config", async () => {
  const into = "/tmp/fleet-check/store";
  const disk = memory({ [into]: [] });
  const config = `${into}/.beads/config.yaml`;
  const { verb, calls } = over((args) => {
    if (args[0] === "init") disk.files[config] = INIT_CONFIG;
    return { stdout: "✓ Claude Code integration installed\n" };
  }, disk.disk);
  const answer = await verb("scratch")({ ...ENVELOPE_ON, into });
  assertEquals(answer, { root: into });
  assertAnswers("scratch", answer);
  assertEquals(calls.map((call) => [call.args, call.cwd]), [[INIT, into]]);
  assertEquals(INIT, ["init", "--prefix", "fx", "--quiet"]);
  assertEquals(itemPrefixIn(INIT_CONFIG), null, "bd init leaves it commented");
  assertEquals(itemPrefixIn(disk.files[config]), "fx");
  assertEquals(
    disk.files[config].split("\n").length,
    INIT_CONFIG.split("\n").length,
    "the commented line is replaced, and no other moved",
  );
});

Deno.test("the prefix replaces the commented key, or is added where none is", () => {
  assertEquals(
    prefixed('a: 1\n# issue-prefix: ""\nb: 2\n', "fx"),
    'a: 1\nissue-prefix: "fx"\nb: 2\n',
  );
  assertEquals(prefixed("a: 1", "fx"), 'a: 1\nissue-prefix: "fx"\n');
  assertEquals(prefixed("", "fx"), 'issue-prefix: "fx"\n');
  assertEquals(
    prefixed('# Example: issue-prefix: "x"\n', "fx"),
    '# Example: issue-prefix: "x"\nissue-prefix: "fx"\n',
  );
});

/**
 * `into` HAS TO BE THERE AND EMPTY, and anything else is could not tell with
 * no bd run: bd init writes its agent files beside the store, over whatever
 * the directory holds.
 */
Deno.test("scratch into a directory that is not there or not empty makes nothing", async () => {
  const held = over(() => ({}), memory({ "/tmp/full": ["CLAUDE.md"] }).disk);
  await assertRejects(
    () => held.verb("scratch")({ ...ENVELOPE_ON, into: "/tmp/full" }),
    CouldNotTell,
    "holds CLAUDE.md",
  );
  assertEquals(held.calls, []);
  const absent = over(() => ({}), memory().disk);
  await assertRejects(
    () => absent.verb("scratch")({ ...ENVELOPE_ON, into: "/tmp/none" }),
    CouldNotTell,
    "no scratch store was made",
  );
  assertEquals(absent.calls, []);
});

Deno.test("a bd init that fails is could not tell", async () => {
  const { verb } = over(
    () => ({ code: 1, stderr: "Error: something went wrong\n" }),
    memory({ "/tmp/s": [] }).disk,
  );
  await assertRejects(
    () => verb("scratch")({ ...ENVELOPE_ON, into: "/tmp/s" }),
    CouldNotTell,
    "`bd init --prefix fx --quiet` exited 1",
  );
});
