// lessons A15 — a first start in an untrusted directory meets the
// workspace-trust question; shared with G12 of fleet's
// brain/lessons/gas-city.md, where the question killed a session every few
// seconds. MOVED on 2.1.280 for an interactive start (fleet-rge6.2,
// fleet-031): the question WAITS, with "No, exit" selected, the listing `[]`
// while it is up; an entry `projects[<resolved worktree>]
// .hasTrustDialogAccepted: true` seeded before the start meets no question.
// So a spawned seat's launch seeds exactly that entry, for its own worktree
// resolved and no other (ruling 13); a named seat's launch writes nothing;
// and where the question is up anyway, `read` answers blocked on a question,
// off the screen.

import { assertEquals } from "@std/assert";
import { STATE_FILE } from "../../lib/seed.ts";
import { OPERATOR } from "../helpers.ts";
import { main, READ_FIXTURES, readCase, REPLAY } from "../lessons_support.ts";

const SEAT = "0199a3c4-0000-7000-8000-0000000015a0";

async function exists(path: string): Promise<boolean> {
  return await Deno.lstat(path).then(() => true, () => false);
}

Deno.test("lessons::a_first_run_meets_the_trust_dialog", async () => {
  const top = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lessons-a15-" }),
  );
  try {
    const home = `${top}/home`;
    const configDir = `${top}/seat`;
    const worktree = `${top}/lane`;
    for (const dir of [home, configDir, worktree]) await Deno.mkdir(dir);
    await Deno.writeTextFile(`${home}/${STATE_FILE}`, JSON.stringify(OPERATOR));
    await Deno.symlink(worktree, `${top}/through-a-link`);
    const launch = (config_dir: string | null) =>
      main("launch", {
        schema_version: 1,
        root: "/work/project",
        seat: SEAT,
        name: "builder-15a0",
        model: "claude-haiku-4-5",
        posture: "ask",
        first_turn: "/wake builder-15a0",
        env: {},
        permissions: { commands: [] },
        worktree: `${top}/through-a-link`,
        config_dir,
      }, { HOME: home, FLEET_CLAUDE_BIN: REPLAY });

    // A spawned seat: its worktree, RESOLVED, is the one path trusted.
    const spawned = await launch(configDir);
    assertEquals(spawned.exit, 0, spawned.stderr);
    const seeded = JSON.parse(
      await Deno.readTextFile(`${configDir}/${STATE_FILE}`),
    );
    assertEquals(seeded.projects, {
      [worktree]: { hasTrustDialogAccepted: true },
    }, "none of the operator's own trusts, and not the link");

    // The control: a named seat's checkout is a person's, and its launch
    // trusts it nowhere — no state file of fleet's writing under the
    // operator's config dir, and the operator's own file untouched.
    await Deno.remove(`${configDir}/${STATE_FILE}`);
    const operators = await Deno.readTextFile(`${home}/${STATE_FILE}`);
    const named = await launch(null);
    assertEquals(named.exit, 0, named.stderr);
    assertEquals(
      (named.answer!.env as Record<string, string>).CLAUDE_CONFIG_DIR,
      `${home}/.claude`,
    );
    assertEquals(await Deno.readTextFile(`${home}/${STATE_FILE}`), operators);
    for (
      const file of [
        `${home}/.claude/${STATE_FILE}`,
        `${configDir}/${STATE_FILE}`,
      ]
    ) {
      assertEquals(await exists(file), false, file);
    }
  } finally {
    await Deno.remove(top, { recursive: true });
  }

  // Recorded on 2.1.280: the question up, the listing `[]`, and the pane
  // showing it — blocked on a question, the screen's evidence.
  const listed = Deno.readTextFileSync(
    `${READ_FIXTURES}trust-question/config/listing.json`,
  );
  assertEquals(JSON.parse(listed), []);
  const question = await readCase("trust-question");
  assertEquals(question.seats, question.expected.seats);
  assertEquals(question.seats[0].blocked_on, "question");
  assertEquals(question.seats[0].evidence, "screen");
});
