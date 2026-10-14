// lessons A11 — the config directory scopes the listing, and a scratch one
// is logged out. Held on 2.1.280 (fleet-031, fleet-jymr.3): a session under
// one config dir is listed by that dir's listing only; the credential knob
// defined-but-empty is logged in, and set to a directory or unset is logged
// out, while the listing still reads the session idle with a pid — only the
// transcript says so. So `read` lists each seat under its OWN dir, the
// credential knob is the operator's configured value (empty when none) on
// every child, and a logged-out session is read off its transcript.

import { assertEquals } from "@std/assert";
import { STATE_FILE } from "../../lib/seed.ts";
import { OPERATOR } from "../helpers.ts";
import { main, READ_FIXTURES, readCase, readOver } from "../lessons_support.ts";

const SEAT = "0199a3c4-0000-7000-8000-0000000011a0";
const OTHER = "0199a3c4-0000-7000-8000-0000000011b0";

Deno.test("lessons::the_config_dir_scopes_the_daemon", async () => {
  // Recorded: three dirs, a seat seen only through its own dir's listing,
  // and the one that fails leaving the others read (fixtures/read/
  // one-dir-fails; the replaying claude refuses to list with the credential
  // knob unset, so every listing ran with it defined).
  const recorded = await readCase("one-dir-fails");
  assertEquals(recorded.seats, recorded.expected.seats);
  // Its fourth seat is the second's pane asked under the wrong dir: nothing.
  assertEquals(
    recorded.seats[1].session_id,
    "0a776357-88ce-41bb-81e5-18b426819a03",
  );
  assertEquals(recorded.seats[3].activity, "starting");

  // Made up: the same pane under the fleet's dir and under its own.
  const row = JSON.stringify([
    { sessionId: "spawned", kind: "interactive", pid: 2222, status: "busy" },
  ]);
  const seen = await readOver({ fleets: "[]", own: row }, (dir) => [
    { seat: SEAT, pid: 2222, config_dir: dir.own, worktree: "/wt/a" },
    { seat: OTHER, pid: 2222, config_dir: dir.fleets, worktree: "/wt/a" },
  ]);
  assertEquals(seen.map((s) => [s.activity, s.session_id]), [
    ["busy", "spawned"],
    ["starting", undefined],
  ]);

  // Logged out is live on the listing and read off the transcript.
  const loggedOut = await readCase("logged-out");
  const listed = JSON.parse(
    Deno.readTextFileSync(`${READ_FIXTURES}logged-out/config/listing.json`),
  );
  assertEquals(
    [listed[0].status, typeof listed[0].pid],
    ["idle", "number"],
    "the listing alone reads a logged-out session as a live idle one",
  );
  assertEquals(loggedOut.seats, loggedOut.expected.seats);
  assertEquals(loggedOut.seats[0].blocked_on, "logged_out");

  // The credential knob on the pane: the operator's configured value, empty
  // when nothing configured one, and never the seat's own dir nor a path
  // the adapter resolved.
  const top = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lessons-a11-" }),
  );
  try {
    const operatorDir = `${top}/operator`;
    const seatDir = `${top}/seat`;
    for (const dir of [top + "/home", operatorDir, seatDir]) {
      await Deno.mkdir(dir, { recursive: true });
    }
    for (const at of [`${top}/home`, operatorDir]) {
      await Deno.writeTextFile(`${at}/${STATE_FILE}`, JSON.stringify(OPERATOR));
    }
    const launch = {
      schema_version: 1,
      root: "/work/project",
      seat: SEAT,
      name: "builder-11a0",
      model: "claude-haiku-4-5",
      posture: "ask",
      first_turn: "/wake builder-11a0",
      env: {},
      permissions: { commands: [] },
      worktree: top,
      config_dir: seatDir,
    };
    const unconfigured = await main("launch", launch, { HOME: `${top}/home` });
    assertEquals(unconfigured.exit, 0, unconfigured.stderr);
    const configured = await main("launch", launch, {
      HOME: `${top}/home`,
      CLAUDE_CONFIG_DIR: operatorDir,
    });
    assertEquals(configured.exit, 0, configured.stderr);
    const knob = (
      answer: Record<string, unknown> | undefined,
    ) => (answer!.env as Record<string, string>);
    assertEquals(knob(unconfigured.answer).CLAUDE_CONFIG_DIR, seatDir);
    assertEquals(knob(unconfigured.answer).CLAUDE_SECURESTORAGE_CONFIG_DIR, "");
    assertEquals(knob(configured.answer).CLAUDE_CONFIG_DIR, seatDir);
    assertEquals(
      knob(configured.answer).CLAUDE_SECURESTORAGE_CONFIG_DIR,
      operatorDir,
    );
  } finally {
    await Deno.remove(top, { recursive: true });
  }
});
