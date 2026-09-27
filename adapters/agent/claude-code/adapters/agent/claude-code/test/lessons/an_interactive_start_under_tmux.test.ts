// lessons D8 — an interactive start under tmux meets onboarding, waits at
// the trust question, and a burst Enter does not submit. Held on 2.1.280
// (fleet-031, fleet-rge6.2): under an EMPTY config dir an interactive start
// stops at the theme picker and then the login menu, listed nowhere; a
// `.claude.json` seeded with hasCompletedOnboarding, lastOnboardingVersion
// and oauthAccount alone meets neither, and with the credential knob
// defined-but-empty comes up logged in. So a spawned seat's launch is an
// interactive session — the pane's own process, no `--bg` — its first turn
// the positional prompt, under a config dir seeded with those three keys
// (and the theme where the operator's file has one) before it answers, and
// refused, writing nothing, where the operator's file lacks one.
//
// The trust half is A15's arm. The submit — text, then a separate Enter, a
// turn believed when the row reads busy — is typed by core into the pane,
// and the live start is `fleet agent check --live`'s (fleet-jymr.7).

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { pluginDir } from "../../lib/plugin.ts";
import { STATE_FILE } from "../../lib/seed.ts";
import { OPERATOR } from "../helpers.ts";
import { main, REPLAY } from "../lessons_support.ts";

const SEAT = "0199a3c4-0000-7000-8000-0000000048a0";

Deno.test("lessons::an_interactive_start_under_tmux", async () => {
  const top = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lessons-d8-" }),
  );
  try {
    const home = `${top}/home`;
    const configDir = `${top}/seat`;
    const worktree = `${top}/lane`;
    for (const dir of [home, configDir, worktree]) await Deno.mkdir(dir);
    const vars = { HOME: home, FLEET_CLAUDE_BIN: REPLAY };
    const request = {
      schema_version: 1,
      root: "/work/project",
      seat: SEAT,
      name: "builder-48a0",
      model: "claude-haiku-4-5",
      posture: "ask",
      first_turn: "/wake builder-48a0",
      env: { FLEET_ACTOR: `seat:${SEAT}` },
      permissions: { commands: [] },
      worktree,
      config_dir: configDir,
    };

    // An operator file missing a key: refused, naming it, nothing written —
    // never a session brought up at the login menu.
    for (
      const key of [
        "hasCompletedOnboarding",
        "lastOnboardingVersion",
        "oauthAccount",
      ]
    ) {
      const short: Record<string, unknown> = { ...OPERATOR };
      delete short[key];
      await Deno.writeTextFile(`${home}/${STATE_FILE}`, JSON.stringify(short));
      const refused = await main("launch", request, vars);
      assertEquals(refused.exit, 3, refused.stderr);
      assertStringIncludes(refused.stderr, `\`${key}\``);
      assertEquals([...Deno.readDirSync(configDir)], [], key);
    }

    // The three keys, and the theme, copied; nothing else of the operator's.
    await Deno.writeTextFile(`${home}/${STATE_FILE}`, JSON.stringify(OPERATOR));
    const launched = await main("launch", request, vars);
    assertEquals(launched.exit, 0, launched.stderr);
    const seeded = JSON.parse(
      await Deno.readTextFile(`${configDir}/${STATE_FILE}`),
    );
    assertEquals(
      Object.keys(seeded).sort(),
      [
        "hasCompletedOnboarding",
        "lastOnboardingVersion",
        "oauthAccount",
        "projects",
        "theme",
      ],
    );
    for (
      const key of [
        "hasCompletedOnboarding",
        "lastOnboardingVersion",
        "oauthAccount",
        "theme",
      ]
    ) {
      assertEquals(
        seeded[key],
        (OPERATOR as Record<string, unknown>)[key],
        key,
      );
    }

    // The session: the pane's own process, interactive, every flag a start
    // owes, the first turn last; logged in under the seat's own config dir.
    const argv = launched.answer!.argv as string[];
    assertEquals(argv, [
      REPLAY,
      "--name",
      "builder-48a0",
      "--model",
      "claude-haiku-4-5",
      "--permission-mode",
      "default",
      "--plugin-dir",
      pluginDir(),
      "/wake builder-48a0",
    ]);
    assert(!argv.includes("--bg") && !argv.includes("-p"), "interactive");
    const env = launched.answer!.env as Record<string, string>;
    assertEquals(env.CLAUDE_CONFIG_DIR, configDir);
    assertEquals(env.CLAUDE_SECURESTORAGE_CONFIG_DIR, "");
    assertEquals(env.DISABLE_AUTOUPDATER, "1");

    // The theme is not required: the measuring machine's file carries none.
    await Deno.remove(`${configDir}/${STATE_FILE}`);
    const { theme: _, ...themeless } = OPERATOR;
    await Deno.writeTextFile(
      `${home}/${STATE_FILE}`,
      JSON.stringify(themeless),
    );
    const plain = await main("launch", request, vars);
    assertEquals(plain.exit, 0, plain.stderr);
    assertEquals(
      "theme" in
        JSON.parse(await Deno.readTextFile(`${configDir}/${STATE_FILE}`)),
      false,
    );
  } finally {
    await Deno.remove(top, { recursive: true });
  }
});
