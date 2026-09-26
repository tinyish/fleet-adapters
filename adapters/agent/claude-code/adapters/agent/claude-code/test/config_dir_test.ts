// lib/config_dir.ts: which config dir a seat's claude runs under, the
// credential scope beside it, and the one helper every write goes through,
// which refuses a path resolving outside the request's config dir and
// worktree (Reviewer call 2026-09-25, E8).

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { CouldNotTell, Usage } from "../lib/answer.ts";
import { configDirFor, credentialDir, writeInside } from "../lib/config_dir.ts";

/** An environment of exactly these variables. */
function env(vars: Record<string, string>) {
  return (name: string) => vars[name];
}

Deno.test("configDirFor: the request's config_dir, trimmed, is the seat's", () => {
  assertEquals(
    configDirFor(
      { config_dir: " /seats/b/agent " },
      env({ CLAUDE_CONFIG_DIR: "/op", HOME: "/home/op" }),
    ),
    "/seats/b/agent",
  );
});

/**
 * A named seat carries no config_dir (E9): it runs under the operator's own
 * configuration — CLAUDE_CONFIG_DIR where that is set, else ~/.claude
 * (config_dir_from, controller/src/adapter/claude_code.rs at 451a33d).
 */
Deno.test("configDirFor: a named seat runs under CLAUDE_CONFIG_DIR, else ~/.claude", () => {
  const operator = env({ CLAUDE_CONFIG_DIR: " /op/claude ", HOME: "/home/op" });
  assertEquals(configDirFor({}, operator), "/op/claude");
  assertEquals(configDirFor({ config_dir: null }, operator), "/op/claude");
  assertEquals(configDirFor({ config_dir: "  " }, operator), "/op/claude");
  assertEquals(
    configDirFor({}, env({ CLAUDE_CONFIG_DIR: "", HOME: "/home/op" })),
    "/home/op/.claude",
  );
  assertEquals(configDirFor({}, env({ HOME: "/home/op" })), "/home/op/.claude");
  const error = assertThrows(() => configDirFor({}, env({})), CouldNotTell);
  assertStringIncludes(error.message, "HOME");
});

/**
 * The credential scope is CLAUDE_CONFIG_DIR as the operator gave it, and
 * empty where it is not set: defined-but-empty is the operator's own login,
 * never the home default (credential_dir_from; lessons claude-code A11).
 */
Deno.test("credentialDir: CLAUDE_CONFIG_DIR trimmed, or empty", () => {
  assertEquals(credentialDir(env({ CLAUDE_CONFIG_DIR: " /op/c " })), "/op/c");
  assertEquals(credentialDir(env({ CLAUDE_CONFIG_DIR: "  " })), "");
  assertEquals(credentialDir(env({ HOME: "/home/op" })), "");
});

/** A scratch config dir and worktree side by side, and a place outside both. */
async function scratch() {
  const top = await Deno.makeTempDir();
  const configDir = `${top}/seat/agent`;
  const worktree = `${top}/lane`;
  const outside = `${top}/outside`;
  for (const dir of [configDir, worktree, outside]) {
    await Deno.mkdir(dir, { recursive: true });
  }
  return {
    top,
    configDir,
    worktree,
    outside,
    [Symbol.asyncDispose]: () => Deno.remove(top, { recursive: true }),
  };
}

Deno.test("writeInside: writes inside either root, making the directories", async () => {
  await using s = await scratch();
  const roots = { configDir: s.configDir, worktree: s.worktree };
  await writeInside(roots, `${s.configDir}/.claude.json`, "{}\n");
  await writeInside(roots, `${s.worktree}/.claude/settings.local.json`, "[]");
  assertEquals(await Deno.readTextFile(`${s.configDir}/.claude.json`), "{}\n");
  assertEquals(
    await Deno.readTextFile(`${s.worktree}/.claude/settings.local.json`),
    "[]",
  );
  await writeInside(roots, `${s.configDir}/.claude.json`, '{"a":1}');
  assertEquals(
    await Deno.readTextFile(`${s.configDir}/.claude.json`),
    '{"a":1}',
  );
});

/** A file already there keeps its mode across the write that replaces it. */
Deno.test("writeInside: a replaced file keeps its mode", async () => {
  await using s = await scratch();
  const path = `${s.configDir}/.claude.json`;
  await Deno.writeTextFile(path, "{}");
  await Deno.chmod(path, 0o600);
  await writeInside(
    { configDir: s.configDir, worktree: s.worktree },
    path,
    "{}",
  );
  assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
});

Deno.test("writeInside: a path outside both roots is refused, and nothing is written", async () => {
  await using s = await scratch();
  const roots = { configDir: s.configDir, worktree: s.worktree };
  for (
    const path of [
      "../x",
      "x",
      `${s.worktree}/../x`,
      `${s.worktree}/./x`,
      `${s.outside}/x`,
      `${s.top}/seat/x`,
      s.worktree,
      s.configDir,
      "/",
    ]
  ) {
    const error = await assertRejects(
      () => writeInside(roots, path, "body"),
      CouldNotTell,
    );
    assertStringIncludes(error.message, `refusing to write \`${path}\``);
  }
  assertEquals([...Deno.readDirSync(s.outside)], []);
  assertEquals([...Deno.readDirSync(s.top)].map((e) => e.name).sort(), [
    "lane",
    "outside",
    "seat",
  ]);
});

/** A symlink inside a root that points out of it takes nothing through it. */
Deno.test("writeInside: a path through a symlink out of a root is refused", async () => {
  await using s = await scratch();
  const roots = { configDir: s.configDir, worktree: s.worktree };
  await Deno.symlink(s.outside, `${s.worktree}/escape`);
  await Deno.symlink(`${s.outside}/file`, `${s.configDir}/.claude.json`);
  const kept = `${s.top}/seat/kept.json`;
  await Deno.writeTextFile(kept, "kept");
  await Deno.symlink(kept, `${s.worktree}/settings.json`);
  for (
    const path of [
      `${s.worktree}/escape/x`,
      `${s.configDir}/.claude.json`,
      `${s.worktree}/settings.json`,
    ]
  ) {
    await assertRejects(() => writeInside(roots, path, "body"), CouldNotTell);
  }
  assertEquals([...Deno.readDirSync(s.outside)], []);
  assertEquals(await Deno.readTextFile(kept), "kept");
});

/** A config dir that is itself a symlink out of itself is no root at all. */
Deno.test("writeInside: a config dir that is a symlink is refused", async () => {
  await using s = await scratch();
  const linked = `${s.top}/seat/linked`;
  await Deno.symlink(s.outside, linked);
  const error = await assertRejects(
    () =>
      writeInside(
        { configDir: linked, worktree: s.worktree },
        `${linked}/.claude.json`,
        "{}",
      ),
    CouldNotTell,
  );
  assertStringIncludes(error.message, "is a symlink");
  assertEquals([...Deno.readDirSync(s.outside)], []);
});

/** A named seat has no config dir: only its worktree takes a write. */
Deno.test("writeInside: with no config dir, the worktree alone is a root", async () => {
  await using s = await scratch();
  await assertRejects(
    () =>
      writeInside(
        { configDir: null, worktree: s.worktree },
        `${s.configDir}/.claude.json`,
        "{}",
      ),
    CouldNotTell,
  );
  await writeInside({ worktree: s.worktree }, `${s.worktree}/f`, "x");
});

/** A root the request names relatively is a request fleet never sends: usage. */
Deno.test("writeInside: a relative root is usage", async () => {
  await using s = await scratch();
  for (
    const roots of [
      { configDir: "seat/agent", worktree: s.worktree },
      { configDir: s.configDir, worktree: "lane" },
    ]
  ) {
    await assertRejects(
      () => writeInside(roots, `${s.worktree}/f`, "x"),
      Usage,
      "which is not an absolute path",
    );
  }
});
