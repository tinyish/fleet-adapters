// lessons A9 — a resume by the FULL id keeps the session, flags and all,
// when the session is interactive. Measured on 2.1.280 (fleet-rge6.4): a
// new pane whose command was `--resume <full id>` with the start's
// `--plugin-dir`, `--model` and `--permission-mode` came back as the same
// session, on the flags' model and posture, its plugin loaded, its next turn
// in the same transcript. So `resume` answers exactly that: the full id and
// the start's own three flags, no name and no first turn (the session has
// both), under the environment the start ran with.

import { assertEquals } from "@std/assert";
import { pluginDir } from "../../lib/plugin.ts";
import { STATE_FILE } from "../../lib/seed.ts";
import { OPERATOR } from "../helpers.ts";
import { main, REPLAY } from "../lessons_support.ts";

const SEAT = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718";
const FULL_ID = "663267a3-2b6e-44ac-b0f1-cbfd24bbbc5d";

Deno.test("lessons::a_resume_by_full_id_keeps_the_session", async () => {
  const top = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lessons-a9-" }),
  );
  try {
    const home = `${top}/home`;
    const configDir = `${top}/seat`;
    const worktree = `${top}/lane`;
    for (const dir of [home, configDir, worktree]) await Deno.mkdir(dir);
    await Deno.writeTextFile(`${home}/${STATE_FILE}`, JSON.stringify(OPERATOR));
    const vars = { HOME: home, FLEET_CLAUDE_BIN: REPLAY };
    const common = {
      schema_version: 1,
      root: "/work/project",
      worktree,
      config_dir: configDir,
      model: "claude-haiku-4-5",
    };

    for (
      const [posture, mode] of [
        ["ask", "default"],
        ["auto", "auto"],
        ["unattended", "dontAsk"],
      ]
    ) {
      const launched = await main("launch", {
        ...common,
        seat: SEAT,
        name: "builder-e5f60718",
        posture,
        first_turn: "/wake builder-e5f60718",
        env: { FLEET_ACTOR: `seat:${SEAT}` },
        permissions: { commands: [] },
      }, vars);
      assertEquals(launched.exit, 0, launched.stderr);
      const resumed = await main(
        "resume",
        { ...common, session_id: FULL_ID, posture },
        vars,
      );
      assertEquals(resumed.exit, 0, resumed.stderr);

      assertEquals(resumed.answer!.argv, [
        REPLAY,
        "--resume",
        FULL_ID,
        "--model",
        "claude-haiku-4-5",
        "--permission-mode",
        mode,
        "--plugin-dir",
        pluginDir(),
      ], "the full id and the start's three flags, and nothing else");

      // The start's own three flags, value for value.
      const start = launched.answer!.argv as string[];
      for (const flag of ["--model", "--permission-mode", "--plugin-dir"]) {
        const argv = resumed.answer!.argv as string[];
        assertEquals(
          argv[argv.indexOf(flag) + 1],
          start[start.indexOf(flag) + 1],
          flag,
        );
      }

      // Under the start's own environment, its config dir included: every
      // variable the resume sets is the launch's.
      const env = resumed.answer!.env as Record<string, string>;
      const launchEnv = launched.answer!.env as Record<string, string>;
      assertEquals(Object.keys(env).sort(), [
        "CLAUDE_CONFIG_DIR",
        "CLAUDE_SECURESTORAGE_CONFIG_DIR",
        "DISABLE_AUTOUPDATER",
      ]);
      for (const [key, value] of Object.entries(env)) {
        assertEquals(launchEnv[key], value, key);
      }
    }
  } finally {
    await Deno.remove(top, { recursive: true });
  }
});
