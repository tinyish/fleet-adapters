// The pack's two doctor checks, doctor/claude-code-version/run.sh and
// doctor/isolation-pair/run.sh (moved from tinyfleet's core/defaults/doctor at
// 807107b, as fleet-rsia.5 moved bd-version): the version check's pin is the
// adapter's measured, and both read what they say they read, on a claude
// that answers from a script — so these run on a box with no Claude Code.
// They replace tinyfleet's core/tests/pack.rs claude-code arm.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CAPABILITIES, PINNED } from "../lib/capabilities.ts";

const DOCTOR = new URL("../../../../doctor/", import.meta.url).pathname;
const VERSION = `${DOCTOR}claude-code-version/run.sh`;
const PAIR = `${DOCTOR}isolation-pair/run.sh`;

interface Read {
  code: number;
  lines: string[];
}

/** A check run as fleet doctor runs it: `sh run.sh`, with `env` alone. */
async function checked(
  check: string,
  env: Record<string, string>,
): Promise<Read> {
  const out = await new Deno.Command("/bin/sh", {
    args: [check],
    clearEnv: true,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    lines: new TextDecoder().decode(out.stdout).trim().split("\n"),
  };
}

/** A claude in a directory of its own whose script is `body`. */
async function aClaude(body: string): Promise<{ bin: string; dir: string }> {
  const dir = await Deno.makeTempDir({ prefix: "claude-doctor-" });
  const bin = `${dir}/claude`;
  await Deno.writeTextFile(bin, `#!/bin/sh\n${body}\n`);
  await Deno.chmod(bin, 0o755);
  return { bin, dir };
}

/** A claude answering `--version` with `said`, only with the updater off. */
function says(said: string): Promise<{ bin: string; dir: string }> {
  return aClaude(
    [
      '[ "$1" = --version ] || exit 9',
      '[ "$DISABLE_AUTOUPDATER" = 1 ] || exit 8',
      `echo "${said}"`,
    ].join("\n"),
  );
}

// ---- claude-code-version -----------------------------------------------------

Deno.test("claude-code-version: SUPPORTED is the adapter's measured, whose last entry is the pin", async () => {
  const text = await Deno.readTextFile(VERSION);
  const pins = text.split("\n").filter((line) => line.startsWith("SUPPORTED="));
  assertEquals(pins, [`SUPPORTED=${CAPABILITIES.measured.at(-1)}`]);
  assertEquals(CAPABILITIES.measured.at(-1), PINNED);
});

Deno.test("claude-code-version: the pinned claude on PATH holds", async () => {
  const { dir } = await says(`${PINNED} (Claude Code)`);
  const read = await checked(VERSION, { PATH: dir });
  assertEquals(read.code, 0, read.lines.join("\n"));
  assertEquals(read.lines, [
    `claude-code-version: supported Claude Code ${PINNED}; \`claude --version\` answers: ${PINNED} (Claude Code)`,
    "claude-code-version: holds",
  ]);
});

Deno.test("claude-code-version: another release is broken, with the line that installs the pin", async () => {
  const { dir } = await says("2.1.261 (Claude Code)");
  const read = await checked(VERSION, { PATH: dir });
  assertEquals(read.code, 1);
  const said = read.lines.join("\n");
  assertStringIncludes(said, "answers: 2.1.261 (Claude Code)");
  assertStringIncludes(said, `is not the supported ${PINNED}`);
  assertStringIncludes(said, "the controller still runs");
  assertStringIncludes(said, `claude install ${PINNED}`);
});

Deno.test("claude-code-version: a substring of the pin is not a match; the v form is", async () => {
  const { dir: longer } = await says(`1${PINNED}0 (Claude Code)`);
  assertEquals((await checked(VERSION, { PATH: longer })).code, 1);
  const { dir: vee } = await says(`v${PINNED}`);
  assertEquals((await checked(VERSION, { PATH: vee })).code, 0);
});

Deno.test("claude-code-version: no claude is broken, exit 127, with the fresh install line", async () => {
  const read = await checked(VERSION, { PATH: "/nonexistent" });
  assertEquals(read.code, 1);
  const said = read.lines.join("\n");
  assertStringIncludes(said, "did not answer (exit 127)");
  assertStringIncludes(
    said,
    `curl -fsSL https://claude.ai/install.sh | bash -s ${PINNED}`,
  );
});

Deno.test("claude-code-version: the seam names the claude over PATH's", async () => {
  const { dir: other } = await says("2.1.261 (Claude Code)");
  const { bin: pinned } = await says(`${PINNED} (Claude Code)`);
  const read = await checked(VERSION, {
    PATH: other,
    FLEET_CLAUDE_BIN: pinned,
  });
  assertEquals(read.code, 0, read.lines.join("\n"));
  assertEquals(read.lines.at(-1), "claude-code-version: holds");
});

/** The adapter refuses a seam that is not absolute, and so does its check. */
Deno.test("claude-code-version: a seam that is not an absolute path is broken", async () => {
  const { dir } = await says(`${PINNED} (Claude Code)`);
  const read = await checked(VERSION, {
    PATH: dir,
    FLEET_CLAUDE_BIN: "claude",
  });
  assertEquals(read.code, 1);
  assertStringIncludes(
    read.lines.join("\n"),
    "FLEET_CLAUDE_BIN names `claude`, which is not an absolute path",
  );
});

// ---- isolation-pair ----------------------------------------------------------

/**
 * A claude whose `auth status` answers logged in by `rule`, a shell test over
 * the credential variable, and only with the auto-updater off.
 */
function authBy(rule: string): Promise<{ bin: string; dir: string }> {
  return aClaude(
    [
      '[ "$1 $2" = "auth status" ] || exit 9',
      '[ "$DISABLE_AUTOUPDATER" = 1 ] || exit 8',
      '[ -n "$CLAUDE_CONFIG_DIR" ] || exit 7',
      `if ${rule}; then echo '{"loggedIn": true}'; exit 0; fi`,
      `echo '{"loggedIn": false}'`,
      "exit 1",
    ].join("\n"),
  );
}

/** What the pair measures: the knob defined (even empty) logs a scratch dir in. */
const DEFINED = '[ "${CLAUDE_SECURESTORAGE_CONFIG_DIR+set}" = set ]';

/** The check's scratch lives under TMPDIR, and is gone after every run. */
async function paired(
  env: Record<string, string>,
): Promise<Read & { left: string[] }> {
  const tmp = await Deno.makeTempDir({ prefix: "pair-tmp-" });
  const read = await checked(PAIR, {
    PATH: "/usr/bin:/bin",
    TMPDIR: tmp,
    ...env,
  });
  return { ...read, left: [...Deno.readDirSync(tmp)].map((e) => e.name) };
}

Deno.test("isolation-pair: the knob logging the pair in, and its absence not, holds", async () => {
  const { bin } = await authBy(DEFINED);
  const read = await paired({ FLEET_CLAUDE_BIN: bin });
  assertEquals(read.code, 0, read.lines.join("\n"));
  assertEquals(read.lines.at(-1), "isolation-pair: holds");
  assertEquals(read.left, [], "the scratch is removed");
});

/**
 * The control arm UNSETS the knob, so a doctor run inside a seat — whose
 * environment carries it, as every seat's does — still measures the pair.
 */
Deno.test("isolation-pair: a knob fleet's own environment carries does not reach the control", async () => {
  const { bin } = await authBy(DEFINED);
  const read = await paired({
    FLEET_CLAUDE_BIN: bin,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
  });
  assertEquals(read.code, 0, read.lines.join("\n"));
});

Deno.test("isolation-pair: a pair that is logged out is broken, naming the pair arm", async () => {
  const { bin } = await authBy("false");
  const read = await paired({ FLEET_CLAUDE_BIN: bin });
  assertEquals(read.code, 1);
  assertStringIncludes(
    read.lines.join("\n"),
    "the PAIR arm did not answer logged in",
  );
  assertEquals(read.lines.at(-1), "isolation-pair: broken");
  assertEquals(read.left, []);
});

Deno.test("isolation-pair: a control that is logged in anyway is broken, naming the control arm", async () => {
  const { bin } = await authBy("true");
  const read = await paired({ FLEET_CLAUDE_BIN: bin });
  assertEquals(read.code, 1);
  assertStringIncludes(
    read.lines.join("\n"),
    "the CONTROL arm did not answer logged out",
  );
});

Deno.test("isolation-pair: with no seam, the claude on PATH is asked", async () => {
  const { dir } = await authBy(DEFINED);
  const read = await paired({ PATH: `${dir}:/usr/bin:/bin` });
  assertEquals(read.code, 0, read.lines.join("\n"));
});

Deno.test("isolation-pair: no claude, or a seam that is not absolute, is broken", async () => {
  const absent = await paired({ PATH: "/usr/bin:/bin" });
  assertEquals(absent.code, 1);
  assert(absent.lines.some((line) => line.includes("the pair    — exit 127")));
  const { dir } = await authBy(DEFINED);
  const relative = await paired({
    PATH: `${dir}:/usr/bin:/bin`,
    FLEET_CLAUDE_BIN: "claude",
  });
  assertEquals(relative.code, 1);
  assertStringIncludes(
    relative.lines.join("\n"),
    "FLEET_CLAUDE_BIN names `claude`, which is not an absolute path",
  );
});
