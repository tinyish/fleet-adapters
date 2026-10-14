// lib/seed.ts: a seat's config dir seeded so its interactive session meets no
// onboarding and no workspace-trust question (lessons claude-code D8, A15;
// fleet-rge6.2's rules, ruling 13). The operator's .claude.json here is a
// file this test writes, never a person's.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { CouldNotTell, Usage } from "../lib/answer.ts";
import {
  ONBOARDING_KEYS,
  operatorFile,
  SEED_MODE,
  seedOnboarding,
  seedTrust,
  STATE_FILE,
} from "../lib/seed.ts";
import { OPERATOR } from "./helpers.ts";

/** An environment of exactly these variables. */
function env(vars: Record<string, string>) {
  return (name: string) => vars[name];
}

async function scratch(operator: Record<string, unknown> | undefined) {
  const top = await Deno.realPath(await Deno.makeTempDir());
  const home = `${top}/home`;
  const configDir = `${top}/seat/agent`;
  const worktree = `${top}/lane`;
  for (const dir of [home, configDir, worktree]) {
    await Deno.mkdir(dir, { recursive: true });
  }
  if (operator !== undefined) {
    await Deno.writeTextFile(
      `${home}/${STATE_FILE}`,
      JSON.stringify(operator),
    );
  }
  return {
    top,
    home,
    configDir,
    worktree,
    env: env({ HOME: home }),
    seeded: async () =>
      JSON.parse(await Deno.readTextFile(`${configDir}/${STATE_FILE}`)),
    [Symbol.asyncDispose]: () => Deno.remove(top, { recursive: true }),
  };
}

Deno.test("operatorFile: CLAUDE_CONFIG_DIR's .claude.json, else the home's", () => {
  assertEquals(
    operatorFile(env({ CLAUDE_CONFIG_DIR: " /op/c ", HOME: "/home/op" })),
    "/op/c/.claude.json",
  );
  assertEquals(
    operatorFile(env({ CLAUDE_CONFIG_DIR: " ", HOME: "/home/op/" })),
    "/home/op/.claude.json",
  );
  assertEquals(
    operatorFile(env({ HOME: "/home/op" })),
    "/home/op/.claude.json",
  );
});

Deno.test("operatorFile: neither set is could not tell", () => {
  let thrown: unknown;
  try {
    operatorFile(env({}));
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof CouldNotTell);
  assertStringIncludes(thrown.message, "HOME");
});

/**
 * The three required keys and the theme, copied — and nothing else of the
 * operator's: their projects table least of all, which would trust every
 * directory they ever trusted.
 */
Deno.test("seedOnboarding: the four keys are copied, and nothing else of the operator's", async () => {
  await using s = await scratch(OPERATOR);
  await seedOnboarding(s.configDir, s.env);
  assertEquals(await s.seeded(), {
    hasCompletedOnboarding: true,
    lastOnboardingVersion: "2.1.220",
    theme: "dark",
    oauthAccount: OPERATOR.oauthAccount,
  });
});

/**
 * No theme is required: the operator's file on the measuring machine holds
 * none, and 2.1.280 met no theme picker without it (fleet-rge6.2's reviewer
 * call).
 */
Deno.test("seedOnboarding: a source with no theme seeds the three", async () => {
  const { theme: _, ...themeless } = OPERATOR;
  await using s = await scratch(themeless);
  await seedOnboarding(s.configDir, s.env);
  assertEquals(
    Object.keys(await s.seeded()).sort(),
    [...ONBOARDING_KEYS].sort(),
  );
});

Deno.test("seedOnboarding: CLAUDE_CONFIG_DIR names the operator's file over the home's", async () => {
  await using s = await scratch({ ...OPERATOR, lastOnboardingVersion: "home" });
  const theirs = `${s.top}/operator-config`;
  await Deno.mkdir(theirs);
  await Deno.writeTextFile(
    `${theirs}/${STATE_FILE}`,
    JSON.stringify({ ...OPERATOR, lastOnboardingVersion: "configured" }),
  );
  await seedOnboarding(
    s.configDir,
    env({ HOME: s.home, CLAUDE_CONFIG_DIR: theirs }),
  );
  assertEquals((await s.seeded()).lastOnboardingVersion, "configured");
});

/** Merged into a file already there: its other keys, and its projects, stay. */
Deno.test("seedOnboarding and seedTrust keep a present file's other keys", async () => {
  await using s = await scratch(OPERATOR);
  await Deno.writeTextFile(
    `${s.configDir}/${STATE_FILE}`,
    JSON.stringify({
      packOwn: { kept: 1 },
      theme: "light",
      projects: { "/elsewhere": { allowedTools: ["x"] } },
    }),
  );
  await seedOnboarding(s.configDir, s.env);
  await seedTrust(s.configDir, s.worktree);
  const seeded = await s.seeded();
  assertEquals(seeded.packOwn, { kept: 1 });
  assertEquals(seeded.theme, "dark", "a seeded key is set over the file's");
  assertEquals(seeded.projects, {
    "/elsewhere": { allowedTools: ["x"] },
    [s.worktree]: { hasTrustDialogAccepted: true },
  });
});

/** A missing required key refuses, naming it, and writes nothing. */
Deno.test("seedOnboarding: a source missing a required key refuses, naming it", async () => {
  for (const key of ONBOARDING_KEYS) {
    const { [key]: _, ...short } = OPERATOR;
    await using s = await scratch(short);
    const error = await assertRejects(
      () => seedOnboarding(s.configDir, s.env),
      CouldNotTell,
    );
    assertStringIncludes(error.message, `carries no \`${key}\``);
    assertStringIncludes(error.message, `${s.home}/${STATE_FILE}`);
    assertEquals([...Deno.readDirSync(s.configDir)], []);
  }
});

Deno.test("seedOnboarding: no operator file, or one that is not an object, refuses", async () => {
  await using s = await scratch(undefined);
  const missing = await assertRejects(
    () => seedOnboarding(s.configDir, s.env),
    CouldNotTell,
  );
  assertStringIncludes(missing.message, `${s.home}/${STATE_FILE}`);
  for (const body of ["[1]", "not json"]) {
    await Deno.writeTextFile(`${s.home}/${STATE_FILE}`, body);
    await assertRejects(() => seedOnboarding(s.configDir, s.env), CouldNotTell);
  }
  await Deno.writeTextFile(`${s.home}/${STATE_FILE}`, JSON.stringify(OPERATOR));
  await Deno.writeTextFile(`${s.configDir}/${STATE_FILE}`, "[]");
  await assertRejects(() => seedOnboarding(s.configDir, s.env), CouldNotTell);
  assertEquals(await Deno.readTextFile(`${s.configDir}/${STATE_FILE}`), "[]");
});

/** The seeded file carries the operator's oauthAccount: 0600, always. */
Deno.test("the seeded file is 0600, even where it was wider", async () => {
  await using s = await scratch(OPERATOR);
  const path = `${s.configDir}/${STATE_FILE}`;
  await Deno.writeTextFile(path, "{}");
  await Deno.chmod(path, 0o644);
  await seedOnboarding(s.configDir, s.env);
  assertEquals((await Deno.stat(path)).mode! & 0o777, SEED_MODE);
  assertEquals(SEED_MODE, 0o600);
  await Deno.chmod(path, 0o666);
  await seedTrust(s.configDir, s.worktree);
  assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
  await Deno.remove(path);
  await seedTrust(s.configDir, s.worktree);
  assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
});

/**
 * Trust is keyed on the worktree RESOLVED: the session reads its directory
 * off its own process, which hands it back resolved (fleet-rge6.2's Run C,
 * 2.1.280) — and it is the one entry written.
 */
Deno.test("seedTrust: exactly the resolved worktree is trusted", async () => {
  await using s = await scratch(OPERATOR);
  const through = `${s.top}/via`;
  await Deno.symlink(s.worktree, through);
  await seedTrust(s.configDir, through);
  assertEquals(await s.seeded(), {
    projects: { [s.worktree]: { hasTrustDialogAccepted: true } },
  });
});

Deno.test("seedTrust: an existing entry for the worktree keeps its other keys", async () => {
  await using s = await scratch(OPERATOR);
  await Deno.writeTextFile(
    `${s.configDir}/${STATE_FILE}`,
    JSON.stringify({ projects: { [s.worktree]: { allowedTools: ["y"] } } }),
  );
  await seedTrust(s.configDir, s.worktree);
  assertEquals((await s.seeded()).projects[s.worktree], {
    allowedTools: ["y"],
    hasTrustDialogAccepted: true,
  });
});

Deno.test("seedTrust: a worktree that does not resolve is keyed as given", async () => {
  await using s = await scratch(OPERATOR);
  const absent = `${s.top}/not-yet`;
  await seedTrust(s.configDir, absent);
  assertEquals(Object.keys((await s.seeded()).projects), [absent]);
});

Deno.test("seedTrust: a relative worktree is usage; a projects that is no object refuses", async () => {
  await using s = await scratch(OPERATOR);
  await assertRejects(() => seedTrust(s.configDir, "lane"), Usage);
  await Deno.writeTextFile(
    `${s.configDir}/${STATE_FILE}`,
    JSON.stringify({ projects: [] }),
  );
  await assertRejects(() => seedTrust(s.configDir, s.worktree), CouldNotTell);
});

/** A config dir that is a symlink out of itself takes no seed (E8). */
Deno.test("a config dir that is a symlink is refused, and nothing is written through it", async () => {
  await using s = await scratch(OPERATOR);
  const outside = `${s.top}/outside`;
  await Deno.mkdir(outside);
  const linked = `${s.top}/seat/linked`;
  await Deno.symlink(outside, linked);
  const onboarding = await assertRejects(
    () => seedOnboarding(linked, s.env),
    CouldNotTell,
  );
  assertStringIncludes(onboarding.message, "is a symlink");
  await assertRejects(() => seedTrust(linked, s.worktree), CouldNotTell);
  assertEquals([...Deno.readDirSync(outside)], []);
});
