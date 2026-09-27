// verbs/resume.ts: a killed seat's session back as a new pane's command — the
// full id with the start's own flags (Reviewer call 2026-09-25, E3; measured
// on 2.1.280 by fleet-rge6.4: same session id, name, model, posture and
// transcript, not a fork) — under the same three variables a launch answers.

import { assertEquals, assertRejects } from "@std/assert";
import { Refused } from "../lib/answer.ts";
import { pluginDir } from "../lib/plugin.ts";
import { resumeWith } from "../verbs/resume.ts";
import type { ResumeRequest } from "../contract.d.ts";
import { call, tree } from "./helpers.ts";

const SESSION = "663267a3-2b6e-44ac-b0f1-cbfd24bbbc5d";

function aResume(fields: Partial<ResumeRequest> = {}): ResumeRequest {
  return {
    schema_version: 1,
    root: "/work/project",
    session_id: SESSION,
    worktree: "/nowhere/wt/builder-1",
    config_dir: "/nowhere/seats/builder-9739a",
    model: "claude-haiku-4-5",
    posture: "auto",
    ...fields,
  };
}

function env(vars: Record<string, string>) {
  return (name: string) => vars[name];
}

async function aClaude() {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const claude = `${dir}/claude`;
  await Deno.writeTextFile(claude, "#!/bin/sh\nexit 0\n");
  await Deno.chmod(claude, 0o755);
  return {
    dir,
    claude,
    [Symbol.asyncDispose]: () => Deno.remove(dir, { recursive: true }),
  };
}

/** The full id, then the three start flags; no name and no first turn. */
Deno.test("resume: the full id and the start's three flags, for each posture", async () => {
  await using c = await aClaude();
  const resume = resumeWith(
    env({ HOME: "/home/op", FLEET_CLAUDE_BIN: c.claude }),
  );
  for (
    const [posture, mode] of [
      ["ask", "default"],
      ["auto", "auto"],
      ["unattended", "dontAsk"],
    ] as const
  ) {
    const answered = await resume(aResume({ posture }));
    assertEquals(answered.argv, [
      c.claude,
      "--resume",
      SESSION,
      "--model",
      "claude-haiku-4-5",
      "--permission-mode",
      mode,
      "--plugin-dir",
      pluginDir(),
    ]);
  }
});

/**
 * The same three variables a launch answers, and nothing of fleet's: a
 * resume request carries no env, and fleet sets its own beside these.
 */
Deno.test("resume: the env is the agent's three, the request's config dir first", async () => {
  const resume = resumeWith(env({ HOME: "/home/op" }));
  assertEquals((await resume(aResume())).env, {
    CLAUDE_CONFIG_DIR: "/nowhere/seats/builder-9739a",
    CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
    DISABLE_AUTOUPDATER: "1",
  });
  assertEquals(
    (await resume(aResume({ config_dir: null }))).env.CLAUDE_CONFIG_DIR,
    "/home/op/.claude",
  );
  const configured = resumeWith(
    env({ HOME: "/home/op", CLAUDE_CONFIG_DIR: "/op/c" }),
  );
  assertEquals(
    (await configured(aResume({ config_dir: undefined }))).env,
    {
      CLAUDE_CONFIG_DIR: "/op/c",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "/op/c",
      DISABLE_AUTOUPDATER: "1",
    },
  );
});

Deno.test("resume: a posture outside the three is refused unsupported", async () => {
  const refused = await assertRejects(
    () =>
      resumeWith(env({ HOME: "/home/op" }))(
        aResume({ posture: "acceptEdits" as "ask" }),
      ),
    Refused,
  );
  assertEquals(refused.reason, "unsupported");
});

/** A blank id would open claude's own picker in the pane: nobody has it. */
Deno.test("resume: a blank session id is refused missing", async () => {
  for (const id of ["", "  "]) {
    const refused = await assertRejects(
      () => resumeWith(env({ HOME: "/home/op" }))(aResume({ session_id: id })),
      Refused,
    );
    assertEquals(refused.reason, "missing");
  }
});

/** The start seeded the config dir: a resume writes nothing at all. */
Deno.test("main.ts resume: answers exit 0 and writes nothing", async () => {
  await using c = await aClaude();
  const configDir = `${c.dir}/seat`;
  const worktree = `${c.dir}/lane`;
  await Deno.mkdir(configDir);
  await Deno.mkdir(worktree);
  const before = await tree(c.dir);
  const answered = await call(
    "resume",
    JSON.stringify(aResume({ config_dir: configDir, worktree })),
    { CLAUDE_CONFIG_DIR: "", FLEET_CLAUDE_BIN: c.claude },
  );
  assertEquals(answered.exit, 0, answered.stderr);
  assertEquals(answered.answer, {
    schema_version: 1,
    argv: [
      c.claude,
      "--resume",
      SESSION,
      "--model",
      "claude-haiku-4-5",
      "--permission-mode",
      "auto",
      "--plugin-dir",
      pluginDir(),
    ],
    env: {
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
      DISABLE_AUTOUPDATER: "1",
    },
  });
  assertEquals(await tree(c.dir), before);
});
