// verbs/launch.ts: a seat's session as the pane's own command — the argv and
// the environment core sets exactly (D1, E2) — and the seed of a spawned
// seat's config dir, written before the answer. Every claude here is a
// script, and none is run: launch starts nothing.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { CouldNotTell, Refused } from "../lib/answer.ts";
import { pluginDir } from "../lib/plugin.ts";
import { STATE_FILE } from "../lib/seed.ts";
import { launchWith } from "../verbs/launch.ts";
import type { LaunchRequest } from "../contract.d.ts";
import { call, OPERATOR, tree } from "./helpers.ts";

const SEAT = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718";

/** A spawned seat's scratch: the operator's home, a config dir, a worktree. */
async function scratch() {
  const top = await Deno.realPath(await Deno.makeTempDir());
  const home = `${top}/home`;
  const configDir = `${top}/seat/agent`;
  const worktree = `${top}/lane`;
  for (const dir of [home, configDir, worktree]) {
    await Deno.mkdir(dir, { recursive: true });
  }
  await Deno.writeTextFile(`${home}/${STATE_FILE}`, JSON.stringify(OPERATOR));
  const claude = `${top}/bin/claude`;
  await Deno.mkdir(`${top}/bin`);
  await Deno.writeTextFile(claude, "#!/bin/sh\nexit 0\n");
  await Deno.chmod(claude, 0o755);
  return {
    top,
    home,
    configDir,
    worktree,
    claude,
    [Symbol.asyncDispose]: () => Deno.remove(top, { recursive: true }),
  };
}

function aLaunch(
  fields: Partial<LaunchRequest> & { worktree: string },
): LaunchRequest {
  return {
    schema_version: 1,
    root: "/work/project",
    seat: SEAT,
    name: "builder-e5f60718",
    model: "claude-opus-5",
    posture: "unattended",
    first_turn: "/wake builder-e5f60718",
    env: {
      FLEET_ACTOR: `seat:${SEAT}`,
      FLEET_BIN: "/usr/local/bin/fleet",
      PATH: "/usr/local/bin:/usr/bin:/bin",
    },
    permissions: { commands: [] },
    ...fields,
  };
}

function env(vars: Record<string, string>) {
  return (name: string) => vars[name];
}

/**
 * The pane's command, whole: the claude, the name, the model, the posture's
 * mode, the pack's own plugin, then the first turn as the positional prompt —
 * an interactive session, no --bg (claude_code.rs launch at tinyfleet
 * 807107b). Each posture its own mode (ruling 14).
 */
Deno.test("launch: the argv for each posture", async () => {
  await using s = await scratch();
  const launch = launchWith(env({ HOME: s.home, FLEET_CLAUDE_BIN: s.claude }));
  for (
    const [posture, mode] of [
      ["ask", "default"],
      ["auto", "auto"],
      ["unattended", "dontAsk"],
    ] as const
  ) {
    const answered = await launch(
      aLaunch({ worktree: s.worktree, posture }),
    );
    assertEquals(answered.argv, [
      s.claude,
      "--name",
      "builder-e5f60718",
      "--model",
      "claude-opus-5",
      "--permission-mode",
      mode,
      "--plugin-dir",
      pluginDir(),
      "/wake builder-e5f60718",
    ]);
  }
});

Deno.test("launch: with no seam the pane runs claude by name", async () => {
  await using s = await scratch();
  const answered = await launchWith(env({ HOME: s.home }))(
    aLaunch({ worktree: s.worktree }),
  );
  assertEquals(answered.argv[0], "claude");
});

/** The plugin is the adapter's own, beside main.ts, never a request's (E8). */
Deno.test("pluginDir: plugin/ beside main.ts, absolute", () => {
  const dir = pluginDir();
  assertEquals(
    dir,
    decodeURIComponent(new URL("../plugin", import.meta.url).pathname),
  );
  assert(dir.startsWith("/") && dir.endsWith("/claude-code/plugin"), dir);
});

Deno.test("launch: a posture outside the three is refused, and nothing is written", async () => {
  await using s = await scratch();
  const before = await tree(s.top);
  const refused = await assertRejects(
    () =>
      launchWith(env({ HOME: s.home }))(
        aLaunch({
          worktree: s.worktree,
          config_dir: s.configDir,
          posture: "acceptEdits" as "ask",
        }),
      ),
    Refused,
  );
  assertEquals(refused.reason, "unsupported");
  assertEquals(await tree(s.top), before);
});

/**
 * The environment core sets exactly: the request's own variables, and this
 * agent's three over them — the seat's config dir, the credential scope
 * DEFINED EVEN WHEN EMPTY (lessons claude-code A11), and the auto-updater off
 * (the INCIDENT on fleet-rge6; fleet-jymr.1's reviewer call).
 */
Deno.test("launch: the env is the request's with the agent's three over it", async () => {
  await using s = await scratch();
  const request = aLaunch({ worktree: s.worktree, config_dir: s.configDir });
  request.env.CLAUDE_CONFIG_DIR = "/not/the/seats";
  request.env.DISABLE_AUTOUPDATER = "0";
  const empty = await launchWith(env({ HOME: s.home }))(request);
  assertEquals(empty.env, {
    FLEET_ACTOR: `seat:${SEAT}`,
    FLEET_BIN: "/usr/local/bin/fleet",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    CLAUDE_CONFIG_DIR: s.configDir,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
    DISABLE_AUTOUPDATER: "1",
  });
  const operatorDir = `${s.top}/operator`;
  await Deno.mkdir(operatorDir);
  await Deno.writeTextFile(
    `${operatorDir}/${STATE_FILE}`,
    JSON.stringify(OPERATOR),
  );
  const named = await launchWith(
    env({ HOME: s.home, CLAUDE_CONFIG_DIR: ` ${operatorDir} ` }),
  )(aLaunch({ worktree: s.worktree, config_dir: s.configDir }));
  assertEquals(named.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, operatorDir);
  assertEquals(named.env.CLAUDE_CONFIG_DIR, s.configDir);
});

/**
 * A spawned seat's launch seeds its config dir before it answers: the four
 * onboarding keys, and trust for exactly the request's worktree — resolved.
 */
Deno.test("launch: a spawned seat's config dir is seeded with onboarding and its worktree's trust", async () => {
  await using s = await scratch();
  const through = `${s.top}/via-link`;
  await Deno.symlink(s.worktree, through);
  await launchWith(env({ HOME: s.home }))(
    aLaunch({ worktree: through, config_dir: s.configDir }),
  );
  const path = `${s.configDir}/${STATE_FILE}`;
  assertEquals(JSON.parse(await Deno.readTextFile(path)), {
    hasCompletedOnboarding: true,
    lastOnboardingVersion: "2.1.220",
    theme: "dark",
    oauthAccount: OPERATOR.oauthAccount,
    projects: { [s.worktree]: { hasTrustDialogAccepted: true } },
  });
  assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
  assertEquals(
    [...Deno.readDirSync(s.worktree)],
    [],
    "nothing lands in the worktree",
  );
});

/**
 * A named seat carries no config dir (E9): its checkout is a person's, and
 * fleet trusts only worktrees it created (ruling 13). Nothing is written —
 * not the operator's own .claude.json above all — and the session runs under
 * the operator's configuration.
 */
Deno.test("launch: a named seat writes nothing, and no trust entry anywhere", async () => {
  await using s = await scratch();
  const operator = await Deno.readTextFile(`${s.home}/${STATE_FILE}`);
  const before = await tree(s.top);
  const answered = await launchWith(env({ HOME: s.home }))(
    aLaunch({ worktree: s.worktree, config_dir: null }),
  );
  assertEquals(await tree(s.top), before);
  assertEquals(await Deno.readTextFile(`${s.home}/${STATE_FILE}`), operator);
  assertEquals(answered.env.CLAUDE_CONFIG_DIR, `${s.home}/.claude`);
  assertEquals(answered.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, "");
});

Deno.test("launch: a source missing oauthAccount is could not tell, naming it, and the answer never comes", async () => {
  await using s = await scratch();
  const { oauthAccount: _, ...short } = OPERATOR;
  await Deno.writeTextFile(`${s.home}/${STATE_FILE}`, JSON.stringify(short));
  const error = await assertRejects(
    () =>
      launchWith(env({ HOME: s.home }))(
        aLaunch({ worktree: s.worktree, config_dir: s.configDir }),
      ),
    CouldNotTell,
  );
  assertStringIncludes(error.message, "`oauthAccount`");
  assertEquals([...Deno.readDirSync(s.configDir)], []);
});

Deno.test("launch: a config dir that is a symlink out of itself is refused", async () => {
  await using s = await scratch();
  const outside = `${s.top}/outside`;
  await Deno.mkdir(outside);
  const linked = `${s.top}/seat/linked`;
  await Deno.symlink(outside, linked);
  const error = await assertRejects(
    () =>
      launchWith(env({ HOME: s.home }))(
        aLaunch({ worktree: s.worktree, config_dir: linked }),
      ),
    CouldNotTell,
  );
  assertStringIncludes(error.message, "is a symlink");
  assertEquals([...Deno.readDirSync(outside)], []);
});

/** The executable, as fleet runs it: exit 0 and the answer, or exit 1 refused. */
Deno.test("main.ts launch: answers exit 0, and refuses acceptEdits exit 1 naming it and the three", async () => {
  await using s = await scratch();
  const vars = {
    HOME: s.home,
    CLAUDE_CONFIG_DIR: "",
    FLEET_CLAUDE_BIN: s.claude,
  };
  const answered = await call(
    "launch",
    JSON.stringify(aLaunch({ worktree: s.worktree, config_dir: s.configDir })),
    vars,
  );
  assertEquals(answered.exit, 0, answered.stderr);
  assertEquals(answered.answer?.schema_version, 1);
  assertEquals((answered.answer?.argv as string[])[0], s.claude);
  const refused = await call(
    "launch",
    JSON.stringify(
      aLaunch({
        worktree: s.worktree,
        config_dir: s.configDir,
        posture: "acceptEdits" as "ask",
      }),
    ),
    vars,
  );
  assertEquals(refused.exit, 1, refused.stderr);
  assertEquals(refused.answer, {
    schema_version: 1,
    refused: {
      reason: "unsupported",
      message:
        "Claude Code takes no posture `acceptEdits`: its postures are ask, auto and unattended",
    },
  });
});
