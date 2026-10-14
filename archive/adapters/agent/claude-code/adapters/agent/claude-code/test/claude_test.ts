// lib/claude.ts: which claude a call runs, and one bounded run of it under
// the seat's config dir and the operator's credential scope. The claude here
// is a shell script in a temporary directory, never Claude Code itself.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { CouldNotTell } from "../lib/answer.ts";
import { CLAUDE, claudeBin, run, sessionEnv } from "../lib/claude.ts";

/** An executable script at `<dir>/<name>` holding `body` after its shebang. */
async function script(dir: string, name: string, body: string) {
  const path = `${dir}/${name}`;
  await Deno.writeTextFile(path, `#!/bin/sh\n${body}\n`);
  await Deno.chmod(path, 0o755);
  return path;
}

Deno.test("claudeBin: unset or blank is claude on PATH", () => {
  assertEquals(claudeBin(undefined), CLAUDE);
  assertEquals(claudeBin(""), "claude");
  assertEquals(claudeBin("   "), "claude");
});

Deno.test("claudeBin: an absolute path to an executable is the one run", () => {
  assertEquals(
    claudeBin("/opt/claude/bin/claude", () => true),
    "/opt/claude/bin/claude",
  );
  assertEquals(claudeBin(" /opt/claude ", () => true), "/opt/claude");
});

/**
 * A seam naming a relative path is refused, naming it, and claude on PATH is
 * never tried in its place: a caller that named a claude meant that one
 * (resolve_effect_bin's rule, controller/src/adapter/claude_code.rs at
 * tinyfleet 451a33d).
 */
Deno.test("claudeBin: a relative FLEET_CLAUDE_BIN is refused, naming it", () => {
  for (const relative of ["claude", "bin/claude", "./claude", "../claude"]) {
    const error = assertThrows(
      () => claudeBin(relative, () => true),
      CouldNotTell,
    );
    assertEquals(
      error.message,
      `the agent binary seam FLEET_CLAUDE_BIN names \`${relative}\`, which is not an absolute path`,
    );
  }
});

Deno.test("claudeBin: an absolute path that is no executable file is refused", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const plain = `${dir}/claude`;
    await Deno.writeTextFile(plain, "not a program");
    for (const path of [plain, dir, `${dir}/nothing`]) {
      const error = assertThrows(() => claudeBin(path), CouldNotTell);
      assertEquals(
        error.message,
        `the agent binary seam FLEET_CLAUDE_BIN names \`${path}\`, which is not an executable file`,
      );
    }
    const program = await script(dir, "real", "true");
    assertEquals(claudeBin(program), program);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * The child runs under the seat's config dir, and the credential variable is
 * DEFINED EVEN WHEN EMPTY: unset, Claude Code looks its login up under a
 * name suffixed by the config dir, which is the logged-out child (lessons
 * claude-code A11).
 */
Deno.test("run: the child carries the config dir and the credential scope, empty included", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const claude = await script(
      dir,
      "claude",
      [
        'printf "%s|" "$@"',
        'printf "config=%s|" "$CLAUDE_CONFIG_DIR"',
        'printf "cred=%s:%s" "${CLAUDE_SECURESTORAGE_CONFIG_DIR+set}" "$CLAUDE_SECURESTORAGE_CONFIG_DIR"',
        'echo "said" >&2',
        "exit 4",
      ].join("\n"),
    );
    const empty = await run(
      [claude, "--version", "two words"],
      { configDir: "/seats/a/agent", credentialDir: "" },
      5_000,
    );
    assertEquals(empty, {
      code: 4,
      stdout: "--version|two words|config=/seats/a/agent|cred=set:",
      stderr: "said\n",
    });
    const named = await run(
      [claude],
      { configDir: "/c", credentialDir: "/home/op/.claude-work" },
      5_000,
    );
    assertEquals(named.stdout, "|config=/c|cred=set:/home/op/.claude-work");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * Every child the pack runs carries the auto-updater off, whatever fleet's
 * environment says: an interactive 2.1.280 installed a newer release and
 * re-pointed the operator's claude during fleet-rge6.2's measurement (the
 * INCIDENT on fleet-rge6), and the pack's reads are children too
 * (fleet-jymr.1's reviewer call).
 */
Deno.test("run: the child carries DISABLE_AUTOUPDATER=1, over fleet's own", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const claude = await script(
      dir,
      "claude",
      'printf "%s:%s" "${DISABLE_AUTOUPDATER+set}" "$DISABLE_AUTOUPDATER"',
    );
    const ran = await run(
      [claude],
      { configDir: "/c", credentialDir: "" },
      5_000,
    );
    assertEquals(ran.stdout, "set:1");
    assertEquals(
      sessionEnv({ configDir: "/c", credentialDir: "" }),
      {
        CLAUDE_CONFIG_DIR: "/c",
        CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
        DISABLE_AUTOUPDATER: "1",
      },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** The rest of the environment is fleet's, inherited: PATH and HOME reach it. */
Deno.test("run: the child inherits the adapter's own environment", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const claude = await script(dir, "claude", 'printf "%s" "$HOME"');
    const ran = await run(
      [claude],
      { configDir: "/c", credentialDir: "" },
      5_000,
    );
    assertEquals(ran.stdout, Deno.env.get("HOME") ?? "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A claude that cannot be run is could not tell, naming it: exit 3. */
Deno.test("run: a claude that cannot be run is could not tell", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const missing = `${dir}/no-claude-here`;
    const error = await assertRejects(
      () =>
        run(
          [missing, "--version"],
          { configDir: "/c", credentialDir: "" },
          5_000,
        ),
      CouldNotTell,
    );
    assertStringIncludes(error.message, `\`${missing}\` cannot be run`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * A claude that outruns the bound is killed and could not tell, naming the
 * command and the bound, well inside fleet's own 20 s for the whole call.
 */
Deno.test("run: a claude that outruns the bound is killed, could not tell", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const claude = await script(dir, "claude", "exec sleep 30");
    const started = Date.now();
    const error = await assertRejects(
      () =>
        run([claude, "agents"], { configDir: "/c", credentialDir: "" }, 200),
      CouldNotTell,
    );
    assert(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
    assertEquals(
      error.message,
      `\`${claude} agents\` did not answer within 200 ms, and was killed`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A claude a signal ended answers no code: the caller reads that as it will. */
Deno.test("run: a claude a signal ended has no exit code", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const claude = await script(dir, "claude", "kill -9 $$");
    const ran = await run(
      [claude],
      { configDir: "/c", credentialDir: "" },
      5_000,
    );
    assertEquals(ran.code, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
